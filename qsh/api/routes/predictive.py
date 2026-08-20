"""Predictive occupancy API routes — per-room learner report (INSTRUCTION-478A)."""

from fastapi import APIRouter

from ..state import shared_state

router = APIRouter()


@router.get("/predictive")
def get_predictive():
    """Return the full predictive-occupancy report for all rooms."""
    predictor = shared_state.get_predictive()
    if predictor is None:
        return {"error": "Predictive occupancy not yet initialised", "rooms": {}}
    return predictor.report()
