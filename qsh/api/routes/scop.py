"""SCOP API route — mode-resolved seasonal CoP over configurable windows.

Computes SCOP = Σ thermal_kWh / Σ electrical_kWh over a window for one of
combined / CH (space heat) / HW (hot water). All three modes integrate
against qsh_system. CH and HW filter on the `hw_active` tag set by
historian.py at sample time (INSTRUCTION-215).

INSTRUCTION-273 — replaces the INSTRUCTION-191C arithmetic-subtraction
derivation and the qsh_dhw parallel measurement. The arithmetic path was
sensitive to write-gate asymmetry between qsh_system and qsh_dhw, and the
parallel measurement is retired in the same instruction.
"""

from datetime import datetime, time as dt_time, timedelta
from typing import Tuple, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, HTTPException

from ...historian import get_historian

router = APIRouter(prefix="/scop", tags=["scop"])

VALID_WINDOWS = {"today", "7d", "30d", "90d", "season"}
VALID_MODES = {"combined", "ch", "hw"}

THERMAL_FIELD = "active_source_thermal_output_kw"
ELECTRICAL_FIELD = "hp_power_kw"

# INSTRUCTION-300 coverage gate: a small grace absorbs sample-timing jitter
# at the window-start boundary when comparing the earliest thermal sample
# against the resolved window start.
COVERAGE_GRACE = timedelta(minutes=5)


def resolve_window(window: str, tz_name: str = "Europe/London") -> Tuple[str, str]:
    """Resolve a window enum to (time_from, time_to) for InfluxQL.

    See INSTRUCTION-191C Task 2 for the full spec.
    """
    if window not in VALID_WINDOWS:
        raise ValueError(f"unknown window: {window!r}")

    tz = ZoneInfo(tz_name)
    now_local = datetime.now(tz)

    if window == "today":
        midnight = datetime.combine(now_local.date(), dt_time.min, tzinfo=tz)
        return midnight.isoformat(), "now()"

    if window in {"7d", "30d", "90d"}:
        return f"-{window}", "now()"

    # season
    year = now_local.year
    sep1 = datetime(
        year if now_local.month >= 9 else year - 1,
        9, 1, tzinfo=tz,
    )
    return sep1.isoformat(), "now()"


def resolve_window_start_dt(
    window: str, tz_name: str = "Europe/London"
) -> datetime:
    """Resolve a window enum to its absolute start as a tz-aware datetime.

    Sibling to ``resolve_window`` (which returns InfluxQL-relative strings
    like ``"-90d"``). The INSTRUCTION-300 coverage gate needs the concrete
    start *instant* to compare against the earliest thermal-instrumented
    sample, so this returns a ``datetime`` rather than a query fragment.
    ``resolve_window`` is intentionally left unchanged.
    """
    if window not in VALID_WINDOWS:
        raise ValueError(f"unknown window: {window!r}")

    tz = ZoneInfo(tz_name)
    now_local = datetime.now(tz)

    if window == "today":
        return datetime.combine(now_local.date(), dt_time.min, tzinfo=tz)

    if window in {"7d", "30d", "90d"}:
        return now_local - timedelta(days=int(window[:-1]))

    # season — same 1 Sep boundary resolve_window computes.
    year = now_local.year
    return datetime(
        year if now_local.month >= 9 else year - 1,
        9, 1, tzinfo=tz,
    )


def _get_active_historian():
    h = get_historian()
    if h is None or not h.is_active:
        return None
    return h


def _safe_div(num: Optional[float], den: Optional[float]) -> Optional[float]:
    if num is None or den is None:
        return None
    if den <= 0.0:
        return None
    return num / den


def _config_tz(historian) -> str:
    """Pull installation_tz from the historian's stored config; default UK."""
    cfg = getattr(historian, "_config", None) or {}
    return cfg.get("installation_tz", "Europe/London")


