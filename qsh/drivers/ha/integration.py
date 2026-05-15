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
    # INSTRUCTION-230 Task 2 (Layer 3 of three-layer defence) — Layer 1 is
    # validate_yaml.py:validate_rooms string-type check; Layer 2 is
    # config.py:969 belt-and-braces guard. This third layer catches caller-
    # side defects anywhere in the codebase that construct a non-string
    # entity_id (list, dict, etc.). Without this guard such values
    # f-string-interpolate into /api/states/<repr(value)> URLs that HA 404s
    # on, producing obscure log lines that conceal the caller-side defect.
    if not isinstance(entity_id, str):
        if entity_id is not None:
            logging.error(
                "fetch_ha_entity called with non-string entity_id: "
                "type=%s value=%r — returning default. Caller defect; "
                "check the call site.",
                type(entity_id).__name__, entity_id,
            )
        return default
    # Empty/whitespace entity_id produces URL "/api/states/" — HA returns 404
    # and the circuit breaker counts it as a real failure. Short-circuit here
    # to keep the breaker honest regardless of caller hygiene.
    if not entity_id.strip():
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
    # INSTRUCTION-230 Task 2 (Layer 3 of three-layer defence) — symmetric
    # guard with fetch_ha_entity above. Non-string entity_id produces a
    # malformed /api/states/<repr(value)> URL when f-string-interpolated.
    if not isinstance(entity_id, str):
        if entity_id is not None:
            logging.error(
                "fetch_ha_entity_full called with non-string entity_id: "
                "type=%s value=%r — returning None. Caller defect; "
                "check the call site.",
                type(entity_id).__name__, entity_id,
            )
        return None
    if not entity_id.strip():
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
            value = data.get("value", data.get("option", data.get("temperature", "?")))
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


