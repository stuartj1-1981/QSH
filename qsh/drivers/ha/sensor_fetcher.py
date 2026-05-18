"""HA sensor fetching — all Home Assistant entity reads for sensor data.

Moved from sensors.py to isolate HA dependencies.
Pure data containers (SensorData, TrvOffsetTracker) remain in sensors.py.
"""

import logging
import time
from typing import Any, Dict, Optional, Set, Tuple

from .integration import fetch_ha_entity, fetch_ha_entity_full
from ...utils import safe_float
from ...sensors import SensorData, SensorHealthTracker, sensor_health, UNAVAILABLE_STATES
from ..resolve import resolve_value, deep_get
from ..hot_water_payloads import classify_hot_water_payload
from ...events import EventKind, EventSpec, get_annunciator


# =========================================================================
# EVENT ANNUNCIATOR REGISTRATION (INSTRUCTION-221C)
# =========================================================================
# Per-call registration. The annunciator singleton can be reset between
# tests; capturing it once at module-import time would leave dangling
# refs. `register()` is idempotent for identical specs so the per-call
# cost is a small dict lookup.
def _register_events() -> None:
    ann = get_annunciator()
    ann.register(EventSpec(
        name="HA.sensor_stale_lastvalid",
        kind=EventKind.LATCHED,
        payload_fields=("key", "entity", "temp"),
        latch_key=("key",),
        default_level=logging.INFO,
    ))
    ann.register(EventSpec(
        name="HA.sensor_stale_no_history",
        kind=EventKind.LATCHED,
        payload_fields=("key", "entity", "fallback"),
        latch_key=("key",),
        default_level=logging.WARNING,
    ))
    ann.register(EventSpec(
        name="HA.sensor_no_entity_configured",
        kind=EventKind.LATCHED,
        payload_fields=("sensor_key",),
        latch_key=("sensor_key",),
        default_level=logging.WARNING,
    ))
    ann.register(EventSpec(
        name="HA.trv_all_stale",
        kind=EventKind.LATCHED,
        payload_fields=("room", "avg_temp"),
        latch_key=("room",),
        default_level=logging.WARNING,
    ))
    ann.register(EventSpec(
        name="HA.outdoor_stale_lastvalid",
        kind=EventKind.LATCHED,
        payload_fields=("temp",),
        default_level=logging.INFO,
    ))


# =========================================================================
# LAST-VALID-VALUE CACHES (PCS7 pattern)
# =========================================================================
_last_valid_outdoor_temp: Optional[float] = None
_last_valid_independent: Dict[str, float] = {}
# INSTRUCTION-224B: per-emitter keying for stale-fallback memory. Outer key is
# (room, stem). For rooms with no derived stems (control_mode "none" or
# operator-declared legacy _heating entity), the synthetic stem "" is used so
# the legacy room-level path shares the same map structure.
_last_valid_heating_perc_per_emitter: Dict[Tuple[str, str], float] = {}
# INSTRUCTION-231A V2 — tracks the entity_id of the most recently fresh
# read for each list-form heating_entity room. Used in the all-stale-
# with-history branch of _legacy_room_level_read to keep
# heating_percs_per_emitter dict shape consistent across fresh / stale-
# with-history / no-history states (HIGH-1 + MEDIUM-1 reviewer findings).
# Without this, the all-stale fallback synthesizes a "" stem key, which
# would interleave a synthetic "" series alongside real per-entity
# series in 224D qsh_emitter historian writes.
# Empty for single-string-declared rooms (they use the synthetic ""
# legacy stem for both fresh and stale paths; shape is consistent
# without the tracker).
_last_winning_entity_per_room: Dict[str, str] = {}

# =========================================================================
# WARN-ONCE SETS (log once per entity, then suppress)
# =========================================================================
_warned_no_heating_entity: Set[str] = set()
# INSTRUCTION-224B: keyed by (room, stem) to match _last_valid_heating_perc_per_emitter.
_warned_valve_stale_no_history: Set[Tuple[str, str]] = set()

# =========================================================================
# POWER UNIT AUTO-DETECTION
# =========================================================================
# Cache: entity_id → divisor (1.0 for kW, 1000.0 for W)
_power_unit_divisors: Dict[str, float] = {}


def _get_power_divisor(entity_id: str) -> float:
    """Auto-detect power unit from HA entity attributes.

    Reads unit_of_measurement once, caches the result (unit doesn't change
    at runtime).  Returns divisor to convert to kW (1.0 if already kW,
    1000.0 if W).

    If the entity is temporarily unavailable the divisor is NOT cached so
    that detection will be retried on the next call.
    """
    if entity_id in _power_unit_divisors:
        return _power_unit_divisors[entity_id]

    full = fetch_ha_entity_full(entity_id)
    if full is None:
        # Don't cache — HA may just be starting up.  Retry next cycle.
        logging.debug(
            "Power sensor %s: entity unavailable, assuming kW (will retry)",
            entity_id,
        )
        return 1.0

    uom = str(full.get("attributes", {}).get("unit_of_measurement", "kW")).strip()

    if uom in ("W", "Watt", "Watts"):
        divisor = 1000.0
        logging.info(
            "Power sensor %s: detected unit '%s' — dividing by 1000 to get kW",
            entity_id,
            uom,
        )
    elif uom in ("kW", "kilowatt", "kilowatts"):
        divisor = 1.0
        logging.info(
            "Power sensor %s: detected unit '%s' — using as-is (kW)",
            entity_id,
            uom,
        )
    else:
        divisor = 1.0
        logging.warning(
            "Power sensor %s: unknown unit '%s' — assuming kW. Expected 'W' or 'kW'",
            entity_id,
            uom,
        )

    _power_unit_divisors[entity_id] = divisor
    return divisor


def _fetch_with_staleness(entity_id: str, category: str, default=None, attr: str = None):
    """
    Fetch a HA entity with staleness tracking.

    Returns:
        (value, is_fresh) - value is the entity state/attribute, is_fresh
        is True if the sensor is available (not unavailable/unknown)
    """
    full = fetch_ha_entity_full(entity_id)
    if full is None:
        return default, False

    is_fresh = sensor_health.check(entity_id, full.get("state"), category)

    if not is_fresh:
        return default, False

    if attr:
        value = full.get("attributes", {}).get(attr, default)
    else:
        value = full.get("state", default)

    return value, is_fresh


