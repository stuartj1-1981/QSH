import requests
import logging
import json
import os
import time as _time

HA_URL = "http://supervisor/core"
TOKEN = os.getenv("SUPERVISOR_TOKEN")
REQUEST_TIMEOUT = 2  # seconds for entity fetches
SERVICE_TIMEOUT = 10  # seconds for service calls (heat pump API is slow)

headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"} if TOKEN else None


class _CircuitBreaker:
    """Simple circuit breaker: 5 failures -> 15 min cooldown."""

    MAX_FAILURES = 5
    COOLDOWN_S = 900  # 15 minutes

    def __init__(self):
        self._consecutive_failures = 0
        self._cooldown_until = 0.0

    def is_open(self) -> bool:
        """True if breaker is tripped and still in cooldown."""
        if self._consecutive_failures < self.MAX_FAILURES:
            return False
        if _time.time() >= self._cooldown_until:
            # Cooldown expired — half-open, allow one attempt
            self._consecutive_failures = 0
            logging.info("HA circuit breaker: cooldown expired, retrying")
            return False
        return True

    def record_success(self):
        if self._consecutive_failures > 0:
            logging.info("HA circuit breaker: connection restored")
        self._consecutive_failures = 0

    def record_failure(self):
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.MAX_FAILURES:
            self._cooldown_until = _time.time() + self.COOLDOWN_S
            logging.warning(
                f"HA circuit breaker: {self.MAX_FAILURES} consecutive failures — "
                f"pausing API calls for {self.COOLDOWN_S // 60} minutes"
            )


_breaker = _CircuitBreaker()


def fetch_ha_entity(entity_id, attr=None, default=None, suppress_log=False):
    # Empty/whitespace entity_id produces URL "/api/states/" — HA returns 404
    # and the circuit breaker counts it as a real failure. Short-circuit here
    # to keep the breaker honest regardless of caller hygiene.
    if not entity_id or not str(entity_id).strip():
        return default
    if not headers:
        logging.warning("No SUPERVISOR_TOKEN found - fetch_ha_entity will return default.")
        return default
    if _breaker.is_open():
        return default
    try:
        response = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        _breaker.record_success()
        data = response.json()
        if attr:
            return data.get("attributes", {}).get(attr, default)
        return data.get("state", default)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404 and suppress_log:
            return default  # Silent for existence checks
        _breaker.record_failure()
        logging.error(f"Error fetching entity {entity_id}: {e}")
        return default
    except requests.exceptions.RequestException as e:
        _breaker.record_failure()
        logging.error(f"Error fetching entity {entity_id}: {e}")
        return default
    except (ValueError, TypeError) as e:
        logging.error(f"Error parsing response for entity {entity_id}: {e}")
        return default


def fetch_ha_entity_full(entity_id, default=None, suppress_log=False):
    """
    Fetch full HA entity state including last_updated timestamp.

    Returns dict with:
        state:        The entity's current state value
        last_updated: ISO datetime string of last state write (even if unchanged)
        last_changed: ISO datetime string of last state change
        attributes:   Full attributes dict

    Returns None on failure (caller should handle gracefully).
    """
    if not entity_id or not str(entity_id).strip():
        return None
    if not headers:
        return None
    if _breaker.is_open():
        return None
    try:
        response = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        _breaker.record_success()
        data = response.json()
        return {
            "state": data.get("state", default),
            "last_updated": data.get("last_updated"),
            "last_changed": data.get("last_changed"),
            "attributes": data.get("attributes", {}),
        }
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404 and suppress_log:
            return None
        _breaker.record_failure()
        logging.error(f"Error fetching entity {entity_id}: {e}")
        return None
    except requests.exceptions.RequestException as e:
        _breaker.record_failure()
        logging.error(f"Error fetching entity {entity_id}: {e}")
        return None
    except (ValueError, TypeError) as e:
        logging.error(f"Error parsing response for entity {entity_id}: {e}")
        return None


