"""History API routes — serves trend data from the in-memory ring buffer."""

from fastapi import APIRouter, Query
from typing import List, Optional

from ..history import cycle_history

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
def get_history(
    hours: float = Query(default=24, ge=1, le=168),
    metrics: Optional[str] = Query(default=None),
):
    """Return cycle history for trend charts.

    GET /api/history?hours=24&metrics=applied_flow,hp_cop,total_demand
    """
    metric_list = [m.strip() for m in metrics.split(",")] if metrics else None
    entries = cycle_history.query(hours, metric_list)
    return {"hours": hours, "entries": entries}


@router.get("/rooms")
def get_room_history(
    hours: float = Query(default=24, ge=1, le=168),
    fields: Optional[str] = Query(default=None),
):
    """Return per-room history for room trend charts.

    GET /api/history/rooms?hours=24&fields=temp,valve
    """
    field_list = [f.strip() for f in fields.split(",")] if fields else None
    rooms = cycle_history.query_rooms(hours, field_list)
    return {"hours": hours, "rooms": rooms}