def fetch_independent_sensors(config: Dict) -> Dict[str, float]:
    """Fetch all independent temperature sensors dynamically from config."""
    global _last_valid_independent
    _register_events()
    ann = get_annunciator()
    sensors = {}

    sensor_keys = {key for key in config["entities"] if key.startswith("independent_sensor")}

    for room, sensor_key in config.get("zone_sensor_map", {}).items():
        if sensor_key.startswith("independent_sensor"):
            sensor_keys.add(sensor_key)

    if not sensor_keys:
        logging.warning("No independent sensors found in config")
        return sensors

    logging.debug(f"Fetching {len(sensor_keys)} independent sensors")
    fallback_temp = config.get("overtemp_protection", 23.0)

    for sensor_key in sorted(sensor_keys):
        entity_id = config["entities"].get(sensor_key)
        if entity_id:
            # Entity is now configured — clear any "no entity configured" latch.
            ann.exited("HA.sensor_no_entity_configured", sensor_key=sensor_key)
            temp_raw, is_fresh = _fetch_with_staleness(entity_id, "temperature", default=fallback_temp)

            if is_fresh:
                temp = safe_float(temp_raw, fallback_temp)
                sensors[sensor_key] = temp
                _last_valid_independent[sensor_key] = temp
                # Fresh recovery: clear any stale latches for this sensor.
                ann.exited("HA.sensor_stale_lastvalid", key=sensor_key)
                ann.exited("HA.sensor_stale_no_history", key=sensor_key)
            else:
                if sensor_key in _last_valid_independent:
                    sensors[sensor_key] = _last_valid_independent[sensor_key]
                    ann.entered(
                        "HA.sensor_stale_lastvalid",
                        key=sensor_key,
                        entity=entity_id,
                        temp=round(_last_valid_independent[sensor_key], 1),
                    )
                else:
                    sensors[sensor_key] = fallback_temp
                    ann.entered(
                        "HA.sensor_stale_no_history",
                        key=sensor_key,
                        entity=entity_id,
                        fallback=round(fallback_temp, 1),
                    )
        else:
            ann.entered("HA.sensor_no_entity_configured", sensor_key=sensor_key)
            sensors[sensor_key] = _last_valid_independent.get(sensor_key, config.get("overtemp_protection", 23.0))

    return sensors


def fetch_trv_temperatures(config: Dict) -> Dict[str, float]:
    """Fetch TRV built-in sensor temperatures for all rooms."""
    trv_temps = {}

    for room in config["rooms"]:
        climate_key = f"{room}_temp_set_hum"
        climate_entity = config["entities"].get(climate_key)

        if not climate_entity:
            continue

        entities = climate_entity if isinstance(climate_entity, list) else [climate_entity]
        temps = []

        for entity in entities:
            temp_raw, is_fresh = _fetch_with_staleness(entity, "trv", default=None, attr="current_temperature")
            if temp_raw not in (None, "unavailable", "unknown", ""):
                temp = safe_float(temp_raw, None)
                if temp is not None:
                    temps.append(temp)

        if temps:
            trv_temps[room] = sum(temps) / len(temps)

    return trv_temps


def fetch_trv_setpoints(config: Dict) -> Dict[str, float]:
    """Fetch current TRV setpoints (target temperature) for all rooms.

    Reads the 'temperature' attribute from climate entities, which is
    the setpoint the TRV is currently working towards.
    """
    trv_setpoints = {}

    for room in config["rooms"]:
        climate_key = f"{room}_temp_set_hum"
        climate_entity = config["entities"].get(climate_key)

        if not climate_entity:
            continue

        entities = climate_entity if isinstance(climate_entity, list) else [climate_entity]
        setpoints = []

        for entity in entities:
            sp_raw, is_fresh = _fetch_with_staleness(entity, "trv_sp", default=None, attr="temperature")
            if sp_raw not in (None, "unavailable", "unknown", ""):
                sp = safe_float(sp_raw, None)
                if sp is not None:
                    setpoints.append(sp)

        if setpoints:
            trv_setpoints[room] = sum(setpoints) / len(setpoints)

    return trv_setpoints


def classify_temperature_source(room: str, config: Dict) -> str:
    """Classify a room's configured temperature source from static config alone.

    Returns one of:
      - "independent" — zone_sensor_map[room] resolves to an entities[] entry
      - "trv"         — entities["{room}_temp_set_hum"] is configured (sensor or list)
      - "none_configured" — neither of the above

    Pure function. Does not touch HA. Re-evaluated each cycle (cheap). Runtime
    states ("trv_stale", "unavailable") are layered on top by get_room_temperature.

    M1 re-evaluation guarantee: this function is called every cycle. If config
    changes, classification flips on the next cycle automatically. No cache.
    """
    sensor_key = config.get("zone_sensor_map", {}).get(room)
    if sensor_key and config.get("entities", {}).get(sensor_key):
        return "independent"
    climate_entity = config.get("entities", {}).get(f"{room}_temp_set_hum")
    if climate_entity:
        return "trv"
    return "none_configured"


# Per-room rising-edge tracker for unavailable-state logging (D1).
# Pattern lifted from _last_valid_outdoor_temp at module top.
# True = last cycle this room was in the "unavailable" state and we have
# already logged the rising edge. False / absent = last cycle was healthy
# (or this is the first cycle).
_unavailable_state: Dict[str, bool] = {}


def _mark_temperature_recovered(room: str) -> None:
    """Reset the unavailable-state tracker; log INFO if recovering."""
    if _unavailable_state.get(room, False):
        logging.info(f"{room}: temperature source recovered")
        _unavailable_state[room] = False


def get_room_temperature(
    room: str, config: Dict, sensor_temps: Optional[Dict] = None
) -> Optional[float]:
    """Get room temperature with priority: independent sensor > climate entity > None.

    Returns None when the room has no configured source (none_configured, silent)
    OR when all configured sources returned no usable value this cycle (unavailable,
    rising-edge WARNING). Callers MUST handle None — the previous overtemp_protection
    fallback is gone.
    """
    classification = classify_temperature_source(room, config)

    if classification == "none_configured":
        # Static config fact, not a runtime fault. No log, no transition tracking.
        # V2.1 (L1): clear any stale unavailable-state entry from a prior
        # classification — prevents a masked rising edge if config later flips
        # back to "independent" while the underlying sensor is still unhealthy.
        _unavailable_state.pop(room, None)
        return None

    target_temp = config.get("overtemp_protection", 23.0)

    sensor_key = config["zone_sensor_map"].get(room)
    if sensor_key:
        entity_id = config["entities"].get(sensor_key)
        is_stale = entity_id and sensor_health.is_stale(entity_id)

        if not is_stale and sensor_temps and sensor_key in sensor_temps:
            temp = sensor_temps[sensor_key]
            if temp is not None and temp != target_temp:
                _mark_temperature_recovered(room)
                return temp
        elif is_stale:
            logging.debug(f"{room}: independent sensor {entity_id} is stale, falling back to TRV reading")

        sensor_entity = config["entities"].get(sensor_key)
        if sensor_entity:
            temp_raw = fetch_ha_entity(sensor_entity, default=None)
            if temp_raw not in (None, "unavailable", "unknown", ""):
                temp = safe_float(temp_raw, None)
                if temp is not None:
                    logging.debug(f"{room} temp from independent sensor {sensor_key}: {temp:.1f}C")
                    _mark_temperature_recovered(room)
                    return temp

    climate_key = f"{room}_temp_set_hum"
    climate_entity = config["entities"].get(climate_key)

    if climate_entity:
        entities_to_check = climate_entity if isinstance(climate_entity, list) else [climate_entity]

        temps = []
        all_stale = True
        for entity in entities_to_check:
            if not sensor_health.is_stale(entity):
                all_stale = False
            temp_raw = fetch_ha_entity(entity, attr="current_temperature", default=None)
            if temp_raw not in (None, "unavailable", "unknown", ""):
                temp = safe_float(temp_raw, None)
                if temp is not None:
                    temps.append(temp)

        if temps:
            avg_temp = sum(temps) / len(temps)
            _register_events()
            ann = get_annunciator()
            if all_stale:
                ann.entered(
                    "HA.trv_all_stale", room=room, avg_temp=round(avg_temp, 1),
                )
            else:
                ann.exited("HA.trv_all_stale", room=room)
                logging.debug(f"{room} temp from climate entity (avg of {len(temps)} TRVs): {avg_temp:.1f}C")
            _mark_temperature_recovered(room)
            return avg_temp

    # Configured source went unavailable — rising-edge WARNING only.
    was_unavailable = _unavailable_state.get(room, False)
    if not was_unavailable:
        logging.warning(
            f"{room}: configured temperature source went unavailable "
            f"(classification={classification})"
        )
        _unavailable_state[room] = True
    return None


