"""M&V savings-ledger API routes (INSTRUCTION-403).

Two read-only GET routes exposing the INSTRUCTION-402 accumulator:

  GET /api/mv          — engine status + rolling summary.
  GET /api/mv/report   — per-day rows (JSON default, CSV with ?format=csv) —
                          the artefact for an M&V submission appendix.

Startup race guard mirrors the Balancing precedent: GET degrades gracefully
(HTTP 200 with a `not_initialised` shape) before main.py wires the accumulator
reference after API server start.
"""

import csv
import io

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..state import shared_state

router = APIRouter()

# Per-day report columns (order fixed — the CSV header + JSON key order).
_REPORT_COLUMNS = [
    "date", "kwh_baseline", "kwh_actual", "gbp_baseline", "gbp_actual",
    "gbp_delta", "gbp_claimable", "deficit_baseline_degh", "deficit_actual_degh",
    "parity_ok", "coverage", "shadow", "model_error_mean_kwh",
]


@router.get("/mv")
def get_mv():
    """Engine status + rolling 30-day summary. Degrades gracefully pre-wire."""
    acc = shared_state.get_mv()
    if acc is None:
        return {
            "enabled": False,
            "engine_state": "idle",
            "idle_reason": "not_initialised",
            "coverage": None,
            "defaults_in_use": False,
            "summary": None,
        }
    status = acc.status()
    status["summary"] = acc.summary(30)
    return status


@router.get("/mv/report")
def get_mv_report(
    days: int = Query(30, description="Number of most-recent days to return"),
    format: str = Query("json", description="'json' (default) or 'csv'"),
):
    """Per-day ledger rows. `days` is 422'd below 1; the upper clamp to
    retention_days lives inside MVAccumulator.report() (which owns the config
    value — no config reach from the route layer)."""
    if days < 1:
        raise HTTPException(status_code=422, detail="days must be >= 1")

    acc = shared_state.get_mv()
    rows = acc.report(days) if acc is not None else []

    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_REPORT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k) for k in _REPORT_COLUMNS})
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=mv_report.csv"},
        )

    # JSON: project to the report column set (drops summary-only fields like RMS).
    return {"rows": [{k: r.get(k) for k in _REPORT_COLUMNS} for r in rows]}
