"""
Octopus Energy Direct API Module

Bypasses Home Assistant REST API for heat pump control (flow temperature
and zone mode), calling the Octopus Energy GraphQL API at
`api.backend.octopus.energy/v1/graphql/` directly. Uses the direct
GraphQL endpoint as the primary path to avoid the historical setpoint-reset
bug in the BottlecapDave HA integration (< v17.1.1, fixed 31 Oct 2025).
The HA service call is retained as a fallback when the direct call fails;
this is safe on BottlecapDave v17.1.1 and later.

Note: `obtainKrakenToken` is still fetched from the legacy
`api.octopus.energy/v1/graphql/` endpoint; the resulting bare JWT is
accepted by the new backend endpoint for HP mutations.

Config (options.json):
  octopus_api_key:        "sk_live_..."    - API key from Octopus dashboard
  octopus_hp_euid:        "00:1e:5e:..."   - Heat pump EUID from HA diagnostics
  octopus_account_number: "A-53DC655F"     - Account number (for zone mode)
  octopus_zone_entity_id: "climate.octo.." - HA entity for reading current mode
  Minimum BottlecapDave HomeAssistant-OctopusEnergy version for safe fallback:
    v17.1.1 (released 2025-10-31). Earlier versions re-bundled the setpoint on
    set_hvac_mode and will clobber the zone target when the fallback fires.

If octopus_api_key is not configured, falls back to HA service calls.
"""

