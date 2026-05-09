"""HA forecast fetcher — moved from forecast.py to isolate HA dependency.

Logging policy: edge-triggered. The fetcher is invoked once per
FORECAST_CACHE_SECONDS (~30 min) by the wrapping cache in forecast.py.
Without state tracking, every invocation that hits the failure path
would emit a redundant log line. Module-level state records the
last-emitted condition; failure transitions are logged once, success
states are silent.

States tracked:
    "hourly"   - hourly forecast call returned data (silent)
    "daily"    - hourly empty, daily returned data (silent)
    "failed"   - both calls empty OR service raised (DEBUG-emitting; the
                 user-visible "Weather forecast unavailable" line is
                 emitted upstream by WeatherForecaster, INSTRUCTION-210)

Per INSTRUCTION-210, no logging.* call in this module emits at INFO or
above (verified by survey in INSTRUCTION-210 Task 2c). State is still
tracked so _log_failure() de-duplicates against prior mode/detail, and
so a fresh failure following a success path records exactly once at
DEBUG.

Thread-safety contract: SINGLE-WRITER. The module-level _last_mode
and _last_error_detail are read-modify-write without locking. The
fetcher is invoked exclusively from the pipeline's serial cycle path
(HADriver._fetch_forecast_state -> WeatherForecaster.get_forecast_state
-> _get_cached_forecast -> injected fetch_fn). FastAPI handlers read
the resulting forecast_state from SharedState, never call the fetcher
directly. Do not call fetch_forecast_from_ha() concurrently. If a
future caller violates this contract (background refresh task, async
pre-warm, etc.), wrap the state mutation in a threading.Lock or
migrate to threading.local before adding the new caller.
"""

import logging
from typing import Dict, List, Optional

from .integration import _call_forecast_service

# --- Edge-triggered log state (module-level) ---------------------------------
# These track the last-emitted condition so steady states don't re-log.
# Reset by tests via reset_log_state(). Process-lifetime in production.
_last_mode: Optional[str] = None  # "hourly" | "daily" | "failed" | None
_last_error_detail: Optional[str] = None


def reset_log_state() -> None:
    """Reset edge-tracking state. Test hook only."""
    global _last_mode, _last_error_detail
    _last_mode = None
    _last_error_detail = None


def _record_mode_transition(new_mode: str) -> None:
    """
    Update mode-tracking state for a non-failure transition. Silent.

    The forecast logging policy (INSTRUCTION-197) emits only on
    unavailable-to-the-consumer conditions. Transitions between
    "hourly" and "daily" both deliver forecast data to the control
    loop — no log line is warranted. Transitions OUT of "failed" are
    silent for the same reason: silence-on-recovery is the policy.

    State is still tracked so that _log_failure() can de-duplicate
    against the prior mode and so a fresh failure following a
    success path emits exactly once.
    """
    assert new_mode in ("hourly", "daily"), (
        f"_record_mode_transition: invalid mode {new_mode!r}; "
        "use _log_failure() for the 'failed' state"
    )
    global _last_mode
    _last_mode = new_mode


def _log_failure(detail: str) -> None:
    """
    De-duplicates DEBUG entries on entry to (or detail change within) the
    "failed" state.

    The user-visible "Weather forecast unavailable" signal is owned
    upstream by WeatherForecaster._entity_available (INSTRUCTION-210).
    This function exists solely to keep the HTTP-layer detail string
    (e.g. exception text, "no forecast data returned") in the DEBUG
    stream once per distinct detail, rather than once per cycle.

    State partition (preserved from INSTRUCTION-197): _record_mode_transition
    owns transitions out of "failed"; _log_failure owns transitions into
    "failed". Two writers to _last_mode by design.
    """
    global _last_mode, _last_error_detail
    if _last_mode == "failed" and detail == _last_error_detail:
        return
    logging.debug("Weather forecast fetch failed: %s", detail)
    _last_mode = "failed"
    _last_error_detail = detail


def fetch_forecast_from_ha(forecast_entity: str) -> Optional[List[Dict]]:
    """
    Fetch hourly forecast via HA service call.

    Uses POST /api/services/weather/get_forecasts with type=hourly.
    Falls back to type=daily if hourly not available. Logs only on
    state transitions (see module docstring).
    """
    global _last_error_detail
    try:
        result = _call_forecast_service(forecast_entity, forecast_type="hourly")

        if result:
            _record_mode_transition("hourly")
            _last_error_detail = None
            return result

        result = _call_forecast_service(forecast_entity, forecast_type="daily")

        if result:
            _record_mode_transition("daily")
            _last_error_detail = None
            return result

        _log_failure("no forecast data returned (hourly and daily both empty)")
        return None

    except Exception as e:
        _log_failure(str(e))
        return None
