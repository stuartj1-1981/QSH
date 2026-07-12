"""
HA Valve Dispatch — all valve I/O that touches Home Assistant.

Moved from valve_control.py during the HA purge so that valve_control.py
remains pure (no HA imports).  Every function here calls set_ha_service
or fetch_ha_entity.

Pure helpers (get_type2_entity_names, get_type1_entity_names, etc.) remain
in valve_control.py and are imported here.
"""

import logging
import time
from typing import Dict, List, Optional, Set, Tuple

from .integration import set_ha_service, fetch_ha_entity, WriteOutcome
from ...utils import safe_float

# Warn-once sets (log once per room, then suppress)
_warned_type2_no_position: Set[str] = set()
_warned_type1_unavailable: Set[str] = set()
_warned_generic_unavailable: Set[str] = set()
# INSTRUCTION-222A — direct-control hardware missing for a declared direct
# room: warn-once at WARNING so silent-demotion to indirect fan-out is
# operator-visible. Distinguishes the "declared direct but HW missing"
# case from the "indirect zone" case (the latter is DEBUG-level by design).
_warned_direct_unavailable: Set[str] = set()

from ...valve_control import (
    RoomControlState,
    get_type2_entity_names,
    get_type1_entity_names,
    get_all_type2_rooms,
    get_all_type1_rooms,
    VALVE_HARDWARE_DIRECT_TYPE1,
    VALVE_HARDWARE_DIRECT_TYPE2,
    VALVE_HARDWARE_GENERIC,
)


def _warn_direct_unavailable(room: str, hardware_type: str, missing: List[str]) -> None:
    """Warn-once on first miss for a direct-declared room."""
    if room in _warned_direct_unavailable:
        return
    _warned_direct_unavailable.add(room)
    logging.warning(
        "Room '%s' declared as %s but %d expected entit%s missing — "
        "%s. Direct valve dispatch disabled for this room; zone will be "
        "controlled via climate.set_temperature setpoint fan-out only. "
        "Either correct trv_name in YAML or accept indirect-mode behaviour.",
        room,
        hardware_type,
        len(missing),
        "y is" if len(missing) == 1 else "ies are",
        ", ".join(missing[:3]) + (f" (+{len(missing) - 3} more)" if len(missing) > 3 else ""),
    )


# =============================================================================
# HA READ functions
# =============================================================================


