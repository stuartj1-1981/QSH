"""Historian API routes — InfluxDB query access for historical trend analysis."""

from fastapi import APIRouter, Query
from typing import List, Optional

from ...historian import get_historian

router = APIRouter(prefix="/historian", tags=["historian"])


def _get_active_historian():
    """Get historian or return error dict."""
    h = get_historian()
    if h is None or not h.is_active:
        return None
    return h


@router.get("/measurements")
def list_measurements():
    """List available InfluxDB measurements and their fields.

    GET /api/historian/measurements
    """
    h = _get_active_historian()
    if h is None:
        return {
            "available": False,
            "message": "Historian not configured. Enable in qsh.yaml historian section.",
            "measurements": [],
        }

    measurements = h.get_measurements()
    result = []
    for m in measurements:
        fields = h.get_fields(m)
        result.append({"name": m, "fields": fields})

    return {"available": True, "measurements": result}


@router.get("/query")
def query_historian(
    measurement: str = Query(..., description="InfluxDB measurement name"),
    field: str = Query(..., description="Field name(s), comma-separated"),
    room: Optional[str] = Query(default=None, description="Room tag filter"),
    time_from: str = Query(default="-24h", alias="from", description="Start time (e.g. -24h, -7d)"),
    time_to: str = Query(default="now()", alias="to", description="End time"),
    interval: str = Query(default="5m", description="Aggregation interval"),
    aggregation: str = Query(default="mean", description="Aggregation function (mean, max, min)"),
):
    """Query historical data from InfluxDB.

    GET /api/historian/query?measurement=qsh_room&field=temperature&room=lounge&from=-7d&to=now()&interval=5m
    """
    h = _get_active_historian()
    if h is None:
        return {
            "error": "Historian not configured. Enable in qsh.yaml historian section.",
            "points": [],
        }

    fields = [f.strip() for f in field.split(",")]
    return h.query(
        measurement=measurement,
        fields=fields,
        time_from=time_from,
        time_to=time_to,
        room=room,
        aggregation=aggregation,
        interval=interval,
    )


@router.get("/tags")
def list_tags(
    measurement: str = Query(..., description="InfluxDB measurement name"),
):
    """List tag values for a measurement (primarily room names).

    GET /api/historian/tags?measurement=qsh_room
    """
    h = _get_active_historian()
    if h is None:
        return {"available": False, "tags": {}}

    tags = h.get_tags(measurement)
    return {"available": True, "tags": tags}


@router.get("/fields")
def list_fields(
    measurement: str = Query(..., description="InfluxDB measurement name"),
):
    """List field keys for a measurement.

    GET /api/historian/fields?measurement=qsh_system
    """
    h = _get_active_historian()
    if h is None:
        return {"available": False, "fields": []}

    fields = h.get_fields(measurement)
    return {"available": True, "fields": fields}
