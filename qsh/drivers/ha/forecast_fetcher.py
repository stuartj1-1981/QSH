"""HA forecast fetcher — moved from forecast.py to isolate HA dependency.

Logging policy: edge-triggered. The fetcher is invoked once per
FORECAST_CACHE_SECONDS (~30 min) by the wrapping cache in forecast.py.
Without state tracking, every invocation that hits the daily-fallback
or failure path would emit a redundant log line. Module-level state
records the last-emitted condition; transitions are logged once,
steady states are silent.

States tracked:
    "hourly"   - hourly forecast call returned data
    "daily"    - hourly call returned nothing, daily call returned data
    "failed"   - both calls returned nothing, OR the service call raised

Transitions out of "failed" emit at INFO (recovery is informational).
Transitions into "failed" emit at ERROR with the underlying detail.
The error detail string is also tracked separately so a change in the
exception message (different root cause) re-emits even if the broad
state is still "failed".

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


def _log_mode_transition(new_mode: str) -> None:
    """
    Emit a log line only when crossing a non-failure mode boundary.

    Owns transitions OUT of "failed" (success after error) and between
    "hourly" / "daily". Does NOT handle entry to "failed" — that's
    _log_failure()'s contract, because the failure log carries the
    exception detail and uses ERROR level.
    """
    assert new_mode in ("hourly", "daily"), (
        f"_log_mode_transition: invalid mode {new_mode!r}; "
        "use _log_failure() for the 'failed' state"
    )
    global _last_mode
    if new_mode == _last_mode:
        return
    if new_mode == "hourly":
        # Only worth logging if we were previously NOT on hourly
        # (i.e., recovery from daily fallback or from failure).
        if _last_mode is not None:
            logging.info("Weather forecast: hourly forecast restored")
    elif new_mode == "daily":
        logging.info("Weather forecast: hourly not available, using daily forecast")
    _last_mode = new_mode


def _log_failure(detail: str) -> None:
    """
    Emit ERROR on entry to failed state OR on a change in failure detail.

    Owns transitions INTO "failed". _log_mode_transition() owns
    transitions out of it. Two writers to _last_mode by design: the
    partition is by-target-state, not by-variable.
    """
    global _last_mode, _last_error_detail
    if _last_mode == "failed" and detail == _last_error_detail:
        return
    logging.error("Weather forecast fetch error: %s", detail)
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
            _log_mode_transition("hourly")
            _last_error_detail = None
            return result

        result = _call_forecast_service(forecast_entity, forecast_type="daily")

        if result:
            _log_mode_transition("daily")
            _last_error_detail = None
            return result

        _log_failure("no forecast data returned (hourly and daily both empty)")
        return None

    except Exception as e:
        _log_failure(str(e))
        return None