def set_ha_service(domain, service, data):
    if not headers:
        logging.warning("No SUPERVISOR_TOKEN found - set_ha_service skipped.")
        return
    if _breaker.is_open():
        return
    try:
        response = requests.post(
            f"{HA_URL}/api/services/{domain}/{service}",
            json=data,
            headers=headers,
            timeout=SERVICE_TIMEOUT,  # Use longer timeout for service calls
        )
        if response.status_code >= 400:
            # Read HA's error body before raise_for_status swallows it
            try:
                body = response.text[:300]
            except Exception:
                body = "(unreadable)"
            entity = data.get("entity_id", "?")
            value = data.get("value", data.get("option", "?"))
            logging.error(
                f"HA rejected {domain}.{service}: {response.status_code} entity={entity} value={value!r} body={body}"
            )
            _breaker.record_failure()
            return
        _breaker.record_success()
        logging.debug(f"Service {domain}.{service} called successfully.")
    except requests.exceptions.RequestException as e:
        _breaker.record_failure()
        entity = data.get("entity_id", "?")
        value = data.get("value", data.get("option", "?"))
        logging.error(f"HA service error {domain}.{service}: entity={entity} value={value!r} err={e}")


def _call_forecast_service(entity_id, forecast_type="hourly"):
    """
    Call weather.get_forecasts service to retrieve forecast data.

    HA 2024.3+ removed forecast from entity attributes. Forecast data
    is now only available via the weather.get_forecasts service action.

    Args:
        entity_id: Weather entity ID (e.g. 'weather.home')
        forecast_type: 'hourly', 'daily', or 'twice_daily'

    Returns:
        List of forecast dicts, or None on failure.
        Each dict contains: datetime, temperature, condition, wind_speed, etc.
    """
    if not headers:
        logging.warning("No SUPERVISOR_TOKEN found - forecast service skipped.")
        return None

    try:
        response = requests.post(
            f"{HA_URL}/api/services/weather/get_forecasts?return_response=true",
            json={
                "entity_id": entity_id,
                "type": forecast_type,
            },
            headers=headers,
            timeout=SERVICE_TIMEOUT,
        )

        # Explicit HTTP status check with body logging
        if response.status_code >= 400:
            try:
                body = response.text[:500]
            except Exception:
                body = "(unreadable)"
            if response.status_code == 404:
                logging.info(
                    "Forecast service not available (404) for %s — weather entity may not support %s forecast",
                    entity_id,
                    forecast_type,
                )
            else:
                logging.error(
                    "Forecast service HTTP %d for %s (type=%s): %s",
                    response.status_code,
                    entity_id,
                    forecast_type,
                    body,
                )
            return None

        result = response.json()

        # Response structure: {"weather.home": {"forecast": [...]}}
        # or for newer HA: direct service response
        if isinstance(result, dict):
            # Try entity_id key first (standard response format)
            entity_data = result.get(entity_id, {})
            if isinstance(entity_data, dict):
                forecast = entity_data.get("forecast", [])
                if forecast:
                    return forecast

            # Try nested under 'response' key
            response_data = result.get("response", {})
            if isinstance(response_data, dict):
                entity_data = response_data.get(entity_id, {})
                if isinstance(entity_data, dict):
                    forecast = entity_data.get("forecast", [])
                    if forecast:
                        return forecast

            # Try nested under 'service_response' key (HA 2024.12+)
            svc_data = result.get("service_response", {})
            if isinstance(svc_data, dict):
                entity_data = svc_data.get(entity_id, {})
                if isinstance(entity_data, dict):
                    forecast = entity_data.get("forecast", [])
                    if forecast:
                        return forecast

            # Try direct forecast key (some HA versions)
            forecast = result.get("forecast", [])
            if forecast:
                return forecast

        # If result is a list of context dicts (service call response),
        # the forecast might be in a different location
        if isinstance(result, list) and len(result) > 0:
            logging.warning(
                "Forecast service for %s returned list (%d items, "
                "first keys: %s) — may need response_variable approach",
                entity_id,
                len(result),
                list(result[0].keys()) if isinstance(result[0], dict) else "?",
            )

        logging.warning(
            "Forecast service for %s returned unexpected structure (type=%s, keys=%s)",
            entity_id,
            type(result).__name__,
            list(result.keys()) if isinstance(result, dict) else "?",
        )
        return None

    except requests.exceptions.RequestException as e:
        logging.error("Forecast service request error for %s: %s", entity_id, e)
        return None
    except (ValueError, TypeError, json.JSONDecodeError) as e:
        logging.error("Forecast service parse error for %s: %s", entity_id, e)
        return None
