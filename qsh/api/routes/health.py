"""Health check endpoint."""

import json
import time
from pathlib import Path

from fastapi import APIRouter

from ..state import shared_state

router = APIRouter()


def _read_addon_version() -> str:
    try:
        # routes → api → qsh → quantum_swarm_heating (where config.json lives).
        # If Nuitka scope expands to include API routes, __file__ resolution
        # changes silently — re-verify parents[N] at that point.
        cfg = Path(__file__).resolve().parents[3] / "config.json"
        return json.loads(cfg.read_text()).get("version", "unknown")
    except Exception:
        return "unknown"


_ADDON_VERSION = _read_addon_version()


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
        "driver": driver,
    }