def check_direct_valve_available(room: str, config: Dict) -> Tuple[bool, str]:
    """
    Check if direct valve control is available for a room.

    For Type1 / Type2 hardware: ALL derived TRV entities must resolve.
    Partial resolution (e.g. rad1 exists, rad2 missing) is treated as
    unavailable — the constraint-hack design assumes every member is
    controllable, and partial control produces asymmetric zone behaviour.

    First failure for a room declared as direct_type{1,2} logs WARNING
    (warn-once) so operators see the silent-demotion case rather than
    discovering it through symptom diagnosis.

    Returns:
        Tuple of (available, hardware_type).
    """
    hardware_type = config.get("room_valve_hardware", {}).get(room, VALVE_HARDWARE_GENERIC)

    if hardware_type == VALVE_HARDWARE_DIRECT_TYPE2:
        pairs = get_type2_entity_names(room, config)
        missing = [
            closing for (closing, _) in pairs
            if fetch_ha_entity(closing, default=None, suppress_log=True) is None
        ]
        if missing:
            _warn_direct_unavailable(room, hardware_type, missing)
            return False, hardware_type
        return True, VALVE_HARDWARE_DIRECT_TYPE2

    elif hardware_type == VALVE_HARDWARE_DIRECT_TYPE1:
        entities = get_type1_entity_names(room, config)
        missing = [
            e for e in entities
            if fetch_ha_entity(e, default=None, suppress_log=True) is None
        ]
        if missing:
            _warn_direct_unavailable(room, hardware_type, missing)
            return False, hardware_type
        return True, VALVE_HARDWARE_DIRECT_TYPE1

    elif hardware_type == VALVE_HARDWARE_GENERIC:
        valve_entity = f"number.qsh_{room}_valve_target"
        if fetch_ha_entity(valve_entity, default=None, suppress_log=True) is not None:
            return True, VALVE_HARDWARE_GENERIC
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
        # Multi-emitter zones: read first declared TRV; all members are
        # commanded to the same target so single-member read is sufficient.
        pairs = get_type2_entity_names(room, config)
        _, opening_entity = pairs[0]
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
        # Multi-emitter zones: read first declared TRV; all members are
        # commanded to the same target so single-member read is sufficient.
        type1_ids = get_type1_entity_names(room, config)
        type1_entity = type1_ids[0]
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
    """Apply direct valve position control via Type2 constraint hack.

    Multi-emitter support: fans out across every TRV declared in
    room_trv_names[room] via HA list-form entity_id. One service call per
    write (closing-degree, opening-degree) regardless of TRV count.
    """
    # INSTRUCTION-225A — manual override intercept. Local import avoids the
    # module-level cycle (manual_state -> valve_control -> valve_dispatch).
    from ... import manual_state
    _entry = manual_state.get(room)
    if _entry.mode == "MANUAL":
        # PCS7-style block-level MANUAL override (INSTRUCTION-225 §2.2).
        # Operator-explicit action overrides supervisory output AND shadow mode.
        # Dissipation floor is bypassed below — it's a control-policy artefact
        # (owned by the dissipation controller), not a hardware-protection limit;
        # operator overrides policy. Slew and debounce are NOT bypassed — those
        # protect the actuator and apply regardless of who is commanding.
        target_position = _entry.position_pct
        dfan_control = True  # MANUAL bypasses shadow mode per INSTRUCTION-225 §2.4
        _mode_tag = "MANUAL"
    else:
        _mode_tag = "AUTO"

    pairs = get_type2_entity_names(room, config)
    closing_ids = [c for c, _ in pairs]
    opening_ids = [o for _, o in pairs]

    # Availability is gated upstream by check_direct_valve_available;
    # no redundant in-function check (single caller-level gate).

    target_position = int(max(0, min(100, target_position)))

    # AUTO-only: dissipation floor is a control-policy artefact owned by the
    # dissipation controller, not a hardware-protection limit. MANUAL operator
    # action overrides policy. Slew + debounce below are NOT gated on _mode_tag
    # because they protect the actuator and apply to operator commands too.
    if control_state is not None and _mode_tag == "AUTO":
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
        # INSTRUCTION-408 — outcome, not intent. The tracked commanded position
        # is Type2's ONLY position source (no feedback); it must never assert a
        # write the transport did not send. 2026-07-09: an open breaker dropped
        # all 8 park writes while this block logged "AUTO ACTIVE ... 85%" and
        # trackers (persisted) held 85 against physical 30/40/50.
        r_closing = set_ha_service("number", "set_value", {"entity_id": closing_ids, "value": target_position})
        r_opening = set_ha_service("number", "set_value", {"entity_id": opening_ids, "value": target_position})
        n = len(closing_ids)

        if r_closing is WriteOutcome.SENT and r_opening is WriteOutcome.SENT:
            if control_state is not None:
                control_state.last_valve_position[room] = target_position
                control_state.last_valve_write_time[room] = time.time()
            logging.info(
                f"{_mode_tag} ACTIVE: Set {room} Type2 valve to {target_position}% ({n} TRV{'s' if n > 1 else ''})"
            )
            return True

        if r_closing is not r_opening:
            # Partial send (e.g. closing landed, breaker tripped before opening —
            # trip can occur between the two posts via record_failure elsewhere).
            # Constraint pair now asymmetric on-device; tracker NOT updated, so
            # the next eligible cycle re-commands BOTH degrees (absolute values,
            # idempotent) and restores symmetry.
            logging.error(
                f"{_mode_tag} PARTIAL: {room} Type2 constraint pair disagrees "
                f"(closing={r_closing.value}, opening={r_opening.value}) — tracker not updated; "
                f"pair re-commanded next eligible cycle"
            )
        elif r_closing is WriteOutcome.SUPPRESSED_BREAKER_OPEN:
            logging.warning(
                f"{_mode_tag} SUPPRESSED: {room} Type2 valve write to {target_position}% dropped — "
                f"HA circuit breaker open ({n} TRV{'s' if n > 1 else ''})"
            )
        else:
            # FAILED / NO_TOKEN — transport already logged the specifics.
            logging.warning(
                f"{_mode_tag} NOT CONFIRMED: {room} Type2 valve write to {target_position}% "
                f"({r_closing.value}) — tracker not updated"
            )
        return False
    else:
        n = len(closing_ids)
        logging.info(
            f"{_mode_tag} SHADOW: Would set {room} Type2 valve to {target_position}% ({n} TRV{'s' if n > 1 else ''})"
        )

    return True