def fetch_room_temperatures(config: Dict, sensor_temps: Dict[str, float]) -> Dict[str, float]:
    """Fetch temperatures for all rooms with a usable reading this cycle.

    Rooms with no configured source OR whose configured source returned no value
    this cycle are OMITTED from the output dict. Callers MUST tolerate missing
    keys. This matches the MQTT driver's existing behaviour (see
    test_mqtt_driver.py:211).
    """
    room_temps: Dict[str, float] = {}
    for room in config["rooms"]:
        temp = get_room_temperature(room, config, sensor_temps)
        if temp is not None:
            room_temps[room] = temp

    target = config.get("overtemp_protection", 23.0)
    cold_rooms = []
    for room, temp in room_temps.items():
        delta = target - temp
        if delta > 0.5:
            cold_rooms.append(f"{room}:{temp:.1f}C({delta:+.1f})")

    if cold_rooms:
        logging.debug(
            f"Rooms below target: {', '.join(cold_rooms[:5])}"
            + (f" +{len(cold_rooms) - 5} more" if len(cold_rooms) > 5 else "")
        )

    return room_temps


def fetch_room_temperature_sources(config: Dict) -> Dict[str, str]:
    """Per-room classification dict for every room in config['rooms']. Always
    contains every configured room. Pure config-derived; no HA fetch.
    """
    return {room: classify_temperature_source(room, config) for room in config["rooms"]}


def _enumerate_emitter_stems(room: str, config: Dict) -> "list[str]":
    """Return the list of TRV stems for a room (INSTRUCTION-224B).

    Pulls from ``config["room_trv_names"]`` which is populated at config-load
    time from ``trv_name`` (explicit override) or derived from ``trv_entity``
    (canonical case). Returns an empty list for rooms without any TRV
    declaration — caller falls through to the legacy room-level read path.
    """
    return list(config.get("room_trv_names", {}).get(room, []))


def _read_one_valve_position(
    entity: str, room: str, stem: str, scale: int
) -> Optional[float]:
    """Read one valve_position entity with scale conversion and stale-fallback
    keyed per (room, stem). INSTRUCTION-224B.

    Returns:
        Fresh scaled value (0-100) on success.
        Last-valid value if HA is unavailable but history exists.
        ``None`` if unavailable AND no history (caller falls back to room-level).
    """
    global _last_valid_heating_perc_per_emitter
    key = (room, stem)
    perc_raw, is_fresh = _fetch_with_staleness(entity, "valve", default=0.0)

    if is_fresh:
        perc = safe_float(perc_raw, 0.0)
        if scale != 100:
            perc = round(perc / float(scale) * 100.0, 1)
        _last_valid_heating_perc_per_emitter[key] = perc
        return perc

    if key in _last_valid_heating_perc_per_emitter:
        last = _last_valid_heating_perc_per_emitter[key]
        logging.info(
            "Valve %s/%s (%s) stale - using last valid: %.1f%%",
            room, stem, entity, last,
        )
        return last

    if key not in _warned_valve_stale_no_history:
        logging.info(
            "Valve %s/%s (%s) stale — no history, using 0%% fallback",
            room, stem, entity,
        )
        _warned_valve_stale_no_history.add(key)
    return None


