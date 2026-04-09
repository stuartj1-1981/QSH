"""Backup/Restore — export and import QSH state."""

import os
import json
import time
import logging
import copy
from io import BytesIO
from zipfile import ZipFile

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/backup", tags=["backup"])

# State file paths
STATE_FILES = {
    "qsh.yaml": ["/config/qsh.yaml", "/data/qsh.yaml"],
    "sysid_state.json": ["/config/sysid_state.json", "/data/sysid_state.json"],
    "qsh_state.json": ["/config/qsh_state.json", "/data/qsh_state.json"],
    "schedule_state.json": ["/config/schedule_state.json", "/data/schedule_state.json"],
}


def _find_file(candidates: list) -> str:
    """Find the first existing path from candidates."""
    for path in candidates:
        if os.path.isfile(path):
            return path
    return candidates[0]


@router.get("/export")
def export_backup():
    """Export a ZIP containing qsh.yaml, sysid_state.json, qsh_state.json."""
    buffer = BytesIO()
    with ZipFile(buffer, "w") as zf:
        for filename, paths in STATE_FILES.items():
            filepath = _find_file(paths)
            if os.path.isfile(filepath):
                zf.write(filepath, filename)
            else:
                logger.warning("Backup: %s not found at any path", filename)

        meta = {
            "exported_at": time.time(),
            "version": "2.0",
        }
        zf.writestr("backup_meta.json", json.dumps(meta, indent=2))

    buffer.seek(0)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=qsh_backup_{timestamp}.zip"
        },
    )


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    mode: str = Query("merge"),
):
    """Restore from a backup ZIP.

    Two modes:
      - 'merge': Keep best per-room sysid observations (non-destructive).
      - 'replace': Full overwrite of state files. DESTRUCTIVE.

    Does NOT overwrite qsh.yaml in either mode.
    """
    if mode not in ("merge", "replace"):
        raise HTTPException(status_code=400, detail="Mode must be 'merge' or 'replace'")

    contents = await file.read()
    try:
        zf = ZipFile(BytesIO(contents))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    restored = []

    if mode == "replace":
        for filename in ("sysid_state.json", "qsh_state.json", "schedule_state.json"):
            if filename in zf.namelist():
                target = _find_file(STATE_FILES[filename])
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "wb") as f:
                    f.write(zf.read(filename))
                restored.append(filename)
                logger.info("Restore (replace): wrote %s", target)

    elif mode == "merge":
        # schedule_state.json: always fully replaced (user intent, not accumulated learning)
        if "schedule_state.json" in zf.namelist():
            target_path = _find_file(STATE_FILES["schedule_state.json"])
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, "wb") as f:
                f.write(zf.read("schedule_state.json"))
            restored.append("schedule_state.json")
            logger.info("Restore (merge): replaced schedule_state.json")

            # Warn about orphan schedule rooms not in current config
            try:
                schedule_data = json.loads(zf.read("schedule_state.json"))
                schedule_rooms = set(schedule_data.get("rooms", {}).keys())
                # Try to read current qsh.yaml config rooms
                for yaml_path in STATE_FILES.get("qsh.yaml", []):
                    if os.path.isfile(yaml_path):
                        import yaml
                        with open(yaml_path) as yf:
                            cfg = yaml.safe_load(yf) or {}
                        config_rooms = set(cfg.get("rooms", {}).keys())
                        orphans = schedule_rooms - config_rooms
                        if orphans:
                            logger.warning(
                                "Restored schedule_state.json contains rooms not in current config: %s",
                                sorted(orphans),
                            )
                        break
            except Exception:
                pass  # Best-effort warning

        if "sysid_state.json" in zf.namelist():
            backup_sysid = json.loads(zf.read("sysid_state.json"))
            target_path = _find_file(STATE_FILES["sysid_state.json"])

            if os.path.isfile(target_path):
                with open(target_path, "r") as f:
                    current_sysid = json.load(f)
                merged = _merge_sysid(current_sysid, backup_sysid)
            else:
                merged = backup_sysid

            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, "w") as f:
                json.dump(merged, f, indent=2)
            restored.append("sysid_state.json (merged)")
            logger.info("Restore (merge): merged sysid_state.json")

    # Signal restart to reload state
    try:
        with open("/config/qsh_restart_requested", "w") as f:
            f.write("1")
    except OSError:
        pass

    return {
        "mode": mode,
        "restored": restored,
        "message": f"Restore ({mode}) complete. Pipeline restarting...",
    }


def _merge_sysid(current: dict, backup: dict) -> dict:
    """Merge sysid state, keeping best observations per room."""
    merged = copy.deepcopy(current)
    current_rooms = current.get("rooms", {})
    backup_rooms = backup.get("rooms", {})

    for room_name, backup_data in backup_rooms.items():
        if room_name not in current_rooms:
            merged.setdefault("rooms", {})[room_name] = backup_data
            continue

        current_data = current_rooms[room_name]

        def _obs_count(d):
            return (
                d.get("u_observations", 0)
                + d.get("c_observations", 0)
                + d.get("pc_fits", 0)
            )

        if _obs_count(backup_data) > _obs_count(current_data):
            merged["rooms"][room_name] = backup_data

    return merged
