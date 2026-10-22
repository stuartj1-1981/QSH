import requests
import logging
import os
import enum

from ... import clock

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


# INSTRUCTION-442 — LATCHED annunciation of breaker write-suppression windows.
# Keyed to impact, not to state: the latch enters on the FIRST write actually
# dropped (a breaker window with zero attempted writes stays annunciator-quiet,
# matching 408's freeze philosophy) and clears at the breaker's close-summary
# path carrying the suppressed-write count. Emission is wrapped so an
# annunciator failure (unregistered event in a stripped build, import-order
# surprise) degrades to the existing log lines and can never alter a
# WriteOutcome or skip a counter update (442 §7).
WRITE_SUPPRESSION_EVENT = "HA.write_suppression"


def _register_write_suppression_event():
    try:
        from ...events import EventKind, EventSpec, get_annunciator
        get_annunciator().register(EventSpec(
            name=WRITE_SUPPRESSION_EVENT,
            kind=EventKind.LATCHED,
            payload_fields=("first_dropped", "suppressed_count"),
            default_level=logging.WARNING,
        ))
    except Exception:
        logging.debug(
            "HA.write_suppression event registration failed", exc_info=True
        )


_register_write_suppression_event()


def _annunciate_suppression_entered(first_dropped: str) -> None:
    try:
        from ...events import get_annunciator
        get_annunciator().entered(
            WRITE_SUPPRESSION_EVENT,
            first_dropped=first_dropped,
            suppressed_count=1,
        )
    except Exception:
        logging.debug(
            "HA.write_suppression entered-emission failed", exc_info=True
        )


def _annunciate_suppression_cleared(suppressed_count: int) -> None:
    try:
        from ...events import get_annunciator
        get_annunciator().exited(
            WRITE_SUPPRESSION_EVENT,
            suppressed_count=suppressed_count,
        )
    except Exception:
        logging.debug(
            "HA.write_suppression exited-emission failed", exc_info=True
        )


# INSTRUCTION-506 T5 — `headers` is a module-level constant evaluated once at
# import (line 12 above), so this condition cannot clear within a process
# lifetime. latch_key=() gives one emission per process; there is
# deliberately no falling edge (see T5 in the instruction — the correct
# clearing act is a process restart with the token present).
NO_SUPERVISOR_TOKEN_EVENT = "HA.no_supervisor_token"


def _annunciate_no_supervisor_token(caller: str) -> None:
    # Registered per-call rather than once at import (contrast
    # _register_write_suppression_event above): register() is idempotent, so
    # the per-call cost is a small dict lookup, and it survives an
    # EventAnnunciator singleton reset (e.g. between tests) without needing a
    # second import-time call.
    try:
        from ...events import EventKind, EventSpec, get_annunciator
        ann = get_annunciator()
        ann.register(EventSpec(
            name=NO_SUPERVISOR_TOKEN_EVENT,
            kind=EventKind.LATCHED,
            payload_fields=("caller",),
            latch_key=(),
            default_level=logging.WARNING,
        ))
        ann.entered(NO_SUPERVISOR_TOKEN_EVENT, caller=caller)
    except Exception:
        logging.debug(
            "HA.no_supervisor_token entered-emission failed", exc_info=True
        )


