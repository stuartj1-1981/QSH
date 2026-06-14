"""Health check endpoint."""

import logging
import time

from fastapi import APIRouter

from ..state import shared_state
from qsh.version import read_addon_version
from qsh.utils import (
    get_local_tz,
    get_local_tz_source,
    is_rl_temporal_feature_migration_first_boot,
)

router = APIRouter()


# INSTRUCTION-320 Task 1: the version reader was lifted verbatim into
# qsh/version.py so the swarm layer can read it without an api → swarm import.
# read_addon_version() returns Optional[str]; the "unknown" sentinel is applied
# here so the /health response shape is unchanged (behaviour identical per-process
# — the add-on version is process-lifetime-stable, container-replaced on update).
_ADDON_VERSION = read_addon_version() or "unknown"
logging.info("health: addon_version=%s", _ADDON_VERSION)


@router.get("/health")
def health_check():
    """Simple health check — confirms API is running and pipeline is feeding data."""
    snap = shared_state.get_snapshot()
    age = time.time() - snap.timestamp if snap.timestamp > 0 else -1
    driver = shared_state.get_driver_status()
    if driver["status"] == "error":
        overall = "error"
    elif 0 < age < 120:
        overall = "ok"
    else:
        overall = "degraded"
    return {
        "status": overall,
        "pipeline_age_seconds": round(age, 1),
        "cycle_number": snap.cycle_number,
        "api_version": "0.1.0",
        "addon_version": _ADDON_VERSION,
        # INSTRUCTION-252 — operator triage surface for "schedule is off by an
        # hour" reports. local_timezone is the resolved IANA name; source names
        # which step of the precedence chain won (supervisor/config/env/default).
        # rl_temporal_feature_migration is True only on the first boot post-fix.
        "local_timezone": str(get_local_tz()),
        "local_timezone_source": get_local_tz_source(),
        "rl_temporal_feature_migration": is_rl_temporal_feature_migration_first_boot(),
        "driver": driver,
    }