def _legacy_room_level_read(
    room: str, config: Dict, scale: int
) -> Tuple[float, Dict[str, float]]:
    """Operator-declared ``<room>_heating`` entity read (INSTRUCTION-224B
    legacy path, fallback semantics restored by INSTRUCTION-229,
    list-form support added by INSTRUCTION-231A V2).

    Exercised by ``fetch_heating_percentages`` whenever a room has
    ``heating_entity`` declared in YAML. Bypasses the 224B per-emitter
    auto-derive entirely; the declared entity (or list of entities) is
    the authoritative feedback source.

    Single-string ``heating_entity``: read the entity, apply scale
    rescale, return aggregate + ``{"": value}`` per-emitter dict.

    List-form ``heating_entity`` (length >= 2 — list-of-1 was collapsed
    to scalar by ``config.py:967`` flattener): iterate in declaration
    order, return the first fresh value, populate per-emitter dict with
    ``{winning_entity_id: value}``. Mirror the value to the room's
    legacy_key memory so the all-stale-with-history branch can recover
    (V2 HIGH-1 fix). Track the winning entity in
    ``_last_winning_entity_per_room`` so the all-stale-with-history
    branch produces a consistent dict shape keyed by the last-winning
    entity rather than synthesizing a ``""`` stem (V2 MEDIUM-1 fix).

    If all entities are stale and ``legacy_key`` memory exists, return
    the last-valid aggregate with the per-emitter dict keyed by the
    last winning entity (list-form) or ``""`` (single-string). If no
    history exists either, return 0.0 (preserving the 229 "no path
    configured → 0%" contract).

    Returns:
        ``(aggregate_pct, per_emitter_dict)`` where aggregate is 0–100
        and per_emitter_dict is keyed:
        - ``{"": value}`` for single-string fresh or stale-with-history.
        - ``{winning_entity_id: value}`` for list-form fresh.
        - ``{last_winning_entity_id: last}`` for list-form
          stale-with-history.
        - ``{}`` for no path configured / no history available.
    """
    global _last_valid_heating_perc_per_emitter
    global _last_winning_entity_per_room
    heating_entity = config["entities"].get(room + "_heating")
    legacy_key = (room, "")

    if not heating_entity:
        if room not in _warned_no_heating_entity:
            logging.info(
                "Room '%s' has no heating entity configured — using "
                "fallback valve position.",
                room,
            )
            _warned_no_heating_entity.add(room)
        last = _last_valid_heating_perc_per_emitter.get(legacy_key, 0.0)
        per_emitter = (
            {"": last}
            if legacy_key in _last_valid_heating_perc_per_emitter
            else {}
        )
        return last, per_emitter

    # Normalise to a list for unified iteration. Single-string is treated
    # as a length-1 list internally; the synthetic legacy stem "" is used
    # for last-valid keying to preserve pre-231A memory continuity.
    if isinstance(heating_entity, list):
        entity_list = heating_entity
        single_string = False
    else:
        entity_list = [heating_entity]
        single_string = True

    # Iterate in declaration order; first fresh read wins.
    for entity_id in entity_list:
        # Per-entity last-valid key. Single-string uses the synthetic ""
        # stem to preserve pre-231A last-valid memory continuity. List-
        # form uses the entity_id as the stem so each entity has its own
        # stale-fallback history under (room, entity_id).
        key = legacy_key if single_string else (room, entity_id)
        perc_raw, is_fresh = _fetch_with_staleness(
            entity_id, "valve", default=0.0
        )
        if is_fresh:
            perc = safe_float(perc_raw, 0.0)
            if scale != 100:
                perc = round(perc / float(scale) * 100.0, 1)
            _last_valid_heating_perc_per_emitter[key] = perc
            if not single_string:
                # V2 HIGH-1 fix: mirror the fresh value to legacy_key so
                # the all-stale-with-history branch can recover the
                # aggregate from room-level memory. Without this, list-
                # form rooms whose entities all go stale on the same
                # cycle would drop to 0.0 (no-history contract) until at
                # least one entity returned fresh again.
                _last_valid_heating_perc_per_emitter[legacy_key] = perc
                # V2 MEDIUM-1 fix: track the winning entity so the all-
                # stale-with-history branch keys its per-emitter dict
                # consistently by the last winning entity_id.
                _last_winning_entity_per_room[room] = entity_id
            return perc, {("" if single_string else entity_id): perc}

    # All entities stale. Fall back to room-level last-valid memory under
    # the synthetic legacy stem (V2: list-form fresh branch mirrors to
    # legacy_key, so this branch is reachable for both shapes).
    if legacy_key in _last_valid_heating_perc_per_emitter:
        last = _last_valid_heating_perc_per_emitter[legacy_key]
        if single_string:
            return last, {"": last}
        # V2 MEDIUM-1 fix: list-form — key the per-emitter dict by the
        # last-winning entity rather than synthesizing "". Fallback to
        # the first entity in declaration order if no winner has ever
        # been recorded (edge case: legacy_key populated without a
        # winner — shouldn't happen post-V2 fresh-branch mirror, but
        # defensive).
        last_winner = _last_winning_entity_per_room.get(
            room, entity_list[0]
        )
        return last, {last_winner: last}

    # All stale AND no history. Emit a single info log naming the first
    # entity and return 0.0. Subsequent cycles in the same condition are
    # suppressed via the existing warn-once set.
    if legacy_key not in _warned_valve_stale_no_history:
        first_entity = entity_list[0]
        logging.info(
            "Valve %s (%s%s) stale — no history, using 0%% fallback",
            room,
            first_entity,
            f" and {len(entity_list) - 1} others" if not single_string else "",
        )
        _warned_valve_stale_no_history.add(legacy_key)
    return 0.0, {}


def fetch_heating_percentages(
    config: Dict,
) -> Tuple[Dict[str, float], Dict[str, Dict[str, float]], float]:
    """Fetch TRV valve positions per room with per-emitter detail.

    Post-INSTRUCTION-231A: operator-declared ``heating_entity`` is the
    authoritative feedback path for every room. The 224B per-emitter
    auto-derive (``number.<stem>_valve_position`` for each derived TRV
    stem) is preserved as the fallback for installations that never
    declared explicit ``heating_entity`` — typically Sonoff-only
    installations using the auto-naming convention.

    For rooms with ``heating_entity`` declared:
    - Single string: pre-224B single-entity read (no auto-derive, no
      spurious 404s for non-Sonoff hardware).
    - List of strings: iterate in declaration order, return the first
      fresh value; last-valid fallback follows the single-entity
      staleness pattern.

    Per-emitter dict ``heating_percs_per_emitter[room]`` is populated
    with stable shape across cycles (V2 MEDIUM-1 contract):
    - For single-string ``heating_entity``: ``{"": value}`` for fresh
      and stale-with-history; ``{}`` for no-history.
    - For list-form ``heating_entity``: ``{current_winner: value}`` for
      fresh, ``{last_winner: last}`` for stale-with-history (the same
      stem key is used across consecutive cycles so 224D qsh_emitter
      historian writes maintain a continuous per-room time-series);
      ``{}`` for no-history.
    - For 224B auto-derive (no ``heating_entity`` declared):
      ``{stem: value}`` per fresh per-emitter read.

    Returns:
        Tuple of:
        - heating_percs: room → aggregate valve position 0-100.
        - heating_percs_per_emitter: room → entity_or_stem → value.
        - avg_open_frac: mean of room aggregates / 100 across rooms.
    """
    heating_percs: Dict[str, float] = {}
    heating_percs_per_emitter: Dict[str, Dict[str, float]] = {}
    total_frac = 0.0
    num_rooms = len(config["rooms"])

    if num_rooms == 0:
        logging.warning("No rooms defined in HOUSE_CONFIG - skipping heating perc fetch.")
        return {}, {}, 0.0

    valve_scales = config.get("room_valve_scale", {})
    type1_rooms = {
        r for r, hw in config.get("room_valve_hardware", {}).items()
        if hw == "direct_type1"
    }

    for room in config["rooms"]:
        scale = valve_scales.get(room, 255 if room in type1_rooms else 100)
        declared_heating_entity = config["entities"].get(room + "_heating")

        if declared_heating_entity is not None:
            # INSTRUCTION-231A — operator declared heating_entity for this
            # room (str or list[str]); take it as authoritative and skip the
            # 224B per-emitter auto-derive. This restores pre-224B
            # single-read behaviour for single-emitter rooms (no spurious
            # 404s for non-Sonoff hardware) and enables list-form iteration
            # for multi-emitter zones with operator-declared per-emitter
            # feedback entities. _legacy_room_level_read handles both shapes
            # and populates heating_percs_per_emitter[room] with one entry
            # keyed by the synthetic legacy stem (single-string case) or
            # the winning / last-winning entity id (list-form case per V2
            # MEDIUM-1 fix).
            room_perc, per_emitter = _legacy_room_level_read(
                room, config, scale
            )
            heating_percs[room] = room_perc
            heating_percs_per_emitter[room] = per_emitter
        else:
            # No declared heating_entity. Fall back to the 224B auto-derive
            # path (Sonoff-only convenience shortcut for installations that
            # never declared explicit feedback entities).
            stems = _enumerate_emitter_stems(room, config)
            per_emitter: Dict[str, float] = {}
            for stem in stems:
                entity = f"number.{stem}_valve_position"
                perc = _read_one_valve_position(entity, room, stem, scale)
                if perc is not None:
                    per_emitter[stem] = perc

            heating_percs_per_emitter[room] = per_emitter

            if per_emitter:
                aggregate = round(
                    sum(per_emitter.values()) / len(per_emitter), 1
                )
                heating_percs[room] = aggregate
            else:
                # No fresh per-emitter reads AND no declared heating_entity.
                # V2 LOW-2 fix: properly handle the per_emitter dict from
                # the legacy path. If _legacy_room_level_read returns a
                # non-empty dict (room-level last-valid memory exists from
                # a prior cycle's successful auto-derive read), use it;
                # else preserve the failed-auto-derive empty dict shape.
                room_perc, per_emitter_legacy = _legacy_room_level_read(
                    room, config, scale
                )
                heating_percs[room] = room_perc
                if per_emitter_legacy:
                    heating_percs_per_emitter[room] = per_emitter_legacy

        total_frac += heating_percs[room] / 100.0

    avg_open_frac = total_frac / num_rooms if num_rooms > 0 else 0.0

    return heating_percs, heating_percs_per_emitter, avg_open_frac


