"""HA sensor fetching — all Home Assistant entity reads for sensor data.

Moved from sensors.py to isolate HA dependencies.
Pure data containers (SensorData, TrvOffsetTracker) remain in sensors.py.
"""

import logging
import time
from typing import Dict, Optional, Set, Tuple

from .integration import fetch_ha_entity, fetch_ha_entity_full
from ...utils import safe_float
from ...sensors import SensorData, SensorHealthTracker, sensor_health, UNAVAILABLE_STATES
from ..resolve import resolve_value, deep_get


# =========================================================================
# LAST-VALID-VALUE CACHES (PCS7 pattern)
# =========================================================================
_last_valid_outdoor_temp: Optional[float] = None
_last_valid_independent: Dict[str, float] = {}
_last_valid_heating_perc: Dict[str, float] = {}

# =========================================================================
# WARN-ONCE SETS (log once per entity, then suppress)
# =========================================================================
_warned_no_heating_entity: Set[str] = set()
_warned_valve_stale_no_history: Set[str] = set()

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
            temp_raw, is_fresh = _fetch_with_staleness(entity_id, "temperature", default=fallback_temp)

            if is_fresh:
                temp = safe_float(temp_raw, fallback_temp)
                sensors[sensor_key] = temp
                _last_valid_independent[sensor_key] = temp
            else:
                if sensor_key in _last_valid_independent:
                    sensors[sensor_key] = _last_valid_independent[sensor_key]
                    logging.info(
                        "Independent sensor %s (%s) stale - using last valid: %.1f°C",
                        sensor_key,
                        entity_id,
                        _last_valid_independent[sensor_key],
                    )
                else:
                    sensors[sensor_key] = fallback_temp
                    logging.warning(
                        "Independent sensor %s (%s) stale - no history, using %.1f°C fallback",
                        sensor_key,
                        entity_id,
                        fallback_temp,
                    )
        else:
            logging.warning(f"No entity ID configured for {sensor_key}")
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


def get_room_temperature(room: str, config: Dict, sensor_temps: Optional[Dict] = None) -> float:
    """Get room temperature with priority: independent sensors > climate entity > fallback."""
    target_temp = config.get("overtemp_protection", 23.0)

    sensor_key = config["zone_sensor_map"].get(room)
    if sensor_key:
        entity_id = config["entities"].get(sensor_key)
        is_stale = entity_id and sensor_health.is_stale(entity_id)

        if not is_stale and sensor_temps and sensor_key in sensor_temps:
            temp = sensor_temps[sensor_key]
            if temp is not None and temp != target_temp:
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
            if all_stale:
                logging.warning(f"{room}: all TRV readings stale, using last known {avg_temp:.1f}C (may be inaccurate)")
            else:
                logging.debug(f"{room} temp from climate entity (avg of {len(temps)} TRVs): {avg_temp:.1f}C")
            return avg_temp

    logging.warning(f"No valid temperature source for {room}, using target {target_temp:.1f}C")
    return target_temp


def fetch_room_temperatures(config: Dict, sensor_temps: Dict[str, float]) -> Dict[str, float]:
    """Fetch temperatures for all rooms using priority logic."""
    room_temps = {}

    for room in config["rooms"]:
        room_temps[room] = get_room_temperature(room, config, sensor_temps)

    target = config.get("overtemp_protection", 23.0)
    cold_rooms = []
    for room in config["rooms"]:
        delta = target - room_temps[room]
        if delta > 0.5:
            cold_rooms.append(f"{room}:{room_temps[room]:.1f}C({delta:+.1f})")

    if cold_rooms:
        logging.debug(
            f"Rooms below target: {', '.join(cold_rooms[:5])}"
            + (f" +{len(cold_rooms) - 5} more" if len(cold_rooms) > 5 else "")
        )

    return room_temps


