"""Pre-write configuration snapshot manager (INSTRUCTION-192).

Captures the on-disk qsh.yaml before any operator-initiated write so the
operator can revert via the Settings page SnapshotsPanel.

Topology
--------
- Snapshot location: <SNAPSHOT_DIR>/qsh.yaml.bak.<UTC-ISO> where the
  ISO-8601 timestamp preserves colons (HA Supervisor runs ext4; colons
  are valid filename characters).
- Default retention: 5 (configurable via config_snapshot.retention_count
  in qsh.yaml, clamped to [2, 50]).
- Atomic capture: source bytes copied to <name>.tmp, fsynced, renamed,
  parent dir fsynced. The whole sequence runs under a singleton
  threading.Lock so concurrent in-process writers serialise.

The four operator-facing write paths (Settings PATCH, wizard deploy,
backup restore, schedule writes) call snapshot_capture() before their
write. Other read_modify_write callers (control toggles, away mode,
single-room edits, telemetry token rotation) do NOT snapshot — those
are runtime/control-plane writes outside the operator-aligned change-
control surface this module provides.

Atomicity scope
---------------
The lock + fsync sequence guarantees atomicity against:
  (a) process crash mid-snapshot — temp file is removed on raise;
  (b) concurrent in-process writers — singleton threading.Lock.

It does NOT guarantee atomicity against out-of-process writers
(HA Supervisor's backup-restore tooling, manual file edits via the
Supervisor file editor, or any sidecar tool that mutates qsh.yaml
without going through QSH's API). Such writes are best-effort: the
snapshot reflects whatever was on disk at fsync time.

Single-process deployment assumption
------------------------------------
threading.Lock covers a single Python process. QSH's HA addon runs as a
single-worker uvicorn process. If QSH ever moves to multi-worker
(gunicorn, uvicorn --workers > 1), this lock silently fails to serialise
across workers; the upgrade path is fcntl.flock on a sentinel file.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

from qsh import paths as _paths
from qsh.api.secrets_paths import is_secret_path

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants — resolved against qsh.paths so tests can monkeypatch.
# ---------------------------------------------------------------------------

# Snapshot files live alongside qsh.yaml. Resolution at call time keeps
# tests that override qsh.paths.YAML_PATH working without threading the
# path through every public entry point.
SNAPSHOT_DIRNAME = "snapshots"
SNAPSHOT_FILENAME_PREFIX = "qsh.yaml.bak."
SNAPSHOT_TMP_SUFFIX = ".tmp"

DEFAULT_RETENTION = 5
MIN_RETENTION = 2
MAX_RETENTION = 50

# Process-wide lock. ALL public mutating entry points acquire this exactly
# once; private _locked helpers assume the lock is held.
_SNAPSHOT_WRITE_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SnapshotCaptureError(Exception):
    """Raised when capture fails for any reason other than missing source.

    Callers MUST abort the pending write — the snapshot is the
    operator's recovery affordance and a write that can't be reverted
    is a write that shouldn't land.
    """


class SourceMissingError(SnapshotCaptureError):
    """Raised when the source qsh.yaml does not exist.

    Distinguished from generic SnapshotCaptureError so first-boot
    callers (wizard deploy, backup restore on a fresh install) can
    catch and proceed without snapshot.
    """


class SnapshotNotFoundError(Exception):
    """Raised when a named snapshot id does not resolve to a file."""


class SnapshotRevertError(Exception):
    """Raised when revert fails after the pre-revert snapshot was captured."""


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Snapshot:
    """Metadata for a single captured snapshot."""

    snapshot_id: str          # ISO-8601 UTC with colons preserved
    captured_at: float        # unix epoch
    path: Path                # absolute path to .bak file
    size_bytes: int
    trigger_path: str         # settings_patch | wizard_deploy | backup_restore | schedule_write | pre_revert


@dataclass(frozen=True)
class DiffEntry:
    """One change between snapshot and current config.

    is_secret is server-side resolved against
    qsh.api.secrets_paths.SECRETS_PATHS. Secret values are NOT redacted
    in `old`/`new` (per V2 review HIGH-03-V2 owner directive — operators
    making revert decisions need value visibility).
    """

    path: str
    old: object | None
    new: object | None
    is_secret: bool = False
    added: bool = False
    removed: bool = False
    type_change: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_config_path(source_path: Optional[str] = None) -> Path:
    """Return the qsh.yaml path. Falls back to qsh.paths.YAML_PATH when
    no override is supplied. Resolution at call time so tests that
    monkeypatch qsh.paths.YAML_PATH pick up the override."""
    if source_path is not None:
        return Path(source_path)
    return Path(_paths.YAML_PATH)


def _resolve_snapshot_dir(source_path: Optional[str] = None) -> Path:
    """Return the snapshot directory (sibling of qsh.yaml)."""
    return _resolve_config_path(source_path).parent / SNAPSHOT_DIRNAME


def _now_iso8601_utc() -> str:
    """ISO-8601 UTC with microseconds and Z suffix, colons preserved."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _ensure_snapshot_dir(snap_dir: Path) -> None:
    """Create the snapshot directory with 0700 permissions if missing."""
    snap_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(snap_dir, 0o700)
    except OSError:
        # Non-fatal — tests on systems without permission support skip this.
        pass


