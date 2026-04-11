"""
HA Valve Dispatch — all valve I/O that touches Home Assistant.

Moved from valve_control.py during the HA purge so that valve_control.py
remains pure (no HA imports).  Every function here calls set_ha_service
or fetch_ha_entity.

Pure helpers (get_type2_entity_names, get_type1_entity_name, etc.) remain
in valve_control.py and are imported here.
"""

import logging
import time
from typing import Dict, List, Optional, Set, Tuple

from .integration import set_ha_service, fetch_ha_entity
from ...utils import safe_float

# Warn-once sets (log once per room, then suppress)
_warned_type2_no_position: Set[str] = set()
_warned_type1_unavailable: Set[str] = set()
_warned_generic_unavailable: Set[str] = set()

from ...valve_control import (
    RoomControlState,
    get_type2_entity_names,
    get_type1_entity_name,
    get_all_type2_rooms,
    get_all_type1_rooms,
    VALVE_HARDWARE_DIRECT_TYPE1,
    VALVE_HARDWARE_DIRECT_TYPE2,
    VALVE_HARDWARE_GENERIC,
)


# =============================================================================
# HA READ functions
# =============================================================================


def check_direct_valve_available(room: str, config: Dict) -> Tuple[bool, str]:
    """
    Check if direct valve control is available for a room.

    Queries HA to verify the expected entities exist.

    Returns:
        Tuple of (available, hardware_type)
    """
    hardware_type = config.get("room_valve_hardware", {}).get(room, VALVE_HARDWARE_GENERIC)

    if hardware_type == VALVE_HARDWARE_DIRECT_TYPE2:
        closing_entity, opening_entity = get_type2_entity_names(room, config)
        if fetch_ha_entity(closing_entity, default=None, suppress_log=True) is not None:
            return True, VALVE_HARDWARE_DIRECT_TYPE2
        else:
            logging.debug(f"Type2 entities not found for {room}: {closing_entity}")
            return False, hardware_type

    elif hardware_type == VALVE_HARDWARE_DIRECT_TYPE1:
        type1_entity = get_type1_entity_name(room, config)
        if fetch_ha_entity(type1_entity, default=None, suppress_log=True) is not None:
            return True, VALVE_HARDWARE_DIRECT_TYPE1
        else:
            logging.debug(f"Type1 entity not found for {room}: {type1_entity}")
            return False, hardware_type

    elif hardware_type == VALVE_HARDWARE_GENERIC:
        valve_entity = f"number.qsh_{room}_valve_target"
        if fetch_ha_entity(valve_entity, default=None, suppress_log=True) is not None:
            return True, VALVE_HARDWARE_GENERIC
        else:
            logging.debug(f"Generic valve entity not found for {room}: {valve_entity}")
            return False, hardware_type

    else:
        logging.warning(f"Unknown valve hardware type '{hardware_type}' for {room}")
        return False, hardware_type