def fetch_heating_percentages(config: Dict) -> Tuple[Dict[str, float], float]:
    """Fetch TRV valve positions (heating percentages) for all rooms."""
    global _last_valid_heating_perc
    heating_percs = {}
    total_frac = 0.0
    num_rooms = len(config["rooms"])

    if num_rooms == 0:
        logging.warning("No rooms defined in HOUSE_CONFIG - skipping heating perc fetch.")
        return {}, 0.0

    valve_scales = config.get("room_valve_scale", {})
    type1_rooms = {r for r, hw in config.get("room_valve_hardware", {}).items() if hw == "direct_type1"}

    for room in config["rooms"]:
        heating_entity = config["entities"].get(room + "_heating")
        if heating_entity:
            perc_raw, is_fresh = _fetch_with_staleness(heating_entity, "valve", default=0.0)

            if is_fresh:
                perc = safe_float(perc_raw, 0.0)

                scale = valve_scales.get(room, 255 if room in type1_rooms else 100)
                if scale != 100:
                    perc = round(perc / float(scale) * 100.0, 1)

                heating_percs[room] = perc
                _last_valid_heating_perc[room] = perc
            else:
                if room in _last_valid_heating_perc:
                    heating_percs[room] = _last_valid_heating_perc[room]
                    logging.info(
                        "Valve %s (%s) stale - using last valid: %.1f%%",
                        room,
                        heating_entity,
                        _last_valid_heating_perc[room],
                    )
                else:
                    heating_percs[room] = 0.0
                    if room not in _warned_valve_stale_no_history:
                        logging.info("Valve %s (%s) stale — no history, using 0%% fallback", room, heating_entity)
                        _warned_valve_stale_no_history.add(room)

            total_frac += heating_percs[room] / 100.0
        else:
            if room not in _warned_no_heating_entity:
                logging.info("Room '%s' has no heating entity configured — using fallback valve position.", room)
                _warned_no_heating_entity.add(room)
            heating_percs[room] = _last_valid_heating_perc.get(room, 0.0)
            total_frac += heating_percs[room] / 100.0

    avg_open_frac = total_frac / num_rooms if num_rooms > 0 else 0.0

    return heating_percs, avg_open_frac


def fetch_heat_source_status(config: Dict) -> Dict:
    """Fetch heat source operating status with graceful degradation."""
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


def fetch_all_sensor_data(config: Dict, target_temp: float) -> SensorData:
    """Fetch all sensor data in one go with capability-aware degradation."""
    global _last_valid_outdoor_temp
    data = SensorData()
    data.target_temp = target_temp

    data.independent_sensors = fetch_independent_sensors(config)
    data.trv_temps = fetch_trv_temperatures(config)
    data.trv_setpoints = fetch_trv_setpoints(config)
    data.room_temps = fetch_room_temperatures(config, data.independent_sensors)

    outdoor_entity = config["entities"].get("outdoor_temp")
    if outdoor_entity:
        temp_raw, is_fresh = _fetch_with_staleness(outdoor_entity, "outdoor", default=5.0)
        if is_fresh:
            data.outdoor_temp = safe_float(temp_raw, 5.0)
            data.has_outdoor = True
            _last_valid_outdoor_temp = data.outdoor_temp
        else:
            if _last_valid_outdoor_temp is not None:
                data.outdoor_temp = _last_valid_outdoor_temp
                data.has_outdoor = False
                logging.info("Outdoor sensor stale - using last valid value: %.1f°C", _last_valid_outdoor_temp)
            else:
                data.outdoor_temp = 5.0
                data.has_outdoor = False
                logging.warning("Outdoor sensor stale - no history, using 5°C fallback")
    else:
        data.outdoor_temp = _last_valid_outdoor_temp if _last_valid_outdoor_temp is not None else 5.0
        data.has_outdoor = False

    data.heating_percs, data.avg_open_frac = fetch_heating_percentages(config)

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

    energy_data = fetch_energy_data(config)
    data.battery_soc = energy_data["battery_soc"]
    data.solar_production = energy_data["solar_production"]
    data.grid_power = energy_data["grid_power"]
    data.has_solar = energy_data["has_solar"]
    data.has_battery = energy_data["has_battery"]

    water_heater_entity = config["entities"].get("water_heater")
    if water_heater_entity:
        hot_water_state = fetch_ha_entity(water_heater_entity, default="off")
        data.hot_water_active = hot_water_state == "high_demand"
    else:
        data.hot_water_active = False

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
            "comfort_temp": config.get("comfort_temp", 20.0),
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