# INSTRUCTION-241A Task 2a — per-source sensor key map. Mirrors the legacy
# sensor_map at qsh/config.py:1536-1547 but indexed by the per-source yaml key
# (which appears under heat_sources[i].sensors.<key>).
_PER_SOURCE_SENSOR_KEYS = (
    "flow_temp",
    "power_input",
    "heat_output",
    "cop",
    "delta_t",
    "return_temp",
    "flow_rate",
    "total_energy",
    "pump_power",
)


def _fetch_heat_source_status_for(
    sensors_block: Dict,
    default_efficiency: float,
    default_flow_temp: float,
    default_return_temp: float,
) -> Dict:
    """Per-source heat-source fetch.

    Reads each entry of `sensors_block` as a HA entity_id and returns the
    same result-dict shape as the legacy `fetch_heat_source_status`, with
    additional keys `total_energy` and `pump_power` for non-HP sources.

    sensors_block: the per-source `sensors:` mapping from
        config['heat_sources'][i]['sensors']. Entries may be missing —
        the function defaults each unfilled slot.
    """
    result = {
        "flow_temp": default_flow_temp,
        "power": 0.0,
        "output": 0.0,
        "cop": default_efficiency,
        "delta_t": 3.0,
        "return_temp": default_return_temp,
        "flow_rate": 0.0,
        "total_energy": 0.0,
        "pump_power": 0.0,
        "has_live_cop": False,
        "has_live_delta_t": False,
        "has_live_power": False,
        "has_live_return_temp": False,
        "has_live_flow_rate": False,
    }

    flow_entity = sensors_block.get("flow_temp")
    if flow_entity:
        val_raw, is_fresh = _fetch_with_staleness(flow_entity, "heat_source", default=default_flow_temp)
        result["flow_temp"] = safe_float(val_raw, default_flow_temp)
        if not is_fresh:
            logging.debug(f"Flow temp sensor stale  -  using last known {result['flow_temp']:.1f}C")

    power_entity = sensors_block.get("power_input")
    if power_entity:
        val_raw, is_fresh = _fetch_with_staleness(power_entity, "heat_source", default=None)
        val = safe_float(val_raw, None)
        if val is not None:
            val = val / _get_power_divisor(power_entity)
        if val is not None and is_fresh:
            result["power"] = val
            result["has_live_power"] = True
        elif val is not None and not is_fresh:
            result["power"] = val
            result["has_live_power"] = False
            logging.debug(f"Power sensor stale  -  value {val:.2f}kW not trusted for reward")

    output_entity = sensors_block.get("heat_output")
    if output_entity:
        val_raw, is_fresh = _fetch_with_staleness(output_entity, "heat_source", default=0.0)
        result["output"] = safe_float(val_raw, 0.0) / _get_power_divisor(output_entity)

    cop_entity = sensors_block.get("cop")
    if cop_entity:
        cop_raw, is_fresh = _fetch_with_staleness(cop_entity, "heat_source", default=None)
        cop_val = safe_float(cop_raw, None)
        if cop_val is not None and 0.5 <= cop_val <= 10.0 and is_fresh:
            result["cop"] = cop_val
            result["has_live_cop"] = True
        elif cop_val is not None and not is_fresh:
            logging.debug(f"COP sensor stale  -  using default {default_efficiency}")

    dt_entity = sensors_block.get("delta_t")
    if dt_entity:
        dt_raw, is_fresh = _fetch_with_staleness(dt_entity, "heat_source", default=None)
        dt_val = safe_float(dt_raw, None)
        if dt_val is not None and is_fresh:
            result["delta_t"] = dt_val
            result["has_live_delta_t"] = True
        elif dt_val is not None and not is_fresh:
            result["delta_t"] = dt_val
            result["has_live_delta_t"] = False

    return_entity = sensors_block.get("return_temp")
    if return_entity:
        rt_raw, is_fresh = _fetch_with_staleness(return_entity, "heat_source", default=None)
        rt_val = safe_float(rt_raw, None)
        if rt_val is not None and is_fresh:
            result["return_temp"] = rt_val
            result["has_live_return_temp"] = True
            if not result["has_live_delta_t"] and result["flow_temp"] > 0:
                calculated_dt = result["flow_temp"] - rt_val
                result["delta_t"] = calculated_dt
                result["has_live_delta_t"] = True
                logging.debug(
                    f"Delta-T calculated from flow/return: "
                    f"{result['flow_temp']:.1f} - {rt_val:.1f} = {calculated_dt:.1f}°C"
                )
        elif rt_val is not None and not is_fresh:
            result["return_temp"] = rt_val
            result["has_live_return_temp"] = False

    fr_entity = sensors_block.get("flow_rate")
    if fr_entity:
        fr_raw, is_fresh = _fetch_with_staleness(fr_entity, "heat_source", default=None)
        fr_val = safe_float(fr_raw, None)
        if fr_val is not None and is_fresh:
            result["flow_rate"] = fr_val
            result["has_live_flow_rate"] = True
        elif fr_val is not None and not is_fresh:
            result["flow_rate"] = fr_val
            result["has_live_flow_rate"] = False
            logging.debug(f"Flow rate sensor stale  -  value {fr_val:.2f} L/min not trusted")

    te_entity = sensors_block.get("total_energy")
    if te_entity:
        te_raw, _ = _fetch_with_staleness(te_entity, "heat_source", default=0.0)
        result["total_energy"] = safe_float(te_raw, 0.0)

    pp_entity = sensors_block.get("pump_power")
    if pp_entity:
        pp_raw, _ = _fetch_with_staleness(pp_entity, "heat_source", default=0.0)
        result["pump_power"] = safe_float(pp_raw, 0.0) / _get_power_divisor(pp_entity)

    return result