def _fsync_file(fd: int) -> None:
    """Flush a file descriptor to physical storage. Tolerate platforms
    where fsync is a no-op (rare; documented for the test fault-injection
    surface)."""
    try:
        os.fsync(fd)
    except OSError as exc:
        # Surface as SnapshotCaptureError — caller aborts the write.
        raise SnapshotCaptureError(f"fsync failed: {exc}") from exc


def _fsync_dir(path: Path) -> None:
    """fsync the parent directory so the rename is durable.

    On macOS / some filesystems opening a directory for write is not
    permitted; use O_RDONLY which is sufficient for fsync to flush
    directory metadata.
    """
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError as exc:
        raise SnapshotCaptureError(f"open dir for fsync failed: {exc}") from exc
    try:
        try:
            os.fsync(fd)
        except OSError as exc:
            raise SnapshotCaptureError(f"dir fsync failed: {exc}") from exc
    finally:
        os.close(fd)


def _read_retention_from_config(source_path: Optional[str] = None) -> int:
    """Read config_snapshot.retention_count from the live qsh.yaml.

    Defaults to DEFAULT_RETENTION; clamped to [MIN_RETENTION, MAX_RETENTION].
    Failures (file missing, parse error) fall back to the default — never
    raise from this helper so capture remains resilient.
    """
    cfg_path = _resolve_config_path(source_path)
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        if not isinstance(raw, dict):
            return DEFAULT_RETENTION
        section = raw.get("config_snapshot") or {}
        if not isinstance(section, dict):
            return DEFAULT_RETENTION
        value = section.get("retention_count", DEFAULT_RETENTION)
        try:
            n = int(value)
        except (TypeError, ValueError):
            return DEFAULT_RETENTION
        return max(MIN_RETENTION, min(MAX_RETENTION, n))
    except (OSError, yaml.YAMLError):
        return DEFAULT_RETENTION


def _list_snapshot_files(snap_dir: Path) -> list[Path]:
    """Return all .bak files in the snapshot directory, excluding .tmp."""
    if not snap_dir.is_dir():
        return []
    out: list[Path] = []
    for entry in snap_dir.iterdir():
        if not entry.is_file():
            continue
        name = entry.name
        if not name.startswith(SNAPSHOT_FILENAME_PREFIX):
            continue
        if name.endswith(SNAPSHOT_TMP_SUFFIX):
            continue
        out.append(entry)
    return out


def _snapshot_from_path(snap_path: Path, trigger_path: str = "") -> Snapshot:
    """Construct a Snapshot dataclass from a file path. Trigger label is
    passed in by the caller for fresh captures; for files discovered via
    list, trigger_path is unknown and recorded as empty."""
    name = snap_path.name
    snapshot_id = name[len(SNAPSHOT_FILENAME_PREFIX):]
    try:
        st = snap_path.stat()
        captured_at = st.st_mtime
        size_bytes = st.st_size
    except OSError:
        captured_at = 0.0
        size_bytes = 0
    return Snapshot(
        snapshot_id=snapshot_id,
        captured_at=captured_at,
        path=snap_path,
        size_bytes=size_bytes,
        trigger_path=trigger_path,
    )