def get_room_valve_fraction(
    room: str, config: Dict, heating_percs: Dict[str, float], control_state: Optional[RoomControlState] = None
) -> float:
    """
    Get valve open fraction for a room, handling direct vs indirect control.

    CRITICAL: Type2 devices (Sonoff TRVZB) have NO position feedback!

    Returns:
        Valve fraction 0.0-1.0
    """
    mode = config["room_control_mode"].get(room, "indirect")

    if mode == "none":
        return 0.0

    if mode == "indirect":
        return heating_percs.get(room, 0) / 100.0

    # Direct control - determine hardware type
    available, hardware_type = check_direct_valve_available(room, config)

    if not available:
        logging.debug(f"Direct control not available for {room}, using heating_percs")
        return heating_percs.get(room, 0) / 100.0

    if hardware_type == VALVE_HARDWARE_DIRECT_TYPE2:
        # TYPE2 (TRVZB): NO POSITION FEEDBACK!
        # Priority 1: Use tracked commanded position
        if control_state is not None:
            last_pos = control_state.last_valve_position.get(room)
            if last_pos is not None:
                logging.debug(f"{room} Type2 using tracked position: {last_pos}%")
                return last_pos / 100.0

        # Priority 2: Check if user configured workaround
        heating_entity = config["entities"].get(room + "_heating")
        if heating_entity and "valve_opening_degree" in heating_entity:
            valve_frac = heating_percs.get(room, 75.0) / 100.0
            logging.debug(f"{room} Type2 using config workaround: {valve_frac:.0%}")
            return valve_frac

        # Priority 3: Read from entity (echoes last command)
        _, opening_entity = get_type2_entity_names(room, config)
        position = fetch_ha_entity(opening_entity, default=None, suppress_log=True)
        if position is not None:
            valve_frac = safe_float(position, 75.0) / 100.0
            logging.debug(f"{room} Type2 using entity echo: {valve_frac:.0%}")
            return valve_frac

        # Last resort: assume 75%
        if room not in _warned_type2_no_position:
            logging.info("%s Type2 has no tracked position — assuming 75%%", room)
            _warned_type2_no_position.add(room)
        return 0.75

    elif hardware_type == VALVE_HARDWARE_DIRECT_TYPE1:
        # TYPE1: HAS POSITION FEEDBACK
        type1_entity = get_type1_entity_name(room, config)
        position = fetch_ha_entity(type1_entity, default=None, suppress_log=True)
        if position is not None:
            scale = config.get("room_valve_scale", {}).get(room, 255)
            valve_frac = round(safe_float(position, scale * 0.75) / float(scale), 3)
            logging.debug(f"{room} Type1 valve position: {position}/{scale} = {valve_frac:.0%}")
            return valve_frac
        else:
            if room not in _warned_type1_unavailable:
                logging.info("%s Type1 entity unavailable — assuming 75%%", room)
                _warned_type1_unavailable.add(room)
            return 0.75

    elif hardware_type == VALVE_HARDWARE_GENERIC:
        valve_entity = f"number.qsh_{room}_valve_target"
        position = fetch_ha_entity(valve_entity, default=None, suppress_log=True)
        if position is not None:
            valve_frac = safe_float(position, 75.0) / 100.0
            logging.debug(f"{room} generic valve position: {valve_frac:.0%}")
            return valve_frac
        else:
            if room not in _warned_generic_unavailable:
                logging.info("%s generic entity unavailable — assuming 75%%", room)
                _warned_generic_unavailable.add(room)
            return 0.75

    # Ultimate fallback
    logging.warning(f"{room} unknown state, using heating_percs")
    return heating_percs.get(room, 0) / 100.0


# =============================================================================
# HA WRITE functions — type-specific valve commands
# =============================================================================


def apply_direct_valve_control_type2(
    room: str, target_position: int, config: Dict, dfan_control: bool, control_state: Optional[RoomControlState] = None
) -> bool:
    """Apply direct valve position control via Type2 constraint hack."""
    closing_entity, opening_entity = get_type2_entity_names(room, config)

    if fetch_ha_entity(closing_entity, default=None, suppress_log=True) is None:
        logging.warning(f"Type2 closing entity not found for {room}: {closing_entity}")
        return False

    target_position = int(max(0, min(100, target_position)))

    # Dissipation floor enforcement
    if control_state is not None:
        DISSIPATION_FLOOR_HOLD_S = 300
        diss_floor = control_state.dissipation_floor.get(room)
        if diss_floor is not None:
            floor_age = time.time() - control_state.dissipation_floor_time.get(room, 0.0)
            if floor_age <= DISSIPATION_FLOOR_HOLD_S:
                if target_position < diss_floor:
                    logging.debug(
                        f"Type2 {room} FLOOR: {target_position}% raised to "
                        f"{diss_floor}% ({DISSIPATION_FLOOR_HOLD_S - floor_age:.0f}s remaining)"
                    )
                    target_position = max(target_position, diss_floor)
            else:
                logging.debug(f"{room} dissipation floor {diss_floor}% expired after {floor_age:.0f}s")
                control_state.dissipation_floor[room] = None
                control_state.dissipation_floor_time[room] = 0.0

    # Debounce
    if control_state is not None:
        last_pos = control_state.last_valve_position.get(room)
        if last_pos is not None and abs(last_pos - target_position) < 2:
            logging.debug(f"Type2 {room} already at ~{target_position}% - skipping")
            return True
        time_since_write = time.time() - control_state.last_valve_write_time.get(room, 0.0)
        if time_since_write < control_state.valve_write_min_interval:
            logging.debug(
                f"Type2 {room} debounce: {time_since_write:.0f}s < "
                f"{control_state.valve_write_min_interval:.0f}s min interval - skipping"
            )
            return True

    # Slew rate limiting
    if control_state is not None:
        last_pos = control_state.last_valve_position.get(room)
        if last_pos is not None:
            MAX_SLEW = 10
            delta = target_position - last_pos
            if abs(delta) > MAX_SLEW:
                target_position = int(last_pos + MAX_SLEW * (1 if delta > 0 else -1))
                logging.debug(f"Type2 {room} slew limited to {target_position}% (from {last_pos}%)")

    if dfan_control:
        set_ha_service("number", "set_value", {"entity_id": closing_entity, "value": target_position})
        set_ha_service("number", "set_value", {"entity_id": opening_entity, "value": target_position})

        if control_state is not None:
            control_state.last_valve_position[room] = target_position
            control_state.last_valve_write_time[room] = time.time()

        logging.info(f"ACTIVE: Set {room} Type2 valve to {target_position}%")
    else:
        logging.info(f"SHADOW: Would set {room} Type2 valve to {target_position}%")

    return True


