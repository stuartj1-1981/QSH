"""Trends API routes — serves per-metric trend data from TrendBuffer."""

from fastapi import APIRouter, Query
from typing import Optional

from ..trends import trend_buffer

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("")
def get_trends(
    metric: str = Query(..., description="Metric name (e.g. outdoor_temp, temp, valve)"),
    hours: float = Query(default=24, ge=1, le=168),
    room: Optional[str] = Query(default=None, description="Room name for per-room metrics"),
):
    """Return trend points for a single metric.

    GET /api/trends?metric=outdoor_temp&hours=24
    GET /api/trends?metric=temp&room=lounge&hours=12
    """
    points = trend_buffer.query(metric=metric, hours=hours, room=room)
    return {
        "metric": metric,
        "room": room,
        "points": points,
    }