def _resolve_snapshot_path(snapshot_id: str, snap_dir: Path) -> Path:
    """Map a snapshot_id to its file path. Validates that the path stays
    inside the snapshot directory (no '../' tricks)."""
    if "/" in snapshot_id or "\\" in snapshot_id or ".." in snapshot_id:
        raise SnapshotNotFoundError(f"Invalid snapshot id: {snapshot_id!r}")
    candidate = snap_dir / f"{SNAPSHOT_FILENAME_PREFIX}{snapshot_id}"
    try:
        resolved = candidate.resolve()
        if resolved.parent != snap_dir.resolve():
            raise SnapshotNotFoundError(f"Snapshot id resolves outside dir: {snapshot_id!r}")
    except OSError as exc:
        raise SnapshotNotFoundError(f"Cannot resolve snapshot id {snapshot_id!r}: {exc}") from exc
    if not candidate.is_file():
        raise SnapshotNotFoundError(f"Snapshot not found: {snapshot_id!r}")
    return candidate


# ---------------------------------------------------------------------------
# Public API — each acquires _SNAPSHOT_WRITE_LOCK exactly once.
# ---------------------------------------------------------------------------


def snapshot_capture(
    trigger_path: str,
    source_path: Optional[str] = None,
) -> Snapshot:
    """Atomically snapshot the current qsh.yaml.

    Args:
        trigger_path: Audit label, one of:
            settings_patch | wizard_deploy | backup_restore |
            schedule_write | pre_revert.
        source_path: Optional explicit path to the YAML file being
            snapshotted. When None, resolves to qsh.paths.YAML_PATH at
            call time. Callers that have already resolved a path (e.g.,
            via the YAML search list) MUST pass it here so the snapshot
            captures the same file the impending write will mutate.

    Returns:
        Snapshot for the file just captured.

    Raises:
        SourceMissingError: qsh.yaml does not exist (e.g., first-boot
            wizard deploy). Caller decides whether to abort or proceed.
        SnapshotCaptureError: any other failure. Caller MUST abort the
            pending write.
    """
    with _SNAPSHOT_WRITE_LOCK:
        return _capture_locked(trigger_path, source_path=source_path)


def snapshot_list() -> list[Snapshot]:
    """Return snapshots sorted newest-first.

    Acquires the lock briefly so the directory scan does not race a
    capture/revert/purge in flight (which could surface a partial state).
    """
    with _SNAPSHOT_WRITE_LOCK:
        return _list_locked()


def snapshot_diff(snapshot_id: str) -> list[DiffEntry]:
    """Diff the named snapshot against the current qsh.yaml.

    Returns the list of DiffEntry — secret-bearing rows are flagged with
    `is_secret=True` but values are NOT redacted (per V2 review owner
    directive option (a)).

    Raises:
        SnapshotNotFoundError: snapshot_id does not exist.
    """
    # No lock held — this is a read-only operation. The snapshot file is
    # immutable once written, and the live qsh.yaml read tolerates a
    # transient inconsistent read (rare; will simply produce a slightly
    # stale diff that the operator can refresh).
    snap_dir = _resolve_snapshot_dir()
    snap_path = _resolve_snapshot_path(snapshot_id, snap_dir)
    cfg_path = _resolve_config_path()

    snap_yaml = _load_yaml_or_empty(snap_path)
    cur_yaml = _load_yaml_or_empty(cfg_path)
    return _diff_dicts(snap_yaml, cur_yaml)


