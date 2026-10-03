"""DFAN forecast extension — REST endpoints.

INSTRUCTION-208A V2 / parent INSTRUCTION-208.

Backend support for the Forecast Extension WebUX page:
  - GET   /api/forecast/feature-flags
  - PATCH /api/forecast/feature-flags/{controller}/{room}
  - GET   /api/forecast/cutover-gates
  - GET   /api/forecast/fallback-counts

V1 HIGH-2 resolution — feature flags are display-only at this backend
contract. PATCH persists and updates live config, but NO consumer
controller reads config["forecast_features"][controller][room] in the
post-208A code base. Per-feature enforcement deferred.

V1 LOW resolution — PATCH emits a qsh_event historian point per flip.
V2 LOW — first PATCH per process emits a WARN reminder of the
display-only scope so operators reading logs see it regardless of frontend.
V2 MEDIUM-1 — per-cycle TTL cache on the cutover-gates endpoint.
V2 MEDIUM-2 — composite-confidence gate consumes the public
ForecastHistoryStore.iter_observations accessor (no private access).
"""

import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


FORECAST_AWARE_CONTROLLERS: Tuple[str, ...] = (
    "recovery_scheduler",
    "shoulder_controller",
    "tariff_optimiser",
    "valve_controller",
    "flow_controller",
    "rl",
)

# INSTRUCTION-565C — the tags read with each reconciliation row, and the
# records a weather class needs before its p95 counts in the error gate.
_RECON_TAGS: Tuple[str, ...] = ("controller", "room", "oat_class", "solar_class", "wind_class")
_ERROR_GATE_MIN_SAMPLES = 5

# V2 LOW — process-restart-once WARN flag (module-scoped).
_first_patch_warn_emitted: bool = False


def _reset_first_patch_warn_flag_for_test() -> None:
    """Test-only: reset the module-level WARN flag."""
    global _first_patch_warn_emitted
    _first_patch_warn_emitted = False


class FeatureFlagPatch(BaseModel):
    enabled: bool = Field(...)


@router.get("/feature-flags")
def get_feature_flags():
    """Read all per-(controller, room) feature flags + master_enable."""
    from qsh.api.state import shared_state

    config = shared_state.get_config() or {}
    master_enable = bool(config.get("forecast_extension_master_enable", False))
    forecast_features = config.get("forecast_features", {}) or {}
    rooms = sorted((config.get("rooms", {}) or {}).keys())

    flags: Dict[str, Dict[str, bool]] = {}
    for controller in FORECAST_AWARE_CONTROLLERS:
        controller_flags = forecast_features.get(controller, {}) or {}
        flags[controller] = {}
        for room in rooms:
            flags[controller][room] = bool(controller_flags.get(room, False))
        flags[controller]["_global"] = bool(controller_flags.get("_global", False))

    return {
        "master_enable": master_enable,
        "flags": flags,
        "rooms": rooms,
        "deferred_enforcement_note": (
            "Per-controller × per-room feature flags persist to config but "
            "do NOT gate runtime behaviour as of INSTRUCTION-208A. Per-feature "
            "consumer-side enforcement deferred to a future instruction."
        ),
    }