def fetch_heat_source_status(config: Dict) -> Dict:
    """Fetch heat source operating status with graceful degradation.

    Legacy path — reads from config['entities'] using the singular-source
    entity keys (hp_flow_temp, hp_energy_rate, etc.). Kept for backward
    compatibility with single-source code paths. INSTRUCTION-241A retains
    this function unchanged in semantics; the per-source acquisition layer
    is provided by `fetch_all_heat_source_statuses` and consumed via
    `HeatSourceSensorSelector`.
    """
    entities = config["entities"]
    default_efficiency = config.get("heat_source_efficiency", 3.5)

    result = {
        "flow_temp": config.get("default_flow_temp", 35.0),
        "power": 0.0,
        "output": 0.0,
        "cop": default_efficiency,
        "delta_t": 3.0,
        "return_temp": config.get("default_return_temp", 30.0),
        "flow_rate": 0.0,
        "has_live_cop": False,
        "has_live_delta_t": False,
        "has_live_power": False,
        "has_live_return_temp": False,
        "has_live_flow_rate": False,
    }

    flow_entity = entities.get("hp_flow_temp")
    if flow_entity:
        val_raw, is_fresh = _fetch_with_staleness(flow_entity, "heat_source", default=35.0)
        result["flow_temp"] = safe_float(val_raw, 35.0)
        if not is_fresh:
            logging.debug(f"Flow temp sensor stale  -  using last known {result['flow_temp']:.1f}C")

    power_entity = entities.get("hp_energy_rate")
    if power_entity:
        val_raw, is_fresh = _fetch_with_staleness(power_entity, "heat_source", default=None)
        val = safe_float(val_raw, None)
        if val is not None:
            val = val / _get_power_divisor(power_entity)
        if val is not None and is_fresh:
            result["power"] = val
            result["has_live_power"] = True
        elif val is not None and not is_fresh:
            result["power"] = val
            result["has_live_power"] = False
            logging.debug(f"Power sensor stale  -  value {val:.2f}kW not trusted for reward")

    output_entity = entities.get("hp_output")
    if output_entity:
        val_raw, is_fresh = _fetch_with_staleness(output_entity, "heat_source", default=0.0)
        result["output"] = safe_float(val_raw, 0.0) / _get_power_divisor(output_entity)

    if config.get("has_cop_sensor"):
        cop_entity = entities.get("hp_cop")
        if cop_entity:
            cop_raw, is_fresh = _fetch_with_staleness(cop_entity, "heat_source", default=None)
            cop_val = safe_float(cop_raw, None)
            if cop_val is not None and 0.5 <= cop_val <= 10.0 and is_fresh:
                result["cop"] = cop_val
                result["has_live_cop"] = True
            elif cop_val is not None and not is_fresh:
                logging.debug(f"COP sensor stale  -  using default {default_efficiency}")

    dt_entity = entities.get("primary_diff")
    if dt_entity:
        dt_raw, is_fresh = _fetch_with_staleness(dt_entity, "heat_source", default=None)
        dt_val = safe_float(dt_raw, None)
        if dt_val is not None and is_fresh:
            result["delta_t"] = dt_val
            result["has_live_delta_t"] = True
        elif dt_val is not None and not is_fresh:
            result["delta_t"] = dt_val
            result["has_live_delta_t"] = False

    return_entity = entities.get("hp_return_temp")
    if return_entity:
        rt_raw, is_fresh = _fetch_with_staleness(return_entity, "heat_source", default=None)
        rt_val = safe_float(rt_raw, None)
        if rt_val is not None and is_fresh:
            result["return_temp"] = rt_val
            result["has_live_return_temp"] = True
            if not result["has_live_delta_t"] and result["flow_temp"] > 0:
                calculated_dt = result["flow_temp"] - rt_val
                result["delta_t"] = calculated_dt
                result["has_live_delta_t"] = True
                logging.debug(
                    f"Delta-T calculated from flow/return: "
                    f"{result['flow_temp']:.1f} - {rt_val:.1f} = {calculated_dt:.1f}°C"
                )
        elif rt_val is not None and not is_fresh:
            result["return_temp"] = rt_val
            result["has_live_return_temp"] = False

    fr_entity = entities.get("hp_flow_rate")
    if fr_entity:
        fr_raw, is_fresh = _fetch_with_staleness(fr_entity, "heat_source", default=None)
        fr_val = safe_float(fr_raw, None)
        if fr_val is not None and is_fresh:
            result["flow_rate"] = fr_val
            result["has_live_flow_rate"] = True
        elif fr_val is not None and not is_fresh:
            result["flow_rate"] = fr_val
            result["has_live_flow_rate"] = False
            logging.debug(f"Flow rate sensor stale  -  value {fr_val:.2f} L/min not trusted")

    return result


def fetch_all_heat_source_statuses(config: Dict) -> Dict[str, Dict]:
    """Per-source HA acquisition (INSTRUCTION-241A Task 2b).

    Iterates `config['heat_sources']` and returns a dict keyed by source name,
    each value being the same shape as `fetch_heat_source_status`'s result
    plus `total_energy` and `pump_power`. Legacy singular config (empty
    `heat_sources`) falls back to a one-entry dict keyed by the resolved
    singular source's name.
    """
    sources = config.get("heat_sources", []) or []
    default_efficiency = config.get("heat_source_efficiency", 3.5)
    default_flow_temp = config.get("default_flow_temp", 35.0)
    default_return_temp = config.get("default_return_temp", 30.0)

    out: Dict[str, Dict] = {}

    if sources:
        for source in sources:
            name = source.get("name") or "heat_source"
            sensors_block = source.get("sensors") or {}
            result = _fetch_heat_source_status_for(
                sensors_block, default_efficiency, default_flow_temp, default_return_temp,
            )
            result["name"] = name
            out[name] = result
        return out

    # Legacy singular config — synthesise one entry keyed by the singular
    # source's name. Reads from the old config['entities'] map for backward
    # compatibility (matches the legacy fetch_heat_source_status semantics).
    legacy = fetch_heat_source_status(config)
    legacy.setdefault("total_energy", 0.0)
    legacy.setdefault("pump_power", 0.0)
    legacy_name = config.get("active_source_name") or "heat_source"
    legacy["name"] = legacy_name
    out[legacy_name] = legacy
    return out