def snapshot_revert(snapshot_id: str) -> tuple[Snapshot, Snapshot]:
    """Atomically restore the named snapshot to qsh.yaml.

    Captures the about-to-be-overwritten current config as a pre-revert
    snapshot first, so manual reverts are themselves reversible.

    Args:
        snapshot_id: Target snapshot's id.

    Returns:
        (restored_from, pre_revert_snapshot) — restored_from is the
        snapshot whose contents were copied onto qsh.yaml;
        pre_revert_snapshot is the new snapshot capturing the pre-revert
        state (operator can revert the revert by selecting it).

    Raises:
        SnapshotNotFoundError: snapshot_id does not exist.
        SnapshotCaptureError: pre-revert capture failed.
        SnapshotRevertError: file restore failed after pre-revert
            capture succeeded.
    """
    with _SNAPSHOT_WRITE_LOCK:
        # Pre-revert capture FIRST so the revert is reversible.
        pre_revert = _capture_locked("pre_revert")
        try:
            restored_from = _revert_locked(snapshot_id)
        except (SnapshotNotFoundError, SnapshotRevertError):
            # Pre-revert was captured but restore failed; the snapshot
            # is already on disk (operator can use it manually).
            raise
        logger.info(
            "module=config_snapshot event=reverted_manual "
            "snapshot_id=%s pre_revert_snapshot_id=%s",
            restored_from.snapshot_id,
            pre_revert.snapshot_id,
        )
        return restored_from, pre_revert


def snapshot_purge() -> int:
    """Delete all snapshots from the snapshot directory.

    Returns:
        Count of files deleted.
    """
    with _SNAPSHOT_WRITE_LOCK:
        return _purge_locked()


# ---------------------------------------------------------------------------
# Private API — assume _SNAPSHOT_WRITE_LOCK is held by caller.
# ---------------------------------------------------------------------------


def _capture_locked(
    trigger_path: str, source_path: Optional[str] = None,
) -> Snapshot:
    """Lock must be held. Performs the atomic-capture sequence."""
    cfg_path = _resolve_config_path(source_path)
    snap_dir = _resolve_snapshot_dir(source_path)

    if not cfg_path.is_file():
        raise SourceMissingError(f"Source config does not exist: {cfg_path}")

    _ensure_snapshot_dir(snap_dir)

    snapshot_id = _now_iso8601_utc()
    final_name = f"{SNAPSHOT_FILENAME_PREFIX}{snapshot_id}"
    final_path = snap_dir / final_name
    tmp_path = snap_dir / f"{final_name}{SNAPSHOT_TMP_SUFFIX}"

    try:
        # Read source bytes. open + fsync source FD ensures we capture a
        # consistent view (assuming no out-of-process writer is racing).
        with open(cfg_path, "rb") as src:
            _fsync_file(src.fileno())
            data = src.read()

        # Write temp file, fsync it, rename atomically, fsync parent dir.
        # mkstemp would be marginally safer but produces an opaque random
        # name — predictable .tmp suffix is intentional for the listing
        # filter.
        try:
            with open(tmp_path, "wb") as dst:
                dst.write(data)
                dst.flush()
                _fsync_file(dst.fileno())
            try:
                os.chmod(tmp_path, 0o600)
            except OSError:
                pass
            os.rename(tmp_path, final_path)
            _fsync_dir(snap_dir)
        except (OSError, SnapshotCaptureError):
            # Clean up the temp file on any failure so it does not
            # appear in subsequent listings.
            try:
                if tmp_path.exists():
                    os.remove(tmp_path)
            except OSError:
                pass
            raise

        retention = _read_retention_from_config(source_path)
        _retain_last_n_locked(retention, source_path=source_path)

        snap = _snapshot_from_path(final_path, trigger_path=trigger_path)
        logger.info(
            "module=config_snapshot event=captured "
            "snapshot_id=%s trigger_path=%s size_bytes=%d",
            snap.snapshot_id, trigger_path, snap.size_bytes,
        )
        return snap

    except SourceMissingError:
        raise
    except SnapshotCaptureError:
        logger.error(
            "module=config_snapshot event=capture_failed trigger_path=%s",
            trigger_path,
        )
        raise
    except OSError as exc:
        logger.error(
            "module=config_snapshot event=capture_failed trigger_path=%s error=%r",
            trigger_path, exc,
        )
        raise SnapshotCaptureError(f"Capture failed: {exc}") from exc