@router.patch("/feature-flags/{controller}/{room}")
def patch_feature_flag(controller: str, room: str, body: FeatureFlagPatch):
    """Toggle one per-(controller, room) feature flag.

    Persists to qsh.yaml under forecast_features.<controller>.<room>.
    V1 LOW: emits a qsh_event point on every flip.
    V2 LOW: emits a process-restart-once WARN reminder.
    V2 MEDIUM-1: invalidates the cutover-gate cache.
    """
    if controller not in FORECAST_AWARE_CONTROLLERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown controller '{controller}'. "
                f"Allowed: {list(FORECAST_AWARE_CONTROLLERS)}"
            ),
        )

    from qsh.api.state import shared_state
    from qsh.api.routes.config import read_modify_write

    config_pre = shared_state.get_config() or {}
    old_value = bool(
        (config_pre.get("forecast_features", {}) or {})
        .get(controller, {})
        .get(room, False)
    )

    def _apply(raw: dict) -> dict:
        ff = raw.setdefault("forecast_features", {})
        controller_section = ff.setdefault(controller, {})
        controller_section[room] = body.enabled
        return raw

    try:
        read_modify_write(_apply)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist feature flag: {exc}",
        )

    # Live config update.
    config = shared_state.get_config()
    if config is not None:
        ff = config.setdefault("forecast_features", {})
        controller_section = ff.setdefault(controller, {})
        controller_section[room] = body.enabled

    # V1 LOW — qsh_event audit-log emission.
    try:
        from qsh.historian import get_historian
        historian = get_historian()
        if historian is not None and getattr(historian, "is_active", False):
            historian.record_event(
                event_type="forecast_feature_flag_change",
                fields={
                    "controller": controller,
                    "room": room,
                    "old_value": old_value,
                    "new_value": body.enabled,
                    "source": "webux_operator_action",
                },
            )
    except Exception as exc:
        logger.warning(
            "Failed to emit qsh_event audit-log for flag flip "
            "(controller=%s, room=%s): %s", controller, room, exc,
        )

    # V2 MEDIUM-1 — invalidate cutover-gate cache on flag flip.
    try:
        from qsh.api.cutover_gate_tracker import get_cutover_gate_tracker
        get_cutover_gate_tracker().invalidate_cache()
    except Exception as exc:
        logger.debug("Failed to invalidate cutover-gate cache on PATCH: %s", exc)

    # V2 LOW — process-restart-once WARN reminder.
    global _first_patch_warn_emitted
    if not _first_patch_warn_emitted:
        logger.warning(
            "INSTRUCTION-208A V2 LOW: per-feature flag '%s.%s' set to %s via WebUX. "
            "Note: per-controller × per-room flags are display-only as of 208A; "
            "per-feature consumer-side enforcement deferred to a future instruction. "
            "Operators reading server logs see this notice once per process restart.",
            controller, room, body.enabled,
        )
        _first_patch_warn_emitted = True

    return {
        "controller": controller,
        "room": room,
        "old_value": old_value,
        "new_value": body.enabled,
        "audit_logged": True,
    }


@router.get("/cutover-gates")
def get_cutover_gates(window_cycles: int = 168):
    """Returns the cutover-gate status per (controller, scope) per design §6.2."""
    from qsh.api.state import shared_state
    from qsh.forecast_history import get_default_store as _get_history_store
    from qsh.api.cutover_gate_tracker import get_cutover_gate_tracker

    config = shared_state.get_config() or {}
    rooms = sorted((config.get("rooms", {}) or {}).keys())
    cycles_required = int(config.get("forecast_cutover_window_cycles", 168))
    error_threshold_c = float(config.get("forecast_cutover_error_threshold_c", 1.0))
    c_maturity_threshold = float(
        config.get("forecast_cutover_c_maturity_threshold", 0.7)
    )
    c_historical_threshold = float(
        config.get("forecast_cutover_c_historical_threshold", 0.5)
    )
    cycle_period_s = float(config.get("update_interval_s", 300))

    tracker = get_cutover_gate_tracker()
    now_ts = time.time()
    cached = tracker.get_cached_gates(now_ts, cycle_period_s)
    if cached is not None:
        return cached

    sysid_state = shared_state.get_sysid()
    history_store = _get_history_store()
    snapshot = shared_state.get_snapshot()
    # INSTRUCTION-565C — one reconciliation read per uncached computation,
    # shared by every (controller, scope) error gate below.
    recon_rows = _read_reconciliation_rows(window_cycles, cycle_period_s) or []

    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for controller in FORECAST_AWARE_CONTROLLERS:
        out[controller] = {}
        scopes = list(rooms) + ["_global"]
        for scope in scopes:
            out[controller][scope] = _compute_one_gate(
                controller=controller,
                scope=scope,
                rooms=rooms,
                cycles_required=cycles_required,
                error_threshold_c=error_threshold_c,
                c_maturity_threshold=c_maturity_threshold,
                c_historical_threshold=c_historical_threshold,
                window_cycles=window_cycles,
                sysid_state=sysid_state,
                history_store=history_store,
                snapshot=snapshot,
                recon_rows=recon_rows,
            )

    response = {
        "window_cycles": window_cycles,
        "cycles_required": cycles_required,
        "gates": out,
    }
    tracker.set_cached_gates(now_ts, response)
    return response


