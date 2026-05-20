"""Health check endpoint."""

import json
import logging
import time
from pathlib import Path

from fastapi import APIRouter

from ..state import shared_state
from qsh.utils import (
    get_local_tz,
    get_local_tz_source,
    is_rl_temporal_feature_migration_first_boot,
)

router = APIRouter()


def _read_addon_version() -> str:
    # COUPLING: this candidate list mirrors the target paths in:
    #   - quantum_swarm_heating/Dockerfile        (COPY config.json /config.json)
    #   - quantum_swarm_heating/Dockerfile.public (COPY config.json /app/config.json)
    # If either Dockerfile is changed, update this list in lockstep, or
    # the addon will silently fall back to the "unknown" sentinel.
    candidates = [
        # Dev mode: quantum_swarm_heating/qsh/api/routes/health.py
        # parents[3] is the addon source root (where config.json lives).
        Path(__file__).resolve().parents[3] / "config.json",
        # Dockerfile.public: qsh/ copied to /app/qsh/, config.json → /app/
        Path("/app/config.json"),
        # Dockerfile (local build): qsh/ copied to /qsh, config.json → /
        Path("/config.json"),
    ]
    for cfg in candidates:
        try:
            if cfg.is_file():
                version = json.loads(cfg.read_text()).get("version")
                if version:
                    return str(version)
        except Exception:  # noqa: BLE001 — truly defensive, any failure falls through
            continue
    return "unknown"


_ADDON_VERSION = _read_addon_version()
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
