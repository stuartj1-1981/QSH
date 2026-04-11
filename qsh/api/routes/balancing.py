"""Balancing API routes — per-zone balance report and notification toggle."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..state import shared_state

router = APIRouter()


class NotificationToggle(BaseModel):
    disabled: bool


@router.get("/balancing")
def get_balancing():
    """Return the full balance report for all rooms."""
    detector = shared_state.get_balancing()
    if detector is None:
        return {"error": "Balancing detector not yet initialised", "rooms": {}}
    return detector.get_balance_report()


@router.patch("/balancing/{room}/notifications")
def toggle_notification(room: str, body: NotificationToggle):
    """Enable or disable balancing notifications for a room."""
    detector = shared_state.get_balancing()
    if detector is None:
        raise HTTPException(status_code=503, detail="Balancing detector not yet initialised")

    if room not in detector.room_states:
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    control_mode = detector.config.get("room_control_mode", {}).get(room, "indirect")
    if control_mode == "direct":
        raise HTTPException(
            status_code=400,
            detail=f"Room '{room}' uses direct control (auto-balanced) — notifications not applicable",
        )

    detector.set_notification_disabled(room, body.disabled)
    return {"room": room, "notification_disabled": body.disabled}
