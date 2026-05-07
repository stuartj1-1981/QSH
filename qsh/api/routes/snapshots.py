"""REST routes for the pre-write configuration snapshot mechanism.

INSTRUCTION-192. Endpoints:

  GET    /api/config/snapshots
  GET    /api/config/snapshots/{snapshot_id}/diff
  POST   /api/config/snapshots/{snapshot_id}/revert
  POST   /api/config/snapshots/purge

Auth posture inherits from the FastAPI app's middleware stack
(IngressSecurityMiddleware in qsh/api/server.py), which is the same gate
that protects /api/config/{section} PATCH. No new auth surface is
introduced.

The diff endpoint deliberately returns credential values WITHOUT
redaction (per V2 review HIGH-03-V2 owner directive option (a)). The
operator needs value visibility to make an informed revert decision;
the existing GET /api/config/{section} endpoint redacts because its
primary consumers (frontend Settings forms) do not need value visibility
for unchanged credential fields. The asymmetry is design-intentional;
any change requires owner directive.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..snapshots import (
    Snapshot,
    SnapshotCaptureError,
    SnapshotNotFoundError,
    SnapshotRevertError,
    get_retention_count,
    snapshot_diff,
    snapshot_list,
    snapshot_purge,
    snapshot_revert,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class RevertRequest(BaseModel):
    """Type-the-timestamp confirmation. Operator must paste/type the
    snapshot_id verbatim — server-side equality check enforces."""

    confirm_timestamp: str = Field(..., min_length=1)


class PurgeRequest(BaseModel):
    """Type-PURGE_ALL confirmation."""

    confirm: str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Response shaping
# ---------------------------------------------------------------------------


def _snapshot_to_response(snap: Snapshot) -> dict[str, Any]:
    """JSON-friendly shape — Path is not directly serialisable."""
    return {
        "snapshot_id": snap.snapshot_id,
        "captured_at": snap.captured_at,
        "size_bytes": snap.size_bytes,
        "trigger_path": snap.trigger_path,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/config/snapshots")
def list_snapshots() -> dict[str, Any]:
    """Return all retained snapshots, newest-first, plus retention count.

    Frontend uses retention_count to surface "Retaining the last N
    snapshots" prominently in the SnapshotsPanel.
    """
    snaps = snapshot_list()
    return {
        "retention_count": get_retention_count(),
        "snapshots": [_snapshot_to_response(s) for s in snaps],
    }


@router.get("/config/snapshots/{snapshot_id}/diff")
def diff_snapshot(snapshot_id: str) -> dict[str, Any]:
    """Return the structured diff between the named snapshot and the
    current qsh.yaml.

    Returns DiffEntry list with `is_secret` flagged. Secret values are
    NOT redacted in `old`/`new` — operator value visibility is required
    for informed revert decisions.
    """
    try:
        entries = snapshot_diff(snapshot_id)
    except SnapshotNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "snapshot_id": snapshot_id,
        "entries": [asdict(e) for e in entries],
    }


@router.post("/config/snapshots/{snapshot_id}/revert")
def revert_to_snapshot(snapshot_id: str, body: RevertRequest) -> dict[str, Any]:
    """Restore the named snapshot to qsh.yaml after type-the-timestamp
    confirmation, then trigger a pipeline restart.

    The restart-request is the same flag file (`/config/qsh_restart_requested`)
    the existing `patch_config_section` writes after a successful PATCH
    — this is the in-process restart channel; the supervisor picks up
    the new YAML on next boot.
    """
    if body.confirm_timestamp != snapshot_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "confirm_timestamp must exactly match the snapshot_id. "
                "Type or paste the snapshot timestamp shown in the dialog."
            ),
        )

    try:
        # Capture diff BEFORE revert so the historian event can record
        # what changed. Snapshot file is immutable; no race risk.
        try:
            diff_entries = snapshot_diff(snapshot_id)
        except SnapshotNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        restored_from, pre_revert = snapshot_revert(snapshot_id)
    except SnapshotNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SnapshotCaptureError as exc:
        # Pre-revert capture failed; the file on disk is unchanged.
        raise HTTPException(
            status_code=500,
            detail=f"Pre-revert snapshot capture failed: {exc}",
        ) from exc
    except SnapshotRevertError as exc:
        # Pre-revert succeeded but file restore failed — qsh.yaml is
        # unchanged, but the operator can use the pre-revert snapshot
        # manually if needed.
        raise HTTPException(
            status_code=500,
            detail=f"Revert failed after pre-revert capture: {exc}",
        ) from exc

    # Historian event — fail-silent per existing historian convention.
    try:
        from qsh.historian import get_historian
        historian = get_historian()
        if historian is not None:
            historian.record_revert_event(
                snapshot_id=restored_from.snapshot_id,
                pre_revert_snapshot_id=pre_revert.snapshot_id,
                diff_payload=[asdict(e) for e in diff_entries],
                triggered_by="manual",
            )
    except Exception as exc:  # noqa: BLE001 — historian is best-effort
        logger.debug(
            "module=config_snapshot event=historian_record_failed error=%r",
            exc,
        )

    # Restart-request — same flag file written by patch_config_section.
    try:
        with open("/config/qsh_restart_requested", "w") as f:
            f.write("1")
    except OSError:
        # Non-fatal: the supervisor will pick up the new YAML on the
        # next natural restart.
        pass

    return {
        "reverted_to": _snapshot_to_response(restored_from),
        "pre_revert_snapshot": _snapshot_to_response(pre_revert),
        "restart_required": True,
        "message": "Reverted to snapshot — pipeline restarting",
    }


@router.post("/config/snapshots/purge")
def purge_snapshots(body: PurgeRequest) -> dict[str, Any]:
    """Delete every snapshot in the snapshot directory after PURGE_ALL
    confirmation."""
    if body.confirm != "PURGE_ALL":
        raise HTTPException(
            status_code=400,
            detail="confirm must equal the literal string 'PURGE_ALL'.",
        )

    count = snapshot_purge()
    return {"count": count}