import json
import logging
import socket  # for socket.timeout exception type in _graphql_request retry branch
import time    # also used for response-elapsed instrumentation in _graphql_request
import threading
from decimal import Decimal, ROUND_HALF_UP
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def _clean_temp(value):
    """Round temperature to 1 decimal place for the Float scalar on the new backend endpoint.

    Previously returned a string to work around the old FloatSafeDecimal scalar on
    api.octopus.energy, which parsed JSON numbers via Python float and reintroduced
    IEEE 754 precision errors server-side. The new endpoint declares setpointInCelsius
    as a standard Float scalar, so the string workaround is no longer needed and would
    in fact fail GraphQL type coercion.
    """
    return float(Decimal(str(float(value))).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


# Transport timeout — INSTRUCTION-116 first estimate.
# Basis: the 19 April 2026 log window shows every failed call exhausting the full
# 15 s window rather than returning in the 5–15 s band, suggesting the backend
# does not partially complete in that range when struggling. 5 s + 5 s retry +
# 5 s HA fallback fits safely inside the 30 s cycle. Review after one week of
# logged response.elapsed on successes; raise if p95 exceeds 3 s.
REQUEST_TIMEOUT_SECONDS = 5
REQUEST_RETRY_ON_TIMEOUT = True  # single intra-cycle retry on socket.timeout only

AUTH_URL = "https://api.octopus.energy/v1/graphql/"          # obtainKrakenToken, refresh
API_URL  = "https://api.backend.octopus.energy/v1/graphql/"  # HP mutations
TOKEN_REFRESH_MARGIN = 300  # refresh 5 min before expiry
TOKEN_LIFETIME = 3600  # 60 min token lifetime

# HA mode <-> GraphQL mode mapping
# HA climate entity states: 'heat', 'off'
# Octopus API modes: 'ON', 'OFF', 'AUTO', 'BOOST'
_HA_TO_GQL_MODE = {"heat": "ON", "off": "OFF", "auto": "AUTO"}
_GQL_TO_HA_MODE = {"ON": "heat", "OFF": "off", "AUTO": "auto"}

# Module-level state (thread-safe)
_lock = threading.Lock()
_token = None
_token_expires = 0.0
_refresh_token = None
_api_key = None
_hp_euid = None
_account_number = None
_zone_entity_id = None
_initialised = False
_consecutive_failures = 0
_MAX_FAILURES_BEFORE_BACKOFF = 3
_zone_setpoint = 23.0  # Safe default; updated by set_zone_setpoint()


def init(api_key, hp_euid, account_number="", zone_entity_id=""):
    """
    Initialise the Octopus API module.

    Call once at startup from config loading.
    Returns True if configured, False if missing credentials.
    """
    global _api_key, _hp_euid, _account_number, _zone_entity_id, _initialised

    if not api_key or not hp_euid:
        logging.info("Octopus direct API: not configured (no api_key or euid) - will use HA fallback")
        return False

    _api_key = api_key
    _hp_euid = hp_euid
    _account_number = account_number
    _zone_entity_id = zone_entity_id
    _initialised = True
    logging.info(f"Octopus direct API: initialised (EUID: {hp_euid}, account: {account_number or 'not set'})")
    return True


def is_available():
    """Check if direct API is configured and available."""
    return _initialised and _api_key is not None


def set_zone_setpoint(temp):
    """
    Store the zone setpoint for automatic inclusion on off→heat transitions.

    Called once from config after overtemp_protection is resolved.
    The setpoint is included in every off→heat GraphQL mutation to prevent
    the Cosy defaulting to 20°C when QSH restarts the HP.
    """
    global _zone_setpoint
    _zone_setpoint = float(temp)
    logging.info(f"Octopus API: zone setpoint stored as {_zone_setpoint}°C")


def _graphql_request(query, variables=None, token=None, url=None):
    """Execute a GraphQL request. Returns parsed JSON or None on failure.

    Transport hardening (INSTRUCTION-116):
      - urlopen timeout reduced from 15 s to REQUEST_TIMEOUT_SECONDS (5 s, first
        estimate — see constant definition for review schedule). A 30 s
        HardwareController cycle cannot absorb a single 15 s timeout plus
        a subsequent HA fallback call without risking cycle overrun.
      - One intra-cycle retry on socket.timeout (only). HTTP 5xx, URLError, and
        other failures fall through to the caller on first occurrence so the
        existing _consecutive_failures backoff still converges.
      - Successful responses log elapsed wall time at INFO so we can calibrate
        REQUEST_TIMEOUT_SECONDS after one week of production data.
    """
    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token

    data = json.dumps(payload).encode("utf-8")
    req = Request(url or API_URL, data=data, headers=headers, method="POST")

    attempts = 2 if REQUEST_RETRY_ON_TIMEOUT else 1
    for attempt in range(1, attempts + 1):
        try:
            t0 = time.monotonic()
            with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                elapsed = time.monotonic() - t0
                logging.info(f"Octopus API OK in {elapsed:.2f}s (attempt {attempt}/{attempts})")
                if body.get("errors"):
                    for err in body["errors"]:
                        code = err.get("extensions", {}).get("errorCode", "???")
                        msg = err.get("message", "")
                        logging.warning(f"Octopus API error [{code}]: {msg}")
                return body
        except HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8")[:200]
            except Exception:
                # Best-effort error-body read; the HTTP status we already have is sufficient.
                pass
            logging.error(f"Octopus API HTTP {e.code}: {err_body}")
            return None
        except socket.timeout:
            if attempt < attempts:
                logging.warning(
                    f"Octopus API timeout ({REQUEST_TIMEOUT_SECONDS}s) on attempt {attempt}, retrying once"
                )
                continue
            logging.error(f"Octopus API: timed out after {attempts} attempt(s)")
            return None
        except URLError as e:
            # urllib wraps socket.timeout inside URLError when TLS is involved; handle both.
            if isinstance(e.reason, socket.timeout) and attempt < attempts:
                logging.warning(
                    f"Octopus API TLS-wrapped timeout on attempt {attempt}, retrying once"
                )
                continue
            logging.error(f"Octopus API connection error: {e.reason}")
            return None
        except Exception as e:
            # Catches Exception subclasses only; SystemExit/KeyboardInterrupt propagate.
            # (T-14 convention — explicit annotation on broad catch in network-edge code.)
            logging.error(f"Octopus API unexpected error: {e}")
            return None
    return None  # pragma: no cover — unreachable; every loop body path returns. Retained so the function signature remains stable under future refactor and to keep static analysers quiet.


def _ensure_token():
    """
    Ensure we have a valid token. Obtains or refreshes as needed.
    Returns token string or None on failure.
    Thread-safe.
    """
    global _token, _token_expires, _refresh_token, _consecutive_failures

    with _lock:
        now = time.time()

        # Token still valid
        if _token and now < (_token_expires - TOKEN_REFRESH_MARGIN):
            return _token

        # Try refresh first (if we have a refresh token)
        if _refresh_token:
            query = """
            mutation RefreshToken($input: ObtainJSONWebTokenInput!) {
              obtainKrakenToken(input: $input) {
                token
                refreshToken
                refreshExpiresIn
              }
            }
            """
            result = _graphql_request(query, {"input": {"refreshToken": _refresh_token}}, url=AUTH_URL)
            token_data = (result or {}).get("data", {}).get("obtainKrakenToken")
            if token_data and token_data.get("token"):
                _token = token_data["token"]
                _token_expires = now + TOKEN_LIFETIME
                _refresh_token = token_data.get("refreshToken", _refresh_token)
                logging.debug("Octopus API: token refreshed")
                return _token
            else:
                logging.warning("Octopus API: token refresh failed, re-authenticating")

        # Obtain new token with API key
        query = """
        mutation ObtainKrakenToken($input: ObtainJSONWebTokenInput!) {
          obtainKrakenToken(input: $input) {
            token
            refreshToken
            refreshExpiresIn
          }
        }
        """
        result = _graphql_request(query, {"input": {"APIKey": _api_key}}, url=AUTH_URL)
        token_data = (result or {}).get("data", {}).get("obtainKrakenToken")

        if not token_data or not token_data.get("token"):
            logging.error("Octopus API: authentication failed - check api_key")
            _consecutive_failures += 1
            return None

        _token = token_data["token"]
        _token_expires = now + TOKEN_LIFETIME
        _refresh_token = token_data.get("refreshToken")
        _consecutive_failures = 0
        logging.info("Octopus API: authenticated OK")
        return _token


def set_flow_temperature(flow_temp, weather_comp=False, wc_min=30, wc_max=50):
    """
    Set heat pump flow temperature via direct GraphQL mutation.

    Args:
        flow_temp: Target flow temperature in Celsius (e.g. 38.0)
        weather_comp: Enable weather compensation (default False)
        wc_min: Weather comp minimum temperature
        wc_max: Weather comp maximum temperature

    Returns:
        transaction_id string on success, None on failure
    """
    global _consecutive_failures

    if not _initialised:
        logging.debug("Octopus API: not initialised, skipping direct call")
        return None

    # Backoff after repeated failures
    if _consecutive_failures >= _MAX_FAILURES_BEFORE_BACKOFF:
        logging.warning(
            f"Octopus API: {_consecutive_failures} consecutive failures, backing off (will retry next cycle)"
        )
        _consecutive_failures = max(0, _consecutive_failures - 1)  # slowly recover
        return None

    if not _account_number:
        raise RuntimeError("Octopus API: accountNumber is now mandatory for flow temperature mutation")

    token = _ensure_token()
    if not token:
        return None

    # Build mutation payload using discovered schema:
    # FlowTemperatureInput {
    #   useWeatherCompensation: Boolean!
    #   flowTemperature: TemperatureInput        {value: Decimal!, unit: TemperatureUnit!}
    #   weatherCompensationValues: TemperatureRangeInput {
    #     minimum: TemperatureInput!
    #     maximum: TemperatureInput!
    #   }
    # }
    flow_input = {
        "useWeatherCompensation": weather_comp,
        "flowTemperature": {
            "value": _clean_temp(flow_temp),
            "unit": "DEGREES_CELSIUS",
        },
        "weatherCompensationValues": {
            "minimum": {"value": _clean_temp(wc_min), "unit": "DEGREES_CELSIUS"},
            "maximum": {"value": _clean_temp(wc_max), "unit": "DEGREES_CELSIUS"},
        },
    }

    query = """
    mutation SetFlowTemp($accountNumber: String!, $euid: ID!, $input: FlowTemperatureInput!) {
      heatPumpUpdateFlowTemperatureConfiguration(
        accountNumber: $accountNumber,
        euid: $euid,
        flowTemperatureInput: $input
      ) {
        transactionIds { attributeName transactionId }
      }
    }
    """
    variables = {
        "accountNumber": _account_number,
        "euid": _hp_euid,
        "input": flow_input,
    }

    logging.debug(f"Octopus API: flow mutation payload: {json.dumps(flow_input)}")

    result = _graphql_request(query, variables, token=token)

    if not result:
        _consecutive_failures += 1
        return None

    mutation_data = result.get("data", {}).get("heatPumpUpdateFlowTemperatureConfiguration")
    txids = (mutation_data or {}).get("transactionIds") or []

    if txids:
        txid_pairs = [(t.get("attributeName"), t.get("transactionId")) for t in txids]
        _consecutive_failures = 0
        logging.info(f"Octopus API: flow -> {flow_temp}C transactionIds={txid_pairs}")
        return txids[0].get("transactionId")

    # Mutation returned but no transactionId
    _consecutive_failures += 1
    logging.error(f"Octopus API: mutation failed - {json.dumps(result.get('errors', []))}")
    return None


def get_current_hp_mode():
    """
    Read current HP zone mode from HA climate entity.

    Returns HA mode string ('heat', 'off', etc.) or None if unavailable.
    """
    if not _zone_entity_id:
        return None

    try:
        from .integration import fetch_ha_entity

        state = fetch_ha_entity(_zone_entity_id, default=None)
        if state and state in ("heat", "off", "auto"):
            return state
        logging.debug(f"Octopus API: unexpected zone state '{state}'")
        return state
    except Exception as e:
        logging.warning(f"Octopus API: failed to read zone mode: {e}")
        return None


def set_zone_mode(desired_mode, skip_if_current=True):
    """
    Set heat pump zone mode, skipping if already in the desired mode.

    Args:
        desired_mode: HA-style mode string ('heat' or 'off')
        skip_if_current: If True (default), read actual HP mode first
                        and skip the API call if already correct.

    Returns:
        'skipped' if mode already correct,
        transaction_id string on success via direct API,
        'ha_fallback' if fell back to HA service call,
        None on failure

    Compound-failure policy (INSTRUCTION-116):
      When direct + retry + fallback all fail within a single call:
        1. _set_zone_mode_graphql returns None and increments
           _consecutive_failures once (existing behaviour).
        2. _set_zone_mode_ha is called; if it also returns None, set_zone_mode
           returns None. _consecutive_failures is NOT incremented a second
           time — the fallback does not recurse through _graphql_request.
        3. HardwareController observes applied_mode was not set to optimal_mode.
        4. On subsequent cycles, observed_mode != optimal_mode increments
           ctx.readback_mismatch_count; after READBACK_MISMATCH_ALARM_THRESHOLD
           cycles the frontend alarm trips.
        5. The Octopus backoff gates subsequent direct attempts for the
           duration determined by _consecutive_failures.
    """
    global _consecutive_failures

    # Guard: read actual mode and skip if already correct
    if skip_if_current:
        current = get_current_hp_mode()
        if current is not None and current == desired_mode:
            logging.debug(f"HP mode already '{desired_mode}' - skipping API call")
            return "skipped"

    # Primary path: direct GraphQL (avoids the historical BottlecapDave setpoint-reset bug).
    # Fallback path: HA service call — safe on BottlecapDave v17.1.1+ (bug fixed 31 Oct 2025).
    if _initialised and _account_number:
        txid = _set_zone_mode_graphql(desired_mode)
        if txid:
            return txid
        logging.warning("Octopus API direct mutation failed — falling back to HA service call")
        return _set_zone_mode_ha(desired_mode)

    logging.warning("Octopus API not initialised — using HA service fallback for zone mode")
    return _set_zone_mode_ha(desired_mode)


def _set_zone_mode_graphql(desired_mode):
    """
    Set zone mode via direct GraphQL mutation heatPumpSetZoneMode.

    On heat transitions, always includes setpointInCelsius from stored
    zone setpoint to prevent the Cosy defaulting to 20°C.
    On off transitions, sends zone + mode only.

    Returns transaction_id or None.
    """
    global _consecutive_failures

    if _consecutive_failures >= _MAX_FAILURES_BEFORE_BACKOFF:
        _consecutive_failures = max(0, _consecutive_failures - 1)
        return None

    token = _ensure_token()
    if not token:
        return None

    # Map HA mode to GraphQL mode
    gql_mode = _HA_TO_GQL_MODE.get(desired_mode)
    if not gql_mode:
        logging.error(f"Octopus API: unknown mode '{desired_mode}' - cannot map to GraphQL")
        return None

    # SetZoneModeParameters - confirmed via schema introspection:
    #   zone: Zone!  (ENUM: WATER, ZONE_1, ZONE_2, AUXILIARY)
    #   mode: Mode!  (ENUM: ON, OFF, AUTO, BOOST)
    #   setpointInCelsius: Float              (OPTIONAL)
    #   scheduleOverrideAction: ScheduleOverrideAction (OPTIONAL - TURN_ON, TURN_OFF, SET_TEMPERATURE)
    #   endAt: DateTime                      (OPTIONAL)
    #
    # TACTICAL FIX (23-Feb-2026): Always include setpointInCelsius on heat
    # transitions. Previously omitted to avoid the HA integration bug, but
    # the monitoring restart path (ShoulderController) was calling
    # set_zone_mode('heat') without setpoint, causing the Cosy to default
    # to 20°C. By including the correct setpoint at the API layer, ALL
    # callers are protected regardless of which code path fires.
    #
    # For 'off' transitions we still omit it — no setpoint needed.
    operation_params = {
        "mode": gql_mode,
        "zone": "ZONE_1",
    }

    if desired_mode == "heat":
        operation_params["setpointInCelsius"] = _clean_temp(_zone_setpoint)
        logging.info(f"off->heat: including zone setpoint={_zone_setpoint}°C (overtemp protection)")
        logging.info(f"Octopus API: including setpoint={_zone_setpoint}C in mode change")

    query = """
    mutation SetZoneMode(
      $accountNumber: String!,
      $euid: ID!,
      $operationParameters: SetZoneModeParameters!
    ) {
      heatPumpSetZoneMode(
        accountNumber: $accountNumber,
        euid: $euid,
        operationParameters: $operationParameters
      ) {
        transactionId
      }
    }
    """
    variables = {
        "accountNumber": _account_number,
        "euid": _hp_euid,
        "operationParameters": operation_params,
    }

    result = _graphql_request(query, variables, token=token)

    if not result:
        _consecutive_failures += 1
        return None

    mutation_data = result.get("data", {}).get("heatPumpSetZoneMode")

    if mutation_data and mutation_data.get("transactionId"):
        txid = mutation_data["transactionId"]
        _consecutive_failures = 0
        logging.info(f"Octopus API: zone mode -> '{desired_mode}' (tx: {txid[:12]}...)")
        return txid

    _consecutive_failures += 1
    logging.error(f"Octopus API: zone mode mutation failed - {json.dumps(result.get('errors', []))}")
    return None


def _set_zone_mode_ha(desired_mode):
    """
    Fallback: set zone mode via HA service call.

    Safe on BottlecapDave HomeAssistant-OctopusEnergy v17.1.1 or later
    (bug "changing hvac mode incorrectly set temperature" fixed 31-Oct-2025).
    If the install is on an earlier version, set_hvac_mode may re-bundle and
    clobber the zone target temperature — upgrade is required before relying
    on this path.
    """
    try:
        from .integration import set_ha_service

        if not _zone_entity_id:
            logging.error("Octopus API: no zone_entity_id configured for HA fallback")
            return None

        set_ha_service("climate", "set_hvac_mode", {"entity_id": _zone_entity_id, "hvac_mode": desired_mode})
        logging.info(f"HP mode -> '{desired_mode}' (via HA fallback)")
        return "ha_fallback"
    except Exception as e:
        logging.error(f"Octopus API: HA fallback failed: {e}")
        return None


def get_status():
    """
    Return module status dict for diagnostics.
    """
    with _lock:
        return {
            "initialised": _initialised,
            "has_token": _token is not None,
            "token_expires_in": max(0, int(_token_expires - time.time())) if _token else 0,
            "consecutive_failures": _consecutive_failures,
            "euid": _hp_euid,
            "account_number": _account_number or "not set",
            "zone_entity_id": _zone_entity_id or "not set",
        }