def fetch_energy_data(config: Dict) -> Dict[str, float]:
    """Fetch battery, solar, and grid data."""
    entities = config["entities"]

    _default_soc = config.get("default_battery_soc", 50.0)
    result = {
        "battery_soc": _default_soc,
        "solar_production": 0.0,
        "grid_power": 0.0,
        "excess_solar": 0.0,
        "export_kw": 0.0,
        "has_solar": False,
        "has_battery": False,
    }

    solar_entity = entities.get("solar_production")
    if solar_entity:
        val_raw, is_fresh = _fetch_with_staleness(solar_entity, "energy", default=0.0)
        val = safe_float(val_raw, 0.0)
        if is_fresh:
            val_kw = val / _get_power_divisor(solar_entity)
            result["solar_production"] = val_kw
            result["excess_solar"] = max(0, val_kw)
            result["has_solar"] = True
        else:
            result["solar_production"] = 0.0
            result["has_solar"] = False

    grid_entity = entities.get("grid_power")
    if grid_entity:
        grid_raw, is_fresh = _fetch_with_staleness(grid_entity, "energy", default=0.0)
        grid_val = safe_float(grid_raw, 0.0)
        if is_fresh:
            grid_kw = grid_val / _get_power_divisor(grid_entity)
            result["grid_power"] = grid_kw
            result["export_kw"] = max(0, -grid_kw) if grid_kw < 0 else 0.0

    battery_entity = entities.get("battery_soc")
    if battery_entity:
        soc_raw, is_fresh = _fetch_with_staleness(battery_entity, "energy", default=_default_soc)
        if is_fresh:
            result["battery_soc"] = safe_float(soc_raw, _default_soc)
            result["has_battery"] = True
        else:
            result["battery_soc"] = _default_soc
            result["has_battery"] = False

    return result


def fetch_source_raw_values(config: Dict) -> Dict[str, Any]:
    """Fetch raw source-power sensor values for the SourceResolver.

    INSTRUCTION-117A Task 4. Returns a dict with the six optional slots
    consumed by `qsh.pipeline.source_resolver.SourceResolver.resolve()`:
      * hp_energy_rate    — HP electrical input (kW) — existing HP slot
      * hp_thermal_output — HP heat output (kW) — new optional slot
      * hp_cop            — HP pre-computed COP — existing HP slot
      * boiler_power_input   — boiler fuel-input (kW) — new optional slot
      * boiler_thermal_output — boiler heat output (kW) — new optional slot

    Contract (NEW-H1): values may be any HA-native type (str, "unknown",
    "unavailable", None, float, int). The fetcher is a thin passthrough;
    `SourceResolver` handles coercion via `safe_float`. No entity staleness
    handling or unit auto-detection here — those belong to
    `fetch_heat_source_status()` for the HP-specific legacy pipeline.
    """
    from typing import Any as _Any  # local to keep module imports tidy

    entities = config.get("entities", {}) or {}
    slot_map = {
        "hp_energy_rate": "hp_energy_rate",
        "hp_thermal_output": "hp_thermal_output",
        "hp_cop": "hp_cop",
        "boiler_power_input": "boiler_power_input",
        "boiler_thermal_output": "boiler_thermal_output",
    }
    out: Dict[str, _Any] = {}
    for slot, key in slot_map.items():
        entity_id = entities.get(key)
        if not entity_id:
            out[slot] = None
            continue
        out[slot] = fetch_ha_entity(entity_id, default=None)
    return out


def fetch_all_sensor_data(config: Dict, target_temp: float) -> SensorData:
    """Fetch all sensor data in one go with capability-aware degradation."""
    global _last_valid_outdoor_temp
    data = SensorData()
    data.target_temp = target_temp

    data.independent_sensors = fetch_independent_sensors(config)
    data.trv_temps = fetch_trv_temperatures(config)
    data.trv_setpoints = fetch_trv_setpoints(config)
    data.room_temps = fetch_room_temperatures(config, data.independent_sensors)
    data.room_temperature_source = fetch_room_temperature_sources(config)

    outdoor_entity = config["entities"].get("outdoor_temp")
    if outdoor_entity:
        _register_events()
        ann = get_annunciator()
        temp_raw, is_fresh = _fetch_with_staleness(outdoor_entity, "outdoor", default=5.0)
        if is_fresh:
            data.outdoor_temp = safe_float(temp_raw, 5.0)
            data.has_outdoor = True
            _last_valid_outdoor_temp = data.outdoor_temp
            ann.exited("HA.outdoor_stale_lastvalid")
        else:
            if _last_valid_outdoor_temp is not None:
                data.outdoor_temp = _last_valid_outdoor_temp
                data.has_outdoor = False
                ann.entered(
                    "HA.outdoor_stale_lastvalid",
                    temp=round(_last_valid_outdoor_temp, 1),
                )
            else:
                data.outdoor_temp = 5.0
                data.has_outdoor = False
                logging.warning("Outdoor sensor stale - no history, using 5°C fallback")
    else:
        data.outdoor_temp = _last_valid_outdoor_temp if _last_valid_outdoor_temp is not None else 5.0
        data.has_outdoor = False

    (
        data.heating_percs,
        data.heating_percs_per_emitter,
        data.avg_open_frac,
    ) = fetch_heating_percentages(config)

    hs_status = fetch_heat_source_status(config)
    data.hp_flow_temp = hs_status["flow_temp"]
    data.hp_power = hs_status["power"]
    data.hp_output = hs_status["output"]
    data.hp_cop = hs_status["cop"]
    data.delta_t = hs_status["delta_t"]
    data.has_live_cop = hs_status["has_live_cop"]
    data.has_live_delta_t = hs_status["has_live_delta_t"]
    data.has_live_power = hs_status["has_live_power"]
    data.hp_return_temp = hs_status.get("return_temp", config.get("default_return_temp", 30.0))
    data.flow_rate = hs_status.get("flow_rate", 0.0)
    data.has_live_return_temp = hs_status.get("has_live_return_temp", False)
    data.has_live_flow_rate = hs_status.get("has_live_flow_rate", False)

    # INSTRUCTION-241A Task 3 — populate per-source dict alongside the legacy
    # flat slots. Selector reads sd.heat_sources[active] and overwrites the
    # flat slots from there in the same cycle. Empty heat_sources config →
    # legacy singular path returns one entry; selector treats as no-op.
    from ...sensors import HeatSourceReading

    data.heat_sources = {
        name: HeatSourceReading(
            flow_temp=result["flow_temp"],
            power=result["power"],
            output=result["output"],
            cop=result["cop"],
            delta_t=result["delta_t"],
            return_temp=result["return_temp"],
            flow_rate=result["flow_rate"],
            total_energy=result.get("total_energy", 0.0),
            pump_power=result.get("pump_power", 0.0),
            has_live_power=result["has_live_power"],
            has_live_cop=result["has_live_cop"],
            has_live_return_temp=result["has_live_return_temp"],
            has_live_flow_rate=result["has_live_flow_rate"],
            has_live_delta_t=result["has_live_delta_t"],
        )
        for name, result in fetch_all_heat_source_statuses(config).items()
    }

    # INSTRUCTION-246 Task 6 — read the boiler input-power slot via the
    # existing fetch_source_raw_values() helper (lines 1089–1123). The helper
    # already declares the boiler_power_input slot and returns None for any
    # entity that is absent / unavailable / non-numeric.
    source_raw = fetch_source_raw_values(config)
    boiler_raw = source_raw.get("boiler_power_input")
    if boiler_raw is None:
        data.boiler_power = None
        data.has_live_boiler_power = False
    else:
        boiler_kw = safe_float(boiler_raw, None)
        if boiler_kw is None:
            data.boiler_power = None
            data.has_live_boiler_power = False
        else:
            data.boiler_power = float(boiler_kw)
            data.has_live_boiler_power = True

    energy_data = fetch_energy_data(config)
    data.battery_soc = energy_data["battery_soc"]
    data.solar_production = energy_data["solar_production"]
    data.grid_power = energy_data["grid_power"]
    data.has_solar = energy_data["has_solar"]
    data.has_battery = energy_data["has_battery"]

    water_heater_entity = config["entities"].get("water_heater")
    hw_boolean_entity = config["entities"].get("hot_water_boolean")

    wh_value: Optional[bool] = None
    wh_live: bool = False
    bool_value: Optional[bool] = None
    bool_live: bool = False

    if water_heater_entity:
        wh_raw = fetch_ha_entity(water_heater_entity, default=None)
        wh_value, wh_live = classify_hot_water_payload(wh_raw)

    if hw_boolean_entity:
        bool_raw = fetch_ha_entity(hw_boolean_entity, default=None)
        bool_value, bool_live = classify_hot_water_payload(bool_raw)

    contributions = [v for v in (wh_value, bool_value) if v is not None]
    data.hot_water_active = any(contributions) if contributions else False

    if water_heater_entity or hw_boolean_entity:
        data.has_live_hot_water = wh_live or bool_live

    data.stale_sensors = sensor_health.get_stale_sensors()
    data.stale_rooms = sensor_health.get_stale_rooms(config)
    data.sensor_health_summary = sensor_health.get_health_summary()

    return data