def _list_locked() -> list[Snapshot]:
    """Lock must be held. Returns Snapshots sorted newest-first by mtime."""
    snap_dir = _resolve_snapshot_dir()
    files = _list_snapshot_files(snap_dir)
    snaps = [_snapshot_from_path(p) for p in files]
    snaps.sort(key=lambda s: s.captured_at, reverse=True)
    return snaps


def _revert_locked(snapshot_id: str) -> Snapshot:
    """Lock must be held. Restores the named snapshot onto qsh.yaml."""
    snap_dir = _resolve_snapshot_dir()
    snap_path = _resolve_snapshot_path(snapshot_id, snap_dir)
    cfg_path = _resolve_config_path()

    tmp_cfg = cfg_path.with_suffix(cfg_path.suffix + ".reverttmp")
    try:
        # Copy snapshot bytes to a temp file alongside qsh.yaml, fsync,
        # then atomic rename. fsync the parent dir to flush the rename.
        shutil.copyfile(snap_path, tmp_cfg)
        with open(tmp_cfg, "rb+") as f:
            _fsync_file(f.fileno())
        os.rename(tmp_cfg, cfg_path)
        _fsync_dir(cfg_path.parent)
    except (OSError, SnapshotCaptureError) as exc:
        try:
            if tmp_cfg.exists():
                os.remove(tmp_cfg)
        except OSError:
            pass
        raise SnapshotRevertError(f"Revert failed: {exc}") from exc

    return _snapshot_from_path(snap_path, trigger_path="")


def _purge_locked() -> int:
    """Lock must be held. Deletes all snapshot files."""
    snap_dir = _resolve_snapshot_dir()
    if not snap_dir.is_dir():
        return 0
    count = 0
    for entry in list(snap_dir.iterdir()):
        if not entry.is_file():
            continue
        name = entry.name
        if not name.startswith(SNAPSHOT_FILENAME_PREFIX):
            continue
        try:
            entry.unlink()
            count += 1
        except OSError as exc:
            logger.warning(
                "module=config_snapshot event=purge_skip path=%s error=%r",
                entry, exc,
            )
    logger.info("module=config_snapshot event=purged count=%d", count)
    return count


def _retain_last_n_locked(
    n: int, source_path: Optional[str] = None,
) -> None:
    """Lock must be held. Prune oldest snapshots beyond retention.

    Robust to filename parse failures: any file that cannot be stat'd is
    logged and skipped rather than raising.
    """
    snap_dir = _resolve_snapshot_dir(source_path)
    files = _list_snapshot_files(snap_dir)
    if len(files) <= n:
        return
    # Sort by mtime ascending (oldest first), keep newest n.
    try:
        files.sort(key=lambda p: p.stat().st_mtime)
    except OSError as exc:
        logger.warning(
            "module=config_snapshot event=retain_stat_failed error=%r",
            exc,
        )
        return
    to_delete = files[: len(files) - n]
    for victim in to_delete:
        try:
            victim.unlink()
        except OSError as exc:
            logger.warning(
                "module=config_snapshot event=retain_delete_failed "
                "path=%s error=%r",
                victim, exc,
            )


# ---------------------------------------------------------------------------
# Diff implementation — recursive dict/list comparison.
# ---------------------------------------------------------------------------


def _load_yaml_or_empty(path: Path) -> dict:
    """Load YAML; return {} on any read or parse failure (diff is best-
    effort and must not raise on degraded inputs)."""
    try:
        with open(path, "rb") as f:
            data = yaml.safe_load(f) or {}
        return data if isinstance(data, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}


def _diff_dicts(old: dict, new: dict) -> list[DiffEntry]:
    """Compute the diff between two YAML configs as a flat list of
    DiffEntry, using dotted paths for keys and bracket notation for list
    indices."""
    out: list[DiffEntry] = []
    _walk_diff(old, new, prefix=[], out=out)
    return out


