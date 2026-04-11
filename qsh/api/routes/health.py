"""Health check endpoint."""

import time

from fastapi import APIRouter

from ..state import shared_state

router = APIRouter()


@router.get("/health")
def health_check():
    """Simple health check — confirms API is running and pipeline is feeding data."""
    snap = shared_state.get_snapshot()
    age = time.time() - snap.timestamp if snap.timestamp > 0 else -1
    return {
        "status": "ok" if 0 < age < 120 else "degraded",
        "pipeline_age_seconds": round(age, 1),
        "cycle_number": snap.cycle_number,
        "api_version": "0.1.0",
    }