def _ha_get_state(config: Dict, entity_id: str):
    """read_fn adapter: wraps fetch_ha_entity for use with resolve_value()."""
    raw = fetch_ha_entity(entity_id, default=None)
    if raw in (None, "unavailable", "unknown", ""):
        return None
    return safe_float(raw, None)


# =========================================================================
# EXTERNAL SETPOINT RESOLUTION (INSTRUCTION-42A)
# =========================================================================

# Module-level snapshot of original YAML values — populated on first call.
# Ensures entity-unavailable always falls back to the true YAML value,
# not a stale external value from a previous cycle's config mutation.
_setpoint_originals: Dict[str, float] = {}


def resolve_external_setpoints(config: Dict) -> None:
    """Resolve external entity overrides for setpoints that controllers
    read via config.get(). Writes resolved values back into config dict
    so downstream code is unchanged.

    Called once per cycle from HADriver.read_inputs().

    Safety: On first call, snapshots the original YAML-loaded values
    for each setpoint. Subsequent calls use the snapshot as the fallback
    default, ensuring entity-unavailable reverts to the true YAML value
    rather than latching a stale external value.
    """
    global _setpoint_originals

    # Snapshot originals on first call only
    if not _setpoint_originals:
        _setpoint_originals = {
            "comfort_temp": config.get("comfort_temp") or 20.0,
            "antifrost_oat_threshold": config.get("antifrost", {}).get("oat_threshold", 7.0),
            "hp_min_output_kw": config.get("hp_min_output_kw", 2.0),
            "overtemp_protection": config.get("overtemp_protection", 23.0),
        }

    # --- Comfort temperature ---
    # internal_key=None for all 4 setpoints. The snapshot is the sole trusted
    # fallback source — prevents resolve_value() from reading back a stale
    # external value that was written into config on a previous cycle.
    # API endpoints call update_setpoint_original() to keep the snapshot
    # in sync when users change internal values.
    comfort_rv = resolve_value(
        config,
        entity_key="entities.comfort_temp",
        internal_key=None,
        default=_setpoint_originals["comfort_temp"],
        read_fn=_ha_get_state,
    )
    config["comfort_temp"] = safe_float(
        comfort_rv.value,
        _setpoint_originals["comfort_temp"],
    )

    # --- Antifrost OAT threshold ---
    antifrost_rv = resolve_value(
        config,
        entity_key="entities.antifrost_oat_threshold",
        internal_key=None,
        default=_setpoint_originals["antifrost_oat_threshold"],
        read_fn=_ha_get_state,
    )
    config.setdefault("antifrost", {})["oat_threshold"] = safe_float(
        antifrost_rv.value,
        _setpoint_originals["antifrost_oat_threshold"],
    )

    # --- Shoulder shutdown threshold (hp_min_output_kw) ---
    shoulder_rv = resolve_value(
        config,
        entity_key="entities.shoulder_threshold",
        internal_key=None,
        default=_setpoint_originals["hp_min_output_kw"],
        read_fn=_ha_get_state,
    )
    config["hp_min_output_kw"] = safe_float(
        shoulder_rv.value,
        _setpoint_originals["hp_min_output_kw"],
    )

    # --- Overtemp protection ---
    overtemp_rv = resolve_value(
        config,
        entity_key="entities.overtemp_protection",
        internal_key=None,
        default=_setpoint_originals["overtemp_protection"],
        read_fn=_ha_get_state,
    )
    config["overtemp_protection"] = safe_float(
        overtemp_rv.value,
        _setpoint_originals["overtemp_protection"],
    )


def update_setpoint_original(key: str, value: float) -> None:
    """Update the snapshot of a YAML-origin setpoint value.

    Called by API endpoints when the user changes an internal setpoint
    value. This keeps the snapshot in sync with the user's intent, so
    entity-unavailable falls back to the user's chosen value, not the
    value from the initial config load.
    """
    if _setpoint_originals:
        _setpoint_originals[key] = value
    else:
        logging.debug(
            "Setpoint snapshot not yet initialised — update for '%s' "
            "deferred to first cycle", key
        )


def get_flow_temp_limits(config: Dict) -> Tuple[float, float]:
    """Get flow temperature min/max limits from HA entities or internal config."""
    flow_min_rv = resolve_value(
        config,
        entity_key="entities.flow_min_temp",
        internal_key="flow_min_internal",
        default=25.0,
        read_fn=_ha_get_state,
    )
    flow_min = safe_float(flow_min_rv.value, config.get("flow_min_internal", config.get("flow_min", 25.0)))

    flow_max_rv = resolve_value(
        config,
        entity_key="entities.flow_max_temp",
        internal_key="flow_max_internal",
        default=50.0,
        read_fn=_ha_get_state,
    )
    flow_max = safe_float(flow_max_rv.value, config.get("flow_max_internal", config.get("flow_max", 55.0)))

    return flow_min, flow_max