@router.get("")
def get_scop(
    window: str = Query("30d", description="today | 7d | 30d | 90d | season"),
    mode: str = Query("combined", description="combined | ch | hw"),
):
    """GET /api/scop?window=30d&mode=ch

    Returns:
        {
          "available": bool,
          "window": str,
          "mode": str,
          "window_start": ISO datetime,
          "window_end": ISO datetime or "now()",
          "scop": float | null,
          "thermal_kwh": float,
          "electrical_kwh": float,
          "coverage_complete": bool,
          "data_start": ISO datetime | null
        }

        available=false when the historian is disabled or the install is
        not a heat pump. scop is null when the bucket has no data, the
        electrical denominator is zero, or (INSTRUCTION-300) the window is
        not yet fully thermal-instrumented — i.e. the earliest recorded
        thermal sample is later than the window start. In that case
        coverage_complete is false and data_start carries the earliest
        thermal-sample time (or null if the field has never been recorded);
        thermal_kwh / electrical_kwh remain the factual partial-window sums.
    """
    if window not in VALID_WINDOWS:
        raise HTTPException(400, f"invalid window: {window!r}")
    if mode not in VALID_MODES:
        raise HTTPException(400, f"invalid mode: {mode!r}")

    h = _get_active_historian()
    if h is None:
        return {
            "available": False,
            "message": "Historian not configured.",
            "window": window,
            "mode": mode,
        }

    cfg = getattr(h, "_config", None) or {}
    if cfg.get("active_source_type") not in (None, "heat_pump"):
        return {
            "available": False,
            "message": "SCOP is HP-specific. Active source is not a heat pump.",
            "window": window,
            "mode": mode,
        }

    tz_name = _config_tz(h)
    try:
        time_from, time_to = resolve_window(window, tz_name)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # INSTRUCTION-300 coverage gate: SCOP reads null until the system has
    # been thermal-instrumented for the whole window. If the earliest
    # recorded thermal sample is later than the window start (within a small
    # grace), the data does not cover the full nominal span, so the ratio is
    # suppressed (a number over a shorter-than-labelled span is more
    # misleading than no number). `earliest is None` (field never recorded
    # or historian unreachable) is the fail-safe null case.
    earliest = h.earliest_field_time("qsh_system", THERMAL_FIELD)
    start_dt = resolve_window_start_dt(window, tz_name)
    coverage_complete = (
        earliest is not None and earliest <= start_dt + COVERAGE_GRACE
    )

    # Combined integrals from qsh_system. require_field pins numerator and
    # denominator to the same cycle set — the points that recorded a thermal
    # reading — so the electrical denominator cannot be inflated by HP-on
    # cycles that wrote hp_power_kw but no active_source_thermal_output_kw.
    combined_th = h.sum_field_as_kwh(
        "qsh_system", THERMAL_FIELD, time_from, time_to,
        require_field=THERMAL_FIELD,
    )
    combined_el = h.sum_field_as_kwh(
        "qsh_system", ELECTRICAL_FIELD, time_from, time_to,
        require_field=THERMAL_FIELD,
    )

    if mode == "combined":
        scop = _safe_div(combined_th, combined_el)
        thermal = combined_th or 0.0
        electrical = combined_el or 0.0

    elif mode == "hw":
        hw_th = h.sum_field_as_kwh(
            "qsh_system", THERMAL_FIELD, time_from, time_to,
            hw_active="true", require_field=THERMAL_FIELD,
        )
        hw_el = h.sum_field_as_kwh(
            "qsh_system", ELECTRICAL_FIELD, time_from, time_to,
            hw_active="true", require_field=THERMAL_FIELD,
        )
        scop = _safe_div(hw_th, hw_el)
        thermal = hw_th or 0.0
        electrical = hw_el or 0.0

    else:  # mode == "ch"
        ch_th = h.sum_field_as_kwh(
            "qsh_system", THERMAL_FIELD, time_from, time_to,
            hw_active="false", require_field=THERMAL_FIELD,
        )
        ch_el = h.sum_field_as_kwh(
            "qsh_system", ELECTRICAL_FIELD, time_from, time_to,
            hw_active="false", require_field=THERMAL_FIELD,
        )
        scop = _safe_div(ch_th, ch_el)
        thermal = ch_th or 0.0
        electrical = ch_el or 0.0

    # Coverage gate: suppress the ratio when the window is not fully
    # instrumented. thermal_kwh / electrical_kwh remain the factual
    # partial-window sums; only scop is nulled.
    scop_out = round(scop, 3) if scop is not None else None
    if not coverage_complete:
        scop_out = None

    return {
        "available": True,
        "window": window,
        "mode": mode,
        "window_start": time_from,
        "window_end": time_to,
        "scop": scop_out,
        "thermal_kwh": round(thermal, 2),
        "electrical_kwh": round(electrical, 2),
        "coverage_complete": coverage_complete,
        "data_start": earliest.isoformat() if earliest is not None else None,
    }
