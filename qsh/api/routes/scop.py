"""SCOP API route — mode-resolved seasonal CoP over configurable windows.

Computes SCOP = Σ thermal_kWh / Σ electrical_kWh over a window for one of
combined / CH (space heat) / HW (hot water). Combined and HW are Riemann
sums of the per-cycle power fields against qsh_system and qsh_dhw
respectively, via Historian.sum_field_as_kwh() (SUM × _CYCLE_HOURS).
CH is derived arithmetically: ch_thermal = combined_thermal - hw_thermal,
ch_electrical = combined_electrical - hw_electrical. The Riemann form
(rather than InfluxQL INTEGRAL) is required because qsh_dhw is a sparse
series — it writes only on DHW-active cycles, and INTEGRAL would
linearly-interpolate phantom kWh across HP-off intervals between DHW
cycles (see INSTRUCTION-191C V2 §Background for worked example).

INSTRUCTION-191C — depends on INSTRUCTION-191A's qsh_dhw measurement.
"""

from datetime import datetime, time as dt_time
from typing import Tuple, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, HTTPException

from ...historian import get_historian

router = APIRouter(prefix="/scop", tags=["scop"])

VALID_WINDOWS = {"today", "7d", "30d", "90d", "season"}
VALID_MODES = {"combined", "ch", "hw"}

THERMAL_FIELD = "active_source_thermal_output_kw"
ELECTRICAL_FIELD = "hp_power_kw"


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


def _deploy_date_in_window(historian, time_from: str) -> bool:
    """Return True if the configured 191A deploy date falls inside the window.

    Used by the frontend to render a data-quality watermark on long-window
    charts where pre-191A blended data is being subtracted from post-191A
    qsh_dhw data, biasing CH SCOP downward in proportion to pre-191A DHW
    share.
    """
    cfg = getattr(historian, "_config", None) or {}
    deploy_iso = cfg.get("instruction_191a_deploy_date")
    if not deploy_iso:
        return False  # config not yet annotated; assume no boundary issue
    try:
        deploy_dt = datetime.fromisoformat(deploy_iso)
    except ValueError:
        return False

    if time_from.startswith("-"):
        return False  # rolling windows; assume always recent enough
    try:
        from_dt = datetime.fromisoformat(time_from)
    except ValueError:
        return False
    # Compare naive-vs-aware safely: drop tz if either side is naive.
    if (deploy_dt.tzinfo is None) != (from_dt.tzinfo is None):
        deploy_dt = deploy_dt.replace(tzinfo=None)
        from_dt = from_dt.replace(tzinfo=None)
    return from_dt < deploy_dt


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
          "data_quality": { "deploy_date_in_window": bool }
        }

        available=false when the historian is disabled or the install is
        not a heat pump. scop is null when the bucket has no data or the
        electrical denominator is zero.
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

    # Combined integrals from qsh_system
    combined_th = h.sum_field_as_kwh("qsh_system", THERMAL_FIELD, time_from, time_to)
    combined_el = h.sum_field_as_kwh("qsh_system", ELECTRICAL_FIELD, time_from, time_to)

    if mode == "combined":
        scop = _safe_div(combined_th, combined_el)
        thermal = combined_th or 0.0
        electrical = combined_el or 0.0

    elif mode == "hw":
        hw_th = h.sum_field_as_kwh("qsh_dhw", THERMAL_FIELD, time_from, time_to)
        hw_el = h.sum_field_as_kwh("qsh_dhw", ELECTRICAL_FIELD, time_from, time_to)
        scop = _safe_div(hw_th, hw_el)
        thermal = hw_th or 0.0
        electrical = hw_el or 0.0

    else:  # mode == "ch"
        hw_th = h.sum_field_as_kwh("qsh_dhw", THERMAL_FIELD, time_from, time_to) or 0.0
        hw_el = h.sum_field_as_kwh("qsh_dhw", ELECTRICAL_FIELD, time_from, time_to) or 0.0
        ch_th = (combined_th or 0.0) - hw_th
        ch_el = (combined_el or 0.0) - hw_el
        # Negative results indicate clock-skew or out-of-order ingestion;
        # clamp to zero and let scop go to None via _safe_div's denom check.
        ch_th = max(0.0, ch_th)
        ch_el = max(0.0, ch_el)
        scop = _safe_div(ch_th, ch_el)
        thermal = ch_th
        electrical = ch_el

    return {
        "available": True,
        "window": window,
        "mode": mode,
        "window_start": time_from,
        "window_end": time_to,
        "scop": round(scop, 3) if scop is not None else None,
        "thermal_kwh": round(thermal, 2),
        "electrical_kwh": round(electrical, 2),
        "data_quality": {
            "deploy_date_in_window": _deploy_date_in_window(h, time_from),
        },
    }
