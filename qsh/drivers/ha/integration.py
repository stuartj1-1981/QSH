import requests
import logging
import os
import enum
import time as _time

HA_URL = "http://supervisor/core"
TOKEN = os.getenv("SUPERVISOR_TOKEN")
REQUEST_TIMEOUT = 2  # seconds for entity fetches
SERVICE_TIMEOUT = 10  # seconds for service calls (heat pump API is slow)

headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"} if TOKEN else None


class WriteOutcome(enum.Enum):
    """INSTRUCTION-408 — outcome contract for set_ha_service. The transport
    reports what actually happened so callers can log outcome, not intent.
    Membership truthiness is deliberately NOT overloaded — compare with
    `is WriteOutcome.SENT`, never `if result:` (every member is truthy)."""
    SENT = "sent"                             # POST accepted (< 400)
    SUPPRESSED_BREAKER_OPEN = "suppressed"    # never attempted — breaker open
    FAILED = "failed"                         # attempted; HTTP >= 400 or transport error
    NO_TOKEN = "no_token"                     # no SUPERVISOR_TOKEN — never attempted


class _CircuitBreaker:
    """Simple circuit breaker: 5 failures -> 15 min cooldown."""

    MAX_FAILURES = 5
    COOLDOWN_S = 900  # 15 minutes

    def __init__(self):
        self._consecutive_failures = 0
        self._cooldown_until = 0.0
        self._suppressed_writes = 0

    def is_open(self) -> bool:
        """True if breaker is tripped and still in cooldown."""
        if self._consecutive_failures < self.MAX_FAILURES:
            return False
        if _time.time() >= self._cooldown_until:
            # Cooldown expired — half-open, allow one attempt. This is the SINGLE
            # close path for a tripped breaker: while tripped, no call reaches
            # record_success (all read/write gates return before the HTTP
            # attempt), so "connection restored" cannot fire first.
            self._consecutive_failures = 0
            logging.info("HA circuit breaker: cooldown expired, retrying")
            if self._suppressed_writes:
                logging.warning(
                    f"HA circuit breaker: {self._suppressed_writes} write(s) were suppressed while open"
                )
                self._suppressed_writes = 0
            return False
        return True

    def is_tripped(self) -> bool:
        """Pure query — True while tripped AND in cooldown. No side effects:
        does NOT consume the half-open transition (that belongs to is_open(),
        called only by the fetch/write gates)."""
        return (
            self._consecutive_failures >= self.MAX_FAILURES
            and _time.time() < self._cooldown_until
        )

    def note_suppressed_write(self, domain, service, entity):
        """INSTRUCTION-408 — count writes dropped while open. First drop per
        open window logs WARNING (operator-visible edge); the rest log DEBUG
        (a 15-min window can drop hundreds — see the 2026-07-09 rates-retry
        spam for what per-drop WARNING does to the log)."""
        self._suppressed_writes += 1
        if self._suppressed_writes == 1:
            logging.warning(
                "HA circuit breaker open — suppressing writes. First dropped: "
                f"{domain}.{service} entity={entity}. Further drops at DEBUG until cooldown expires."
            )
        else:
            logging.debug(f"HA write suppressed (breaker open): {domain}.{service} entity={entity}")

    def record_success(self):
        if self._consecutive_failures > 0:
            logging.info("HA circuit breaker: connection restored")
        self._consecutive_failures = 0

    def record_failure(self):
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.MAX_FAILURES:
            self._cooldown_until = _time.time() + self.COOLDOWN_S
            # A new open window starts counting suppressed writes fresh.
            self._suppressed_writes = 0
            logging.warning(
                f"HA circuit breaker: {self.MAX_FAILURES} consecutive failures — "
                f"pausing API calls for {self.COOLDOWN_S // 60} minutes"
            )


_breaker = _CircuitBreaker()


def ha_api_available() -> bool:
    """INSTRUCTION-408 — API-channel health for supervisory consumers
    (DegradationController gate). Pure; safe to call every cycle."""
    return not _breaker.is_tripped()


def _entity_label(data) -> str:
    """Render an HA service-call entity_id readably for a log line. HA accepts
    list-form entity_id (multi-TRV fan-out); render "{first} (+{n-1} more)" for
    a non-empty list, the scalar value otherwise, "?" when absent."""
    entity = data.get("entity_id")
    if isinstance(entity, (list, tuple)):
        if not entity:
            return "?"
        if len(entity) == 1:
            return str(entity[0])
        return f"{entity[0]} (+{len(entity) - 1} more)"
    if entity is None:
        return "?"
    return str(entity)


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


def set_ha_service(domain, service, data) -> WriteOutcome:
    if not headers:
        logging.warning("No SUPERVISOR_TOKEN found - set_ha_service skipped.")
        return WriteOutcome.NO_TOKEN
    if _breaker.is_open():
        _breaker.note_suppressed_write(domain, service, _entity_label(data))
        return WriteOutcome.SUPPRESSED_BREAKER_OPEN
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
            return WriteOutcome.FAILED
        _breaker.record_success()
        logging.debug(f"Service {domain}.{service} called successfully.")
        return WriteOutcome.SENT
    except requests.exceptions.RequestException as e:
        _breaker.record_failure()
        entity = data.get("entity_id", "?")
        value = data.get("value", data.get("option", "?"))
        logging.error(f"HA service error {domain}.{service}: entity={entity} value={value!r} err={e}")
        return WriteOutcome.FAILED