def apply_direct_valve_control_type1(
    room: str, target_position: int, config: Dict, dfan_control: bool, control_state: Optional[RoomControlState] = None
) -> bool:
    """Apply direct valve position control via Type1 single valve_position entity.

    Multi-emitter support: fans out across every TRV declared in
    room_trv_names[room] via HA list-form entity_id. One service call per
    write regardless of TRV count.
    """
    # INSTRUCTION-225A — manual override intercept. Local import avoids the
    # module-level cycle (manual_state -> valve_control -> valve_dispatch).
    from ... import manual_state
    _entry = manual_state.get(room)
    if _entry.mode == "MANUAL":
        # PCS7-style block-level MANUAL override (INSTRUCTION-225 §2.2).
        # Operator-explicit action overrides supervisory output AND shadow mode.
        # Dissipation floor is bypassed below — it's a control-policy artefact
        # (owned by the dissipation controller), not a hardware-protection limit;
        # operator overrides policy. Slew and debounce are NOT bypassed — those
        # protect the actuator and apply regardless of who is commanding.
        target_position = _entry.position_pct
        dfan_control = True  # MANUAL bypasses shadow mode per INSTRUCTION-225 §2.4
        _mode_tag = "MANUAL"
    else:
        _mode_tag = "AUTO"

    type1_ids = get_type1_entity_names(room, config)

    # Availability is gated upstream by check_direct_valve_available;
    # no redundant in-function check (single caller-level gate).

    scale = config.get("room_valve_scale", {}).get(room, 255)
    target_position = int(max(0, min(100, target_position)))

    # AUTO-only: dissipation floor is a control-policy artefact owned by the
    # dissipation controller, not a hardware-protection limit. MANUAL operator
    # action overrides policy. Slew + debounce below are NOT gated on _mode_tag
    # because they protect the actuator and apply to operator commands too.
    if control_state is not None and _mode_tag == "AUTO":
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
        # INSTRUCTION-408 — outcome, not intent (see Type2 for the rationale).
        result = set_ha_service("number", "set_value", {"entity_id": type1_ids, "value": target_hw})
        n = len(type1_ids)

        if result is WriteOutcome.SENT:
            if control_state is not None:
                control_state.last_valve_position[room] = target_position
                control_state.last_valve_write_time[room] = time.time()
            logging.info(
                f"{_mode_tag} ACTIVE: Set {room} Type1 valve to {target_position}% ({target_hw}/{scale}) "
                f"({n} TRV{'s' if n > 1 else ''})"
            )
            return True

        if result is WriteOutcome.SUPPRESSED_BREAKER_OPEN:
            logging.warning(
                f"{_mode_tag} SUPPRESSED: {room} Type1 valve write to {target_position}% ({target_hw}/{scale}) "
                f"dropped — HA circuit breaker open ({n} TRV{'s' if n > 1 else ''})"
            )
        else:
            # FAILED / NO_TOKEN — transport already logged the specifics.
            logging.warning(
                f"{_mode_tag} NOT CONFIRMED: {room} Type1 valve write to {target_position}% "
                f"({result.value}) — tracker not updated"
            )
        return False
    else:
        n = len(type1_ids)
        logging.info(
            f"{_mode_tag} SHADOW: Would set {room} Type1 valve to {target_position}% ({target_hw}/{scale}) "
            f"({n} TRV{'s' if n > 1 else ''})"
        )

    return True


def apply_direct_valve_control_generic(
    room: str, target_position: int, config: Dict, dfan_control: bool, control_state: Optional[RoomControlState] = None
) -> bool:
    """Apply direct valve position control via generic number entity."""
    # INSTRUCTION-225A — manual override intercept. Local import avoids the
    # module-level cycle (manual_state -> valve_control -> valve_dispatch).
    from ... import manual_state
    _entry = manual_state.get(room)
    if _entry.mode == "MANUAL":
        # PCS7-style block-level MANUAL override (INSTRUCTION-225 §2.2).
        # Operator-explicit action overrides supervisory output AND shadow mode.
        # Generic dispatcher has no dissipation-floor block; debounce below
        # still applies (hardware-protection equivalence at this dispatcher).
        target_position = _entry.position_pct
        dfan_control = True  # MANUAL bypasses shadow mode per INSTRUCTION-225 §2.4
        _mode_tag = "MANUAL"
    else:
        _mode_tag = "AUTO"

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
        # INSTRUCTION-408 — outcome, not intent (see Type2 for the rationale).
        # Generic has no last_valve_write_time field today — gate only what exists.
        result = set_ha_service("number", "set_value", {"entity_id": valve_entity, "value": target_position})

        if result is WriteOutcome.SENT:
            if control_state is not None:
                control_state.last_valve_position[room] = target_position
            logging.info(f"{_mode_tag} ACTIVE: Set {room} generic valve to {target_position}%")
            return True

        if result is WriteOutcome.SUPPRESSED_BREAKER_OPEN:
            logging.warning(
                f"{_mode_tag} SUPPRESSED: {room} generic valve write to {target_position}% dropped — "
                f"HA circuit breaker open"
            )
        else:
            # FAILED / NO_TOKEN — transport already logged the specifics.
            logging.warning(
                f"{_mode_tag} NOT CONFIRMED: {room} generic valve write to {target_position}% "
                f"({result.value}) — tracker not updated"
            )
        return False
    else:
        logging.info(f"{_mode_tag} SHADOW: Would set {room} generic valve to {target_position}%")

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
    degraded_zones: Optional[Dict] = None,
) -> bool:
    """
    Apply direct valve position control based on temperature deficit.

    Uses deficit (target - actual) as primary control input.
    Dispatches to hardware-specific functions.

    INSTRUCTION-370 Task 6: a zone present in ``degraded_zones`` has lost
    actuation authority and is now a passive runtime-`none` emitter — skip the
    balance offset and the active command entirely. Defence-in-depth alongside
    the primary exclusion in ``apply_hybrid_room_control`` (which short-circuits
    the room before it reaches this function): direct callers are still gated
    here. The park-once open-bias write is owned by the DegradationController via
    ``park_degraded_zone`` — never re-driven from the active-control path.
    """
    if degraded_zones and room in degraded_zones:
        logging.debug(f"{room} degraded (loss of TRV authority) — skipping direct control")
        return False

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


