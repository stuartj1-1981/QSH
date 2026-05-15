"""Operator MANUAL/AUTO override for direct-TRV positions (INSTRUCTION-225C).

REST surface backed by the in-memory ``qsh.manual_state`` module. Driver-
agnostic: PUT dispatches via the IODriver Protocol ``apply_manual_position``
method that 225A landed for HADriver / MockDriver and 225B landed for
MQTTDriver. The same handlers serve all three; the API contract is
load-bearing-equal across drivers (see test_manual_routes_driver_parity).
"""

from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from qsh import manual_state
from qsh.config import HOUSE_CONFIG
from ..state import shared_state

router = APIRouter(prefix="/manual", tags=["manual"])

logger = logging.getLogger(__name__)


class ManualPutBody(BaseModel):
    mode: Literal["AUTO", "MANUAL"]
    position_pct: Optional[int] = Field(default=None, ge=0, le=100)
    set_by: str = Field(default="api", max_length=64)
    # V3 D2: caller identity propagates to manual_state for audit. Default "api"
    # covers direct curl and unauthenticated callers. The frontend sends
    # "engineering_ui" explicitly. Free-form per parent §2.1 — no enum
    # constraint, so future callers (HA automations, scripts) can supply
    # their own identifier.


class ManualEntryOut(BaseModel):
    room: str
    mode: Literal["AUTO", "MANUAL"]
    position_pct: Optional[int]
    set_by: str
    set_at: float
    hardware_type: str


def _entry_out(room: str, config: dict) -> ManualEntryOut:
    entry = manual_state.get(room)
    return ManualEntryOut(
        room=room,
        mode=entry.mode,
        position_pct=entry.position_pct,
        set_by=entry.set_by,
        set_at=entry.set_at,
        hardware_type=config.get("room_valve_hardware", {}).get(room, "generic"),
    )


@router.get("")
def list_manual_state() -> list[ManualEntryOut]:
    """List MANUAL/AUTO state for every configured direct-TRV room."""
    config = HOUSE_CONFIG
    rooms = manual_state.configured_direct_rooms(config)
    return [_entry_out(r, config) for r in rooms]


@router.put("/{room}")
def put_manual(room: str, body: ManualPutBody) -> ManualEntryOut:
    """Set room MANUAL or AUTO.

    MANUAL requires position_pct in [0, 100]. Best-effort immediate driver
    dispatch on MANUAL — sub-cycle latency when the driver supports it.
    Driver-dispatch failure is non-fatal: the manual_state mutation has
    already landed in memory and the next pipeline cycle re-asserts.
    """
    config = HOUSE_CONFIG
    direct = manual_state.configured_direct_rooms(config)
    if room not in direct:
        raise HTTPException(
            status_code=404, detail=f"Room '{room}' is not a configured direct TRV"
        )

    if body.mode == "MANUAL":
        if body.position_pct is None:
            raise HTTPException(
                status_code=422, detail="position_pct is required when mode == MANUAL"
            )
        manual_state.set_manual(room, body.position_pct, set_by=body.set_by)
        # V3 N2: explicit driver-None guard. SharedState.driver_ref may be
        # unwired during the brief startup window before main.py registers.
        driver = shared_state.get_driver()
        if driver is not None:
            try:
                driver.apply_manual_position(room, body.position_pct, config)
            except Exception as e:  # noqa: BLE001 — fire-and-forget, log only
                logger.warning(
                    "Immediate MANUAL dispatch failed for %s: %s", room, e
                )
    else:  # AUTO
        # V3 / 225A V4 G2: set_by trimmed; AUTO audit lives in API call logs.
        manual_state.set_auto(room)

    return _entry_out(room, config)


@router.delete("/{room}")
def delete_manual(room: str) -> ManualEntryOut:
    """Return the room to AUTO (supervisory control)."""
    config = HOUSE_CONFIG
    direct = manual_state.configured_direct_rooms(config)
    if room not in direct:
        raise HTTPException(
            status_code=404, detail=f"Room '{room}' is not a configured direct TRV"
        )
    manual_state.set_auto(room)
    return _entry_out(room, config)
