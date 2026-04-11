"""Comfort schedule API — global time-of-day comfort temperature targets."""

import logging
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/comfort-schedule", tags=["comfort-schedule"])


class ComfortPeriod(BaseModel):
    """A single comfort schedule period.

    Uses Field(alias=...) because "from" is a Python reserved word.
    Pydantic v2 style (FastAPI 0.115.0 ships with Pydantic v2).
    """
    model_config = ConfigDict(populate_by_name=True)

    from_time: str = Field(alias="from")   # "HH:MM"
    to_time: str = Field(alias="to")       # "HH:MM"
    temp: float


class ComfortScheduleBody(BaseModel):
    enabled: bool
    periods: List[ComfortPeriod]


class ComfortScheduleEnabledBody(BaseModel):
    enabled: bool


@router.get("")
def get_comfort_schedule():
    """Return current comfort schedule."""
    from qsh.occupancy.comfort_schedule import get_comfort_schedule_store
    cs = get_comfort_schedule_store()
    data = cs.get()
    active = cs.resolve()
    return {**data, "active_temp": active}


@router.put("")
def set_comfort_schedule(body: ComfortScheduleBody):
    """Replace the entire comfort schedule."""
    from qsh.occupancy.comfort_schedule import get_comfort_schedule_store
    cs = get_comfort_schedule_store()

    periods = [
        {"from": p.from_time, "to": p.to_time, "temp": p.temp}
        for p in body.periods
    ]

    try:
        cs.set(body.enabled, periods)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    active = cs.resolve()
    return {**cs.get(), "active_temp": active}


@router.patch("/enabled")
def toggle_comfort_schedule(body: ComfortScheduleEnabledBody):
    """Enable or disable the comfort schedule without changing periods."""
    from qsh.occupancy.comfort_schedule import get_comfort_schedule_store
    cs = get_comfort_schedule_store()
    cs.set_enabled(body.enabled)
    return cs.get()