def _compute_one_gate(
    *,
    controller: str, scope: str, rooms: List[str],
    cycles_required: int, error_threshold_c: float,
    c_maturity_threshold: float, c_historical_threshold: float,
    window_cycles: int, sysid_state, history_store, snapshot,
    recon_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Single (controller, scope) gate evaluation per design §6.2."""
    from qsh.api.cutover_gate_tracker import get_cutover_gate_tracker

    p95_error, error_gate_pass = _evaluate_prediction_error_gate(
        controller, scope, error_threshold_c, window_cycles, history_store,
        rows=recon_rows,
    )
    comfort_excursions, comfort_gate_pass = _evaluate_comfort_gate(
        controller, scope, window_cycles, history_store, snapshot,
    )
    c_mat, c_hist_min, conf_gate_pass = _evaluate_composite_confidence_gate(
        controller, scope, rooms, c_maturity_threshold, c_historical_threshold,
        sysid_state, history_store,
    )
    twin_drift_flagged, twin_gate_pass = _evaluate_twin_gate(scope, snapshot)

    all_pass = bool(
        error_gate_pass and comfort_gate_pass and conf_gate_pass and twin_gate_pass
    )
    tracker = get_cutover_gate_tracker()
    cycles_holding = tracker.cycles_holding(controller, scope, all_pass)
    cutover_eligible = all_pass and (cycles_holding >= cycles_required)

    return {
        "prediction_error_p95_c": p95_error,
        "prediction_error_p95_threshold_c": error_threshold_c,
        "prediction_error_gate_pass": error_gate_pass,
        "comfort_excursions_attributable": comfort_excursions,
        "comfort_gate_pass": comfort_gate_pass,
        "c_maturity": c_mat,
        "c_maturity_threshold": c_maturity_threshold,
        "c_historical_min_observed": c_hist_min,
        "c_historical_threshold": c_historical_threshold,
        "composite_confidence_gate_pass": conf_gate_pass,
        "twin_drift_flagged": twin_drift_flagged,
        "twin_gate_pass": twin_gate_pass,
        "all_gates_pass": all_pass,
        "cycles_holding": cycles_holding,
        "cycles_required": cycles_required,
        "cutover_eligible": cutover_eligible,
        "rationale": _gate_rationale(
            error_gate_pass, comfort_gate_pass, conf_gate_pass, twin_gate_pass,
            cycles_holding, cycles_required,
            error_no_data=(p95_error is None),
        ),
    }


# ============================================================
# V1 HIGH-1 — concrete gate helpers; no NotImplementedError stubs.
# ============================================================

def _read_reconciliation_rows(
    window_cycles: int, cycle_period_s: float,
) -> Optional[List[Dict[str, Any]]]:
    """The qsh_forecast_reconciliation rows of the window, each with its
    error_c and the tags in _RECON_TAGS (INSTRUCTION-565C).

    The window is window_cycles x cycle_period_s seconds, the comfort
    gate's span. Returns None when no historian is active, or when the read
    raises, returns something other than a dict, or returns an "error" key;
    each of the last three logs one WARNING.
    """
    from qsh.historian import get_historian

    historian = get_historian()
    if historian is None or not getattr(historian, "is_active", False):
        return None

    try:
        response = historian.read_events(
            "qsh_forecast_reconciliation",
            ["error_c"],
            list(_RECON_TAGS),
            time_from=f"-{int(window_cycles * cycle_period_s)}s",
            time_to="now()",
        )
        if not isinstance(response, dict):
            raise TypeError(f"response is a {type(response).__name__}, not a dict")
        if "error" in response:
            raise RuntimeError(response["error"])
        return list(response.get("rows") or [])
    except Exception as exc:
        logger.warning("_read_reconciliation_rows: historian read failed: %s", exc)
        return None


def _evaluate_prediction_error_gate(
    controller: str, scope: str, threshold_c: float, window_cycles: int,
    history_store,
    *, rows: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[Optional[float], bool]:
    """Reports the worst weather class's p95 of |error_c| for (controller,
    scope) against threshold_c, as INSTRUCTION-208A designed the gate.

    Its rows are the qsh_forecast_reconciliation records of the comfort
    gate's window (window_cycles x update_interval_s seconds), read once per
    uncached computation by get_cutover_gates and passed in, or read here
    when rows is None, which the owner's widening of the read contract on
    30 September 2026 made possible (INSTRUCTION-565C). A row counts when
    its controller and room match, its three class tags (oat, solar, wind)
    are not all unknown, and its error_c is a finite int or float, not a
    bool; the weather class is that triple. Each class with at least
    _ERROR_GATE_MIN_SAMPLES records takes numpy's default linear p95, and
    the gate returns (worst, worst <= threshold_c), or (None, False) when no
    class qualifies or the historian is not readable.
    """
    if rows is None:
        from qsh.api.state import shared_state

        config = shared_state.get_config() or {}
        rows = _read_reconciliation_rows(
            window_cycles, float(config.get("update_interval_s", 300)),
        )
        if rows is None:
            return (None, False)

    errors_by_class: Dict[Tuple[Any, ...], List[float]] = {}
    for row in rows:
        if row.get("controller") != controller or row.get("room") != scope:
            continue
        weather_class = (
            row.get("oat_class"), row.get("solar_class"), row.get("wind_class"),
        )
        if weather_class == ("unknown", "unknown", "unknown"):
            continue
        error_c = row.get("error_c")
        if isinstance(error_c, bool) or not isinstance(error_c, (int, float)):
            continue
        if not math.isfinite(error_c):
            continue
        errors_by_class.setdefault(weather_class, []).append(abs(error_c))

    class_p95s = [
        float(np.percentile(values, 95))
        for values in errors_by_class.values()
        if len(values) >= _ERROR_GATE_MIN_SAMPLES
    ]
    if not class_p95s:
        return (None, False)
    worst = max(class_p95s)
    return (worst, worst <= threshold_c)


def _evaluate_comfort_gate(
    controller: str, scope: str, window_cycles: int, history_store, snapshot,
) -> Tuple[int, bool]:
    """Counts attributable Alarm A events per design §6.2 attribution rule.

    Returns (count, pass_flag). Pass iff count == 0.

    The room scope comes from the query's `room=` filter, because `query()`
    points carry no tags. A room-scoped query returns Alarm A only, because
    Alarm B is written with the room tag `_installation`. The bucket is one
    minute, because the qsdb store rejects a seconds interval and Alarm A
    re-fires at most once per hour per room (INSTRUCTION-557).
    """
    import json

    from qsh.api.state import shared_state
    from qsh.historian import get_historian

    historian = get_historian()
    if historian is None or not getattr(historian, "is_active", False):
        return (0, False)

    config = shared_state.get_config() or {}
    cycle_period_s = float(config.get("update_interval_s", 300))
    window_seconds = window_cycles * cycle_period_s

    try:
        result = historian.query(
            measurement="qsh_alarm_event",
            fields=["payload_json"],
            time_from=f"-{int(window_seconds)}s",
            time_to="now()",
            room=None if scope == "_global" else scope,
            aggregation="last",
            interval="1m",
        )
        points = result.get("points", []) if result else []
    except Exception as exc:
        logger.warning("_evaluate_comfort_gate: historian query failed: %s", exc)
        return (0, False)

    attributable_count = 0
    for p in points:
        if scope == "_global":
            continue
        payload_str = p.get("payload_json")
        try:
            payload = (
                json.loads(payload_str)
                if isinstance(payload_str, str) else payload_str
            )
        except Exception:
            continue
        active_features = (payload or {}).get("currently_active_features", []) or []
        if controller in active_features:
            attributable_count += 1

    return (attributable_count, attributable_count == 0)


def _evaluate_composite_confidence_gate(
    controller: str, scope: str, rooms: List[str],
    c_mat_threshold: float, c_hist_threshold: float,
    sysid_state, history_store,
) -> Tuple[Optional[float], Optional[float], bool]:
    """c_maturity from worst-case sysid; c_historical_min over observed
    weather classes with sample_count >= 5.

    V2 MEDIUM-2 — consumes the public iter_observations accessor.
    """
    try:
        from qsh.sysid import MIN_OBS_FOR_USE
    except ImportError:
        return (None, None, False)
    from qsh.forecast_confidence import c_maturity, c_historical

    if sysid_state is None or not getattr(sysid_state, "rooms", None):
        return (None, None, False)

    obs_counts = [
        getattr(params, "u_observations", 0)
        for params in sysid_state.rooms.values()
    ]
    if not obs_counts:
        return (None, None, False)

    obs_min = min(obs_counts)
    try:
        c_mat = c_maturity(obs_min, MIN_OBS_FOR_USE)
    except Exception:
        return (None, None, False)

    if not hasattr(history_store, "iter_observations"):
        logger.error(
            "_evaluate_composite_confidence_gate: ForecastHistoryStore."
            "iter_observations not available — V208A V2 MEDIUM-2 prerequisite "
            "violated. Returning gate failure.",
        )
        return (c_mat, None, False)

    c_hist_values: List[float] = []
    try:
        for ctrl_key, room_key, _wc, obs_deque in history_store.iter_observations(
            controller=controller,
        ):
            if room_key != scope:
                continue
            if len(obs_deque) < 5:
                continue
            import statistics
            try:
                std_bias = (
                    statistics.stdev(obs_deque) if len(obs_deque) >= 2 else 0.0
                )
            except Exception:
                continue
            try:
                c_h = c_historical(len(obs_deque), std_bias)
            except Exception:
                continue
            c_hist_values.append(c_h)
    except Exception as exc:
        logger.debug(
            "_evaluate_composite_confidence_gate: iteration failed: %s", exc,
        )

    c_hist_min = min(c_hist_values) if c_hist_values else None
    if c_hist_min is None:
        return (c_mat, None, False)

    return (
        c_mat, c_hist_min,
        c_mat >= c_mat_threshold and c_hist_min >= c_hist_threshold,
    )


def _evaluate_twin_gate(scope: str, snapshot) -> Tuple[bool, bool]:
    """Pass iff no twin_calibration_drift flag for this scope."""
    drift = getattr(snapshot, "twin_calibration_drift", {}) or {}
    if scope == "_global":
        any_flagged = any(drift.values())
        return any_flagged, not any_flagged
    flagged = bool(drift.get(scope, False))
    return flagged, not flagged


def _gate_rationale(
    error_pass: bool, comfort_pass: bool, conf_pass: bool, twin_pass: bool,
    cycles_holding: int, cycles_required: int,
    *, error_no_data: bool = False,
) -> str:
    failed = []
    if not error_pass and not error_no_data:
        failed.append("prediction-error")
    if not comfort_pass:
        failed.append("comfort")
    if not conf_pass:
        failed.append("composite-confidence")
    if not twin_pass:
        failed.append("twin-drift")
    if error_no_data:
        parts = [
            "No data: prediction-error (too few reconciliation records in every weather class, or the historian was not readable)."
        ]
        if failed:
            parts.append(f"Failing gates: {', '.join(failed)}.")
        parts.append(f"Cycles held: {cycles_holding}/{cycles_required}.")
        return " ".join(parts)
    if failed:
        return (
            f"Failing gates: {', '.join(failed)}. "
            f"Cycles held: {cycles_holding}/{cycles_required}."
        )
    if cycles_holding < cycles_required:
        return (
            f"All gates passing. Cycles held: {cycles_holding}/{cycles_required} "
            f"(need {cycles_required - cycles_holding} more)."
        )
    return (
        f"Cutover eligible. All gates held for {cycles_holding} cycles "
        f"(>= {cycles_required})."
    )


@router.get("/fallback-counts")
def get_fallback_counts():
    """Per-controller weather-class fallback WARN counters."""
    from qsh.forecast_history import get_default_store
    store = get_default_store()
    return {"fallback_counts": store.get_fallback_counts()}