def _walk_diff(old, new, *, prefix: list, out: list[DiffEntry]) -> None:
    """Recursively diff two values. Prefix accumulates the path as
    a list of (key | int) tokens; converted to dotted form at leaf
    emission."""
    if _is_dict(old) and _is_dict(new):
        keys = sorted(set(old.keys()) | set(new.keys()))
        for k in keys:
            child_prefix = prefix + [k]
            if k not in old:
                _emit_added(child_prefix, new[k], out)
            elif k not in new:
                _emit_removed(child_prefix, old[k], out)
            else:
                _walk_diff(old[k], new[k], prefix=child_prefix, out=out)
        return

    if _is_list(old) and _is_list(new):
        old_len = len(old)
        new_len = len(new)
        common = min(old_len, new_len)
        for i in range(common):
            child_prefix = prefix + [i]
            _walk_diff(old[i], new[i], prefix=child_prefix, out=out)
        for i in range(common, new_len):
            _emit_added(prefix + [i], new[i], out)
        for i in range(common, old_len):
            _emit_removed(prefix + [i], old[i], out)
        return

    # Leaf compare.
    if old == new:
        return
    path = _dotted_path(prefix)
    type_change = type(old) is not type(new) and old is not None and new is not None
    out.append(DiffEntry(
        path=path,
        old=old,
        new=new,
        is_secret=is_secret_path(path),
        type_change=type_change,
    ))


def _emit_added(prefix: list, value, out: list[DiffEntry]) -> None:
    """Recursively flatten an added subtree into added DiffEntry rows."""
    if _is_dict(value):
        for k, v in value.items():
            _emit_added(prefix + [k], v, out)
        return
    if _is_list(value):
        for i, v in enumerate(value):
            _emit_added(prefix + [i], v, out)
        return
    path = _dotted_path(prefix)
    out.append(DiffEntry(
        path=path,
        old=None,
        new=value,
        is_secret=is_secret_path(path),
        added=True,
    ))


def _emit_removed(prefix: list, value, out: list[DiffEntry]) -> None:
    """Recursively flatten a removed subtree into removed DiffEntry rows."""
    if _is_dict(value):
        for k, v in value.items():
            _emit_removed(prefix + [k], v, out)
        return
    if _is_list(value):
        for i, v in enumerate(value):
            _emit_removed(prefix + [i], v, out)
        return
    path = _dotted_path(prefix)
    out.append(DiffEntry(
        path=path,
        old=value,
        new=None,
        is_secret=is_secret_path(path),
        removed=True,
    ))


def _is_dict(value) -> bool:
    return isinstance(value, dict)


def _is_list(value) -> bool:
    # YAML can also produce tuples in unusual cases; treat as list-like.
    return isinstance(value, (list, tuple))


def _dotted_path(tokens: list) -> str:
    """Convert path tokens to dotted notation with [N] for indices."""
    parts: list[str] = []
    for tok in tokens:
        if isinstance(tok, int):
            if not parts:
                parts.append(f"[{tok}]")
            else:
                parts[-1] = parts[-1] + f"[{tok}]"
        else:
            parts.append(str(tok))
    return ".".join(parts)


# ---------------------------------------------------------------------------
# Convenience for routes/state — exposed so the API can surface retention
# without re-reading the file in every endpoint.
# ---------------------------------------------------------------------------


def get_retention_count() -> int:
    """Return the active retention count (clamped). Public read."""
    return _read_retention_from_config()


__all__ = [
    "DEFAULT_RETENTION",
    "MIN_RETENTION",
    "MAX_RETENTION",
    "DiffEntry",
    "Snapshot",
    "SnapshotCaptureError",
    "SnapshotNotFoundError",
    "SnapshotRevertError",
    "SourceMissingError",
    "get_retention_count",
    "snapshot_capture",
    "snapshot_diff",
    "snapshot_list",
    "snapshot_purge",
    "snapshot_revert",
]


# Keep referenced imports alive — Optional is part of the public type
# documentation in the module docstring even though the public surface
# uses tuple unions internally.
_ = Optional