def apply_direct_valve_control_type1(
    room: str, target_position: int, config: Dict, dfan_control: bool, control_state: Optional[RoomControlState] = None
) -> bool:
    """Apply direct valve position control via Type1 single valve_position entity."""
    type1_entity = get_type1_entity_name(room, config)

    if fetch_ha_entity(type1_entity, default=None, suppress_log=True) is None:
        logging.warning(f"Type1 entity not found for {room}: {type1_entity}")
        return False

    scale = config.get("room_valve_scale", {}).get(room, 255)
    target_position = int(max(0, min(100, target_position)))

    # Dissipation floor enforcement
    if control_state is not None:
        DISSIPATION_FLOOR_HOLD_S = 300
        diss_floor = control_state.dissipation_floor.get(room)
        if diss_floor is not None:
            floor_age = time.time() - control_state.dissipation_floor_time.get(room, 0.0)
            if floor_age <= DISSIPATION_FLOOR_HOLD_S:
                if target_position < diss_floor:
                    logging.debug(
                        f"Type1 {room} FLOOR: {target_position}% raised to "
                        f"{diss_floor}% ({DISSIPATION_FLOOR_HOLD_S - floor_age:.0f}s remaining)"
                    )
                    target_position = max(target_position, diss_floor)
            else:
                logging.debug(f"{room} dissipation floor {diss_floor}% expired after {floor_age:.0f}s")
                control_state.dissipation_floor[room] = None
                control_state.dissipation_floor_time[room] = 0.0

    # Convert 0-100% to device scale
    target_hw = int(round(target_position * scale / 100.0))

    # Skip if position unchanged
    if control_state is not None:
        last_pos = control_state.last_valve_position.get(room)
        if last_pos is not None:
            last_hw = int(round(last_pos * scale / 100.0))
            tolerance = max(1, scale // 85)
            if abs(last_hw - target_hw) < tolerance:
                logging.debug(f"Type1 {room} already at ~{target_position}% ({target_hw}/{scale}) - skipping")
                return True
        time_since_write = time.time() - control_state.last_valve_write_time.get(room, 0.0)
        if time_since_write < control_state.valve_write_min_interval:
            logging.debug(
                f"Type1 {room} debounce: {time_since_write:.0f}s < "
                f"{control_state.valve_write_min_interval:.0f}s min interval - skipping"
            )
            return True
        # Slew rate limiting
        if last_pos is not None:
            MAX_SLEW = 10
            delta = target_position - last_pos
            if abs(delta) > MAX_SLEW:
                target_position = int(last_pos + MAX_SLEW * (1 if delta > 0 else -1))
                target_hw = int(round(target_position * scale / 100.0))
                logging.debug(f"Type1 {room} slew limited to {target_position}% ({target_hw}/{scale})")

    if dfan_control:
        set_ha_service("number", "set_value", {"entity_id": type1_entity, "value": target_hw})

        if control_state is not None:
            control_state.last_valve_position[room] = target_position
            control_state.last_valve_write_time[room] = time.time()

        logging.info(f"ACTIVE: Set {room} Type1 valve to {target_position}% ({target_hw}/{scale})")
    else:
        logging.info(f"SHADOW: Would set {room} Type1 valve to {target_position}% ({target_hw}/{scale})")

    return True


def apply_direct_valve_control_generic(
    room: str, target_position: int, config: Dict, dfan_control: bool, control_state: Optional[RoomControlState] = None
) -> bool:
    """Apply direct valve position control via generic number entity."""
    valve_entity = f"number.qsh_{room}_valve_target"

    if fetch_ha_entity(valve_entity, default=None, suppress_log=True) is None:
        return False

    target_position = int(max(0, min(100, target_position)))

    if control_state is not None:
        last_pos = control_state.last_valve_position.get(room)
        if last_pos == target_position:
            logging.debug(f"Generic {room} already at {target_position}% - skipping")
            return True

    if dfan_control:
        set_ha_service("number", "set_value", {"entity_id": valve_entity, "value": target_position})

        if control_state is not None:
            control_state.last_valve_position[room] = target_position

        logging.info(f"ACTIVE: Set {room} generic valve to {target_position}%")
    else:
        logging.info(f"SHADOW: Would set {room} generic valve to {target_position}%")

    return True


def apply_direct_valve_control(
    room: str,
    deficit: float,
    heat_up_rate: float,
    config: Dict,
    dfan_control: bool,
    control_state: Optional[RoomControlState] = None,
    balancing_detector=None,
    heating_frac: float = 0.75,
) -> bool:
    """
    Apply direct valve position control based on temperature deficit.

    Uses deficit (target - actual) as primary control input.
    Dispatches to hardware-specific functions.
    """
    available, hardware_type = check_direct_valve_available(room, config)

    if not available:
        logging.debug(f"Direct valve control not available for {room} (hw={hardware_type})")
        return False

    # Deficit-based target position with heat_up_rate damping
    DEAD_BAND = 0.3

    if abs(deficit) <= DEAD_BAND and abs(heat_up_rate) < 0.10:
        if control_state is not None:
            last_pos = control_state.last_valve_position.get(room)
            if last_pos is not None:
                logging.debug(f"{room} direct: deficit={deficit:+.2f}°C within dead-band — holding at {last_pos}%")
                return True

    if deficit > 2.0:
        target_position = 100
    elif deficit > 0.5:
        target_position = 65 + int((deficit - 0.5) / 1.5 * 35)
        if heat_up_rate > 0.15:
            target_position = max(50, target_position - 15)
        elif heat_up_rate > 0.08:
            target_position = max(55, target_position - 8)
    elif deficit > 0.0:
        target_position = 30 + int(deficit / 0.5 * 35)
        if heat_up_rate > 0.10:
            target_position = max(20, target_position - 15)
        elif heat_up_rate > 0.05:
            target_position = max(25, target_position - 8)
    else:
        target_position = max(0, 30 + int(deficit * 30))

    # Respect dissipation floor
    if control_state is not None:
        diss_floor = control_state.dissipation_floor.get(room)
        if diss_floor is not None:
            DISSIPATION_FLOOR_HOLD_S = 300
            floor_age = time.time() - control_state.dissipation_floor_time.get(room, 0.0)

            if floor_age > DISSIPATION_FLOOR_HOLD_S:
                logging.debug(f"{room} dissipation floor {diss_floor}% expired after {floor_age:.0f}s")
                control_state.dissipation_floor[room] = None
                control_state.dissipation_floor_time[room] = 0.0
            else:
                if target_position < diss_floor:
                    logging.debug(
                        f"{room} deficit target {target_position}% raised to "
                        f"dissipation floor {diss_floor}% ({DISSIPATION_FLOOR_HOLD_S - floor_age:.0f}s remaining)"
                    )
                target_position = max(target_position, diss_floor)

    if balancing_detector is not None:
        offset = balancing_detector.get_balance_offset(room)
        target_position = max(0, min(100, target_position + offset))

    logging.debug(
        f"{room} direct: deficit={deficit:+.1f}°C rate={heat_up_rate:.2f}°C/min "
        f"-> target={target_position}% (actual={heating_frac:.0%})"
    )

    if hardware_type == VALVE_HARDWARE_DIRECT_TYPE2:
        return apply_direct_valve_control_type2(room, target_position, config, dfan_control, control_state)
    elif hardware_type == VALVE_HARDWARE_DIRECT_TYPE1:
        return apply_direct_valve_control_type1(room, target_position, config, dfan_control, control_state)
    elif hardware_type == VALVE_HARDWARE_GENERIC:
        return apply_direct_valve_control_generic(room, target_position, config, dfan_control, control_state)
    else:
        logging.warning(f"Unknown valve hardware type '{hardware_type}' for {room}")
        return False


def apply_valve_position(
    room: str,
    target_position: int,
    hardware_type: str,
    config: Dict,
    dfan_control: bool,
    control_state: Optional[RoomControlState] = None,
) -> bool:
    """
    Unified position dispatch for dissipation control.

    Unlike apply_direct_valve_control (which takes deficit), this takes
    a pre-calculated target position and dispatches by hardware type.
    """
    if hardware_type == VALVE_HARDWARE_DIRECT_TYPE2:
        return apply_direct_valve_control_type2(room, target_position, config, dfan_control, control_state)
    elif hardware_type == VALVE_HARDWARE_DIRECT_TYPE1:
        return apply_direct_valve_control_type1(room, target_position, config, dfan_control, control_state)
    elif hardware_type == VALVE_HARDWARE_GENERIC:
        return apply_direct_valve_control_generic(room, target_position, config, dfan_control, control_state)
    else:
        return False


# =============================================================================
# HA WRITE functions — temperature push & reset
# =============================================================================


def update_type2_external_temperatures(config: Dict, independent_sensors: Dict[str, float], dfan_control: bool) -> None:
    """Push independent sensor readings to Type2 (Sonoff TRVZB) external temperature input."""
    zone_sensor_map = config.get("zone_sensor_map", {})
    type2_rooms = [r for r, hw in config.get("room_valve_hardware", {}).items() if hw == VALVE_HARDWARE_DIRECT_TYPE2]

    if not type2_rooms:
        return

    for room in type2_rooms:
        sensor_key = zone_sensor_map.get(room)
        if not sensor_key or sensor_key not in independent_sensors:
            continue

        temp = independent_sensors[sensor_key]

        if temp < 5.0 or temp > 40.0:
            continue

        trv_name = config.get("room_trv_names", {}).get(room, f"{room}_trv")
        ext_temp_entity = f"number.{trv_name}_external_temperature_input"

        if dfan_control:
            set_ha_service("number", "set_value", {"entity_id": ext_temp_entity, "value": round(temp, 1)})
            logging.debug(f"Type2 {room}: external temp set to {temp:.1f}C")
        else:
            logging.debug(f"SHADOW: Type2 {room}: would set external temp to {temp:.1f}C")


def reset_type2_to_normal(room: str, config: Dict) -> bool:
    """Reset Type2 to normal thermostat operation."""
    closing_entity, opening_entity = get_type2_entity_names(room, config)

    if fetch_ha_entity(closing_entity, default=None, suppress_log=True) is None:
        logging.warning(f"Type2 entities not found for {room}")
        return False

    set_ha_service("number", "set_value", {"entity_id": closing_entity, "value": 0})
    set_ha_service("number", "set_value", {"entity_id": opening_entity, "value": 100})

    logging.info(f"Reset {room} Type2 to normal thermostat operation")
    return True


def reset_type1_to_normal(room: str, config: Dict) -> bool:
    """Reset Type1 valve to normal thermostat operation."""
    type1_entity = get_type1_entity_name(room, config)

    if fetch_ha_entity(type1_entity, default=None, suppress_log=True) is None:
        logging.warning(f"Type1 entity not found for {room}")
        return False

    set_ha_service("number", "set_value", {"entity_id": type1_entity, "value": 100})

    logging.info(f"Reset {room} Type1 to normal operation (100%)")
    return True


def reset_all_direct_valves_to_normal(config: Dict) -> int:
    """Reset all direct-control valves to normal thermostat operation."""
    count = 0
    for room in get_all_type2_rooms(config):
        if reset_type2_to_normal(room, config):
            count += 1
    for room in get_all_type1_rooms(config):
        if reset_type1_to_normal(room, config):
            count += 1

    logging.info(f"Reset {count} direct-control valves to normal operation")
    return count