def park_degraded_zone(
    room: str,
    park_target: int,
    config: Dict,
    dfan_control: bool,
    control_state: Optional[RoomControlState] = None,
) -> bool:
    """Drive a degraded DIRECT zone once to its open-biased fail-to position
    (INSTRUCTION-370 Task 5).

    Dispatch EXECUTES the controller-computed ``park_target`` unchanged — no
    bias arithmetic here (the DegradationController owns ``OPEN_BIAS_PCT`` and
    the clamp). Routes through the existing ``apply_valve_position`` path so the
    225A MANUAL carve-out (operator-explicit position still wins) and the
    shadow-mode gate (``dfan_control`` False ⇒ model-only demote, no physical
    write) are honoured identically to every other valve write.

    The hardware type is resolved directly from config rather than gated on
    ``check_direct_valve_available``: the zone is degraded precisely because its
    entity is unreachable, so the availability gate would always reject the
    write. The park is a best-effort, single open-bias command at the demote
    edge — if comms momentarily return, it lands; otherwise the HA call is a
    harmless no-op.
    """
    hardware_type = config.get("room_valve_hardware", {}).get(room, VALVE_HARDWARE_GENERIC)
    return apply_valve_position(
        room, int(park_target), hardware_type, config, dfan_control, control_state
    )


# =============================================================================
# HA WRITE functions — temperature push & reset
# =============================================================================


def update_type2_external_temperatures(config: Dict, independent_sensors: Dict[str, float], dfan_control: bool) -> None:
    """Push independent sensor readings to Type2 (Sonoff TRVZB) external temperature input.

    Multi-emitter support: fans out across every TRV declared in
    room_trv_names[room]. One service call per room regardless of TRV count.
    """
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

        trv_names = config.get("room_trv_names", {}).get(room) or [f"{room}_trv"]
        ext_temp_ids = [f"number.{name}_external_temperature_input" for name in trv_names]

        if dfan_control:
            set_ha_service("number", "set_value", {"entity_id": ext_temp_ids, "value": round(temp, 1)})
            logging.debug(f"Type2 {room}: external temp set to {temp:.1f}C ({len(ext_temp_ids)} TRV)")
        else:
            logging.debug(f"SHADOW: Type2 {room}: would set external temp to {temp:.1f}C ({len(ext_temp_ids)} TRV)")


def reset_type2_to_normal(room: str, config: Dict) -> bool:
    """Reset Type2 to normal thermostat operation.

    Multi-emitter support: resets every TRV in the room. Best-effort —
    if the first member's entity doesn't resolve, the room is treated as
    unavailable and reset is skipped.
    """
    pairs = get_type2_entity_names(room, config)
    closing_ids = [c for c, _ in pairs]
    opening_ids = [o for _, o in pairs]

    if fetch_ha_entity(closing_ids[0], default=None, suppress_log=True) is None:
        logging.warning(f"Type2 entities not found for {room}")
        return False

    set_ha_service("number", "set_value", {"entity_id": closing_ids, "value": 0})
    set_ha_service("number", "set_value", {"entity_id": opening_ids, "value": 100})

    logging.info(f"Reset {room} Type2 to normal thermostat operation ({len(closing_ids)} TRV)")
    return True


def reset_type1_to_normal(room: str, config: Dict) -> bool:
    """Reset Type1 valve to normal thermostat operation.

    Multi-emitter support: resets every TRV in the room. Best-effort —
    if the first member's entity doesn't resolve, the room is treated as
    unavailable and reset is skipped.
    """
    type1_ids = get_type1_entity_names(room, config)

    if fetch_ha_entity(type1_ids[0], default=None, suppress_log=True) is None:
        logging.warning(f"Type1 entity not found for {room}")
        return False

    set_ha_service("number", "set_value", {"entity_id": type1_ids, "value": 100})

    logging.info(f"Reset {room} Type1 to normal operation (100%) ({len(type1_ids)} TRV)")
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
