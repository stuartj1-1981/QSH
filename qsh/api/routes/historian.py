"""Historian API routes — InfluxDB query access for historical trend analysis."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from ...config import HOUSE_CONFIG
from ...historian import get_historian
from ...qsdb.backfill import CutoverRefused
from ...qsdb.mirror import MirrorRefused
from ...qsdb.sql import SqlError

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
    hw_active: Optional[str] = Query(default=None, description="Optional 'true'/'false' filter on hw_active tag (qsh_system only)"),
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
        hw_active=hw_active,
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


class CutoverBody(BaseModel):
    force: bool = False


@router.get("/migration")
def migration_status():
    """Migration state plus the configured/effective backend beside it.

    GET /api/historian/migration

    Deliberately NOT gated on ``is_active`` (INSTRUCTION-505D T6, M2) — an
    install in ``shadow`` with a dead source has ``is_active`` false and
    must still report.
    """
    h = get_historian()
    if h is None:
        return {
            "state": "none",
            "backend": HOUSE_CONFIG.get("historian", {}).get("backend", "influxdb"),
            "available": False,
        }
    return h.migration_status()


@router.post("/migration/cutover")
def request_cutover(body: CutoverBody):
    """Cut over from InfluxDB to the qsdb store.

    POST /api/historian/migration/cutover
    Body: {"force": bool = False}

    Reads the puller's last enumeration only — never queries the source
    (M2) — so a dead source answers a forced POST at once with an
    "unknown" gap.
    """
    h = get_historian()
    if h is None:
        raise HTTPException(status_code=503, detail="historian not configured")
    try:
        return h.request_cutover(body.force)
    except CutoverRefused as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "cutover refused",
                "unreconciled_days": exc.unreconciled,
                "source_last_error": exc.last_error,
            },
        )


@router.get("/store")
def store_stats():
    """Store health and migration progress — Historian.get_stats() whole.

    GET /api/historian/store

    NOT gated on is_active, for /migration's reason (INSTRUCTION-505D M2):
    a shadow install with a dead source is exactly the one whose store
    state must still be readable.
    """
    h = get_historian()
    if h is None:
        return {"historian": False, "store": False, "stats": None}
    # INSTRUCTION-510A M2 — TWO flags, because they are two properties and the
    # consumer needs the second. `get_historian() is None` means no Historian
    # at all; it says nothing about the store. A backend: influxdb install HAS
    # a Historian and NO store, and that is the class 510B's whole degradation
    # design exists for. get_stats() fills the store keys with None there.
    return {"historian": True, "store": h.store_present, "stats": h.get_stats()}


@router.get("/days")
def sealed_days(
    measurement: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    """The sealed-day manifest, capped and paginated.

    GET /api/historian/days?measurement=&limit=&offset=
    """
    h = get_historian()
    if h is None or not h.store_present:
        return {"historian": h is not None, "store": False,
                "days": [], "total": 0, "truncated": False}
    return {"historian": True, "store": True, **h.sealed_days(measurement, limit, offset)}


@router.get("/parity")
def parity(day: Optional[str] = Query(None)):
    """Parity-report index, or one day's report.

    GET /api/historian/parity            -> {"days": ["2026-09-04", ...]}
    GET /api/historian/parity?day=...    -> the report
    400 on a malformed day; 404 on a day with no report.
    """
    h = get_historian()
    # INSTRUCTION-510A R11 — the `day` split comes FIRST. A request that named
    # a day is answered about that day, whatever the server's state: the
    # degraded branch below is the INDEX's degraded branch, not the route's.
    # Returning the index shape to a caller who asked for one report is the
    # key-presence discrimination commitment 2 exists to prevent, arriving
    # through the request instead of through the response.
    if day is not None:
        try:
            parsed = date.fromisoformat(day)
        except ValueError:
            raise HTTPException(400, f"malformed day: {day!r}")
        report = h.parity_report(parsed) if (h is not None and h.store_present) else None
        if report is None:
            raise HTTPException(404, {"historian": h is not None,
                                      "store": h is not None and h.store_present,
                                      "day": parsed.isoformat()})
        return {"historian": True, "store": True, "day": parsed.isoformat(),
                "report": report}
    if h is None or not h.store_present:
        return {"historian": h is not None, "store": False, "days": []}
    return {"historian": True, "store": True, "days": h.parity_reports()}


# =============================================================================
# INSTRUCTION-505E T5 — tier 1 (`/sql`) and tier 2 (`/mirror`, `/mirror/backfill`).
#
# Every handler below reaches `get_historian()` directly, never
# `_get_active_historian()`: an install in `shadow` whose InfluxDB is down
# has `is_active` False and a running store, and tier 1 must still answer.
# All through public members only — `Historian.sql` is what says 503 when
# there is no store at all.
# =============================================================================


class SqlBody(BaseModel):
    q: str


def _sql_response(q: str):
    h = get_historian()
    if h is None:
        return JSONResponse(status_code=503, content={"error": "historian not configured"})
    try:
        return h.sql(q)
    except SqlError as exc:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})


@router.get("/sql")
def sql_get(q: str = Query(..., description="A single read-only SELECT statement")):
    """GET /api/historian/sql?q=SELECT ..."""
    return _sql_response(q)


@router.post("/sql")
def sql_post(body: SqlBody):
    """POST /api/historian/sql — body: {"q": "SELECT ..."}"""
    return _sql_response(body.q)


@router.get("/mirror")
def mirror_status():
    """GET /api/historian/mirror — never carries the mirror's credentials
    (Historian.mirror_status's own discharge boundary, OB-E2)."""
    h = get_historian()
    if h is None:
        return JSONResponse(status_code=503, content={"error": "historian not configured"})
    return h.mirror_status()


class MirrorBackfillBody(BaseModel):
    since: Optional[str] = None


@router.post("/mirror/backfill")
def mirror_backfill(body: MirrorBackfillBody):
    """POST /api/historian/mirror/backfill — body: {"since": "YYYY-MM-DD"}

    Refused (409) before cutover, with no mirror enabled, or with a run
    already in progress (commitment 7's three refusals, MirrorRefused).
    """
    h = get_historian()
    if h is None:
        return JSONResponse(status_code=503, content={"error": "historian not configured"})
    since = date.fromisoformat(body.since) if body.since else None
    try:
        status = h.request_mirror_backfill(since)
    except MirrorRefused as exc:
        return JSONResponse(status_code=409, content={"error": str(exc)})
    return JSONResponse(status_code=202, content=status)