class _CircuitBreaker:
    """Circuit breaker: 5 consecutive failures open it. The cooldown is
    30 s at a first trip and rises through COOLDOWN_STEPS_S at each trip that
    follows less than TRIP_LEVEL_RESET_S after the one before (INSTRUCTION-598)."""

    MAX_FAILURES = 5
    COOLDOWN_S = 900  # the longest cooldown: 15 minutes
    # INSTRUCTION-598 — the cooldown of each trip, by trip level. A short HA
    # outage (a Supervisor update, about 25 s) closes after the first step.
    COOLDOWN_STEPS_S = (30, 60, 120, 240, 480, 900)
    # A trip this time or more after the one before starts at the first
    # step again. A success does not reset the level: a fault that trips the
    # breaker on each cycle after it closes stays at the longest cooldown.
    TRIP_LEVEL_RESET_S = 1800

    def __init__(self):
        self._consecutive_failures = 0
        self._cooldown_until = 0.0
        self._suppressed_writes = 0
        self._trip_level = 0       # INSTRUCTION-598
        self._last_trip_at = None  # INSTRUCTION-598 — clock.now() of the last trip

    def is_open(self) -> bool:
        """True if breaker is tripped and still in cooldown."""
        if self._consecutive_failures < self.MAX_FAILURES:
            return False
        if clock.now() >= self._cooldown_until:
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
                # INSTRUCTION-442 — clear the suppression latch at the single
                # close path, carrying the same count the summary logs.
                _annunciate_suppression_cleared(self._suppressed_writes)
                self._suppressed_writes = 0
            return False
        return True

    def is_tripped(self) -> bool:
        """Pure query — True while tripped AND in cooldown. No side effects:
        does NOT consume the half-open transition (that belongs to is_open(),
        called only by the fetch/write gates)."""
        return (
            self._consecutive_failures >= self.MAX_FAILURES
            and clock.now() < self._cooldown_until
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
            # INSTRUCTION-442 — latch the suppression window on the first
            # write actually dropped (impact-keyed, not state-keyed).
            _annunciate_suppression_entered(f"{domain}.{service} entity={entity}")
        else:
            logging.debug(f"HA write suppressed (breaker open): {domain}.{service} entity={entity}")

    def record_success(self):
        if self._consecutive_failures > 0:
            logging.info("HA circuit breaker: connection restored")
        self._consecutive_failures = 0

    def record_failure(self):
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.MAX_FAILURES:
            now = clock.now()
            if self._last_trip_at is None or now - self._last_trip_at >= self.TRIP_LEVEL_RESET_S:
                self._trip_level = 0
            cooldown_s = self.COOLDOWN_STEPS_S[
                min(self._trip_level, len(self.COOLDOWN_STEPS_S) - 1)
            ]
            self._trip_level += 1
            self._last_trip_at = now
            self._cooldown_until = now + cooldown_s
            # A new open window starts counting suppressed writes fresh.
            self._suppressed_writes = 0
            logging.warning(
                f"HA circuit breaker: {self.MAX_FAILURES} consecutive failures — "
                f"pausing API calls for {cooldown_s} s"
            )


_breaker = _CircuitBreaker()


def ha_api_available() -> bool:
    """INSTRUCTION-408 — API-channel health for supervisory consumers
    (DegradationController gate). Pure; safe to call every cycle."""
    return not _breaker.is_tripped()


# INSTRUCTION-598 — a read that fails because the HA channel is down (the
# breaker is open, a transport error, an HTTP error other than 404) is a
# transport fault. An entity that HA reports 'unavailable', or does not hold
# (404), is an entity fault. The HA driver holds an input's last valid value
# on a transport fault only; on an entity fault the input keeps its own
# fallback. API-channel loss is not device loss (INSTRUCTION-408). Ages are
# read on the monotonic clock, so a step of the wall clock does not make a
# fault or a held value current for longer.
TRANSPORT_HOLD_LIMIT_S = 1800.0  # the oldest value a hold gives
TRANSPORT_FAULT_FRESH_S = 10.0   # a recorded fault is current for this time
INPUT_HELD_EVENT = "HA.input_held_transport"
_transport_faults = {}  # entity_id -> clock.monotonic() of its last transport fault


def _note_read(entity_id, transport_fault):
    if transport_fault:
        _transport_faults[entity_id] = clock.monotonic()
    else:
        _transport_faults.pop(entity_id, None)


def ha_transport_fault(entity_id) -> bool:
    """INSTRUCTION-598 — True when the last fetch_ha_entity read of entity_id
    failed on the transport, not more than TRANSPORT_FAULT_FRESH_S ago."""
    at = _transport_faults.get(entity_id)
    return at is not None and 0.0 <= clock.monotonic() - at <= TRANSPORT_FAULT_FRESH_S


def reset_transport_faults_for_testing():
    _transport_faults.clear()


def _register_input_held_event():
    try:
        from ...events import EventKind, EventSpec, get_annunciator
        get_annunciator().register(EventSpec(
            name=INPUT_HELD_EVENT,
            kind=EventKind.LATCHED,
            payload_fields=("kind", "key", "entity", "age_s"),
            latch_key=("kind", "key"),
            default_level=logging.WARNING,
        ))
    except Exception:
        logging.debug("HA.input_held_transport event registration failed", exc_info=True)


# Module scope (T-46). _annunciate_input_held registers again before each
# emission; register() is idempotent, and the second call survives an
# annunciator reset, as _annunciate_no_supervisor_token does.
_register_input_held_event()


def _annunciate_input_held(entered, kind, key, entity_id, age_s, level):
    try:
        from ...events import get_annunciator
        _register_input_held_event()
        ann = get_annunciator()
        if entered:
            ann.entered(INPUT_HELD_EVENT, kind=kind, key=key, entity=entity_id, age_s=age_s)
        else:
            ann.exited(INPUT_HELD_EVENT, level=level, kind=kind, key=key, entity=entity_id)
    except Exception:
        logging.debug("HA.input_held_transport emission failed", exc_info=True)


class TransportHold:
    """INSTRUCTION-598 — the last valid value of each key of one input kind.
    held() gives it back only when the read of the entity failed on the
    transport and the value is not older than TRANSPORT_HOLD_LIMIT_S; else
    None, and the caller applies the input's own fallback."""

    def __init__(self, kind):
        self.kind = kind
        self._values = {}

    def fresh(self, key, entity_id, value):
        self._values[key] = (value, clock.monotonic())
        _annunciate_input_held(False, self.kind, key, entity_id, None, logging.INFO)

    def drop(self, key, entity_id):
        """Forget the key: a valid reading that must not be held."""
        self._values.pop(key, None)
        _annunciate_input_held(False, self.kind, key, entity_id, None, logging.INFO)

    def held(self, key, entity_id):
        record = self._values.get(key)
        age_s = None if record is None else clock.monotonic() - record[1]
        if record is None or age_s < 0.0 or not ha_transport_fault(entity_id):
            _annunciate_input_held(False, self.kind, key, entity_id, None, logging.INFO)
            return None
        if age_s > TRANSPORT_HOLD_LIMIT_S:
            _annunciate_input_held(False, self.kind, key, entity_id, None, logging.WARNING)
            return None
        _annunciate_input_held(True, self.kind, key, entity_id, round(age_s), None)
        return record[0]

    def clear(self):
        self._values.clear()


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
        _annunciate_no_supervisor_token("fetch_ha_entity")
        return default
    if _breaker.is_open():
        _note_read(entity_id, True)  # INSTRUCTION-598
        return default
    try:
        response = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        _breaker.record_success()
        _note_read(entity_id, False)  # INSTRUCTION-598
        data = response.json()
        if attr:
            return data.get("attributes", {}).get(attr, default)
        return data.get("state", default)
    except requests.exceptions.HTTPError as e:
        # INSTRUCTION-598 — a 404 is an entity HA does not hold; every other
        # HTTP error is a transport fault (a 400 from a Supervisor that is
        # still starting, 22 October 2026).
        _note_read(entity_id, e.response.status_code != 404)
        if e.response.status_code == 404 and suppress_log:
            return default  # Silent for existence checks
        _breaker.record_failure()
        logging.error(f"Error fetching entity {entity_id}: {e}")
        return default
    except requests.exceptions.RequestException as e:
        _note_read(entity_id, True)  # INSTRUCTION-598
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
        _annunciate_no_supervisor_token("set_ha_service")
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


def set_ha_state(entity_id, state, attributes=None) -> WriteOutcome:
    """INSTRUCTION-494 — direct entity-state POST (`/api/states/{entity_id}`),
    for the per-cycle telemetry entities (sensor.qsh_operating_state,
    sensor.qsh_heat_demand). Mirrors set_ha_service's entity-id hygiene,
    _CircuitBreaker participation and WriteOutcome contract.

    Differences from set_ha_service, both for T-45 (this sits on a per-cycle
    path): the no-token branch logs at DEBUG, not WARNING, and per-attempt
    request failures log at DEBUG only — the operator-visible signal for a
    sustained HA API outage is the existing breaker/write-suppression
    annunciation (LATCHED, edge-gated), not a per-cycle WARNING/ERROR.
    """
    if not isinstance(entity_id, str) or not entity_id.strip():
        logging.debug(
            "set_ha_state called with invalid entity_id: %r — skipped.", entity_id
        )
        return WriteOutcome.FAILED
    if not headers:
        logging.debug("No SUPERVISOR_TOKEN found - set_ha_state skipped.")
        return WriteOutcome.NO_TOKEN
    if _breaker.is_open():
        _breaker.note_suppressed_write("states", "post", entity_id)
        return WriteOutcome.SUPPRESSED_BREAKER_OPEN
    try:
        response = requests.post(
            f"{HA_URL}/api/states/{entity_id}",
            json={"state": str(state), "attributes": attributes or {}},
            headers=headers,
            timeout=SERVICE_TIMEOUT,
        )
        if response.status_code >= 400:
            logging.debug(
                f"HA rejected state post for {entity_id}: {response.status_code}"
            )
            _breaker.record_failure()
            return WriteOutcome.FAILED
        _breaker.record_success()
        logging.debug(f"State {entity_id} posted successfully.")
        return WriteOutcome.SENT
    except requests.exceptions.RequestException as e:
        _breaker.record_failure()
        logging.debug(f"HA state post error for {entity_id}: err={e}")
        return WriteOutcome.FAILED


