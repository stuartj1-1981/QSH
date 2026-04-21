"""
Hardware Control Routing -- Phase 2

Multi-method heat source and TRV control.

Control methods:
  octopus_api  -- Direct GraphQL (Octopus Cosy HP)
  ha_service   -- HA service calls (Vaillant, Daikin, Samsung, OpenTherm, etc.)
  mqtt         -- Publish to MQTT topics via HA mqtt.publish service
  entity       -- Write to HA input_number/input_text (user automation drives hardware)
  trvs_only    -- No heat source control, TRV optimisation only
"""

import logging
from .integration import fetch_ha_entity, set_ha_service


READBACK_MISMATCH_ALARM_THRESHOLD = 5  # consecutive cycles where observed != optimal before operator alarm


# ========================================================================
# FLOW TEMPERATURE CONTROL (per control method)
# ========================================================================

# Octopus API hard limits (KT-CT-4321: "not in range 30 to 70")
OCTOPUS_FLOW_MIN = 30.0
OCTOPUS_FLOW_MAX = 70.0


def _apply_flow_octopus_api(optimal_flow, flow_min, flow_max):
    """Control flow temp via Octopus GraphQL API."""
    from . import octopus as octopus_api

    # Enforce configured limits AND API hard limits at dispatch boundary.
    effective_min = max(OCTOPUS_FLOW_MIN, flow_min)
    effective_max = min(OCTOPUS_FLOW_MAX, flow_max)
    clamped = max(effective_min, min(effective_max, optimal_flow))
    if clamped != optimal_flow:
        logging.warning(
            "Octopus API: clamped flow %.1f → %.1f (config %.0f-%.0f, API 30-70)",
            optimal_flow, clamped, flow_min, flow_max,
        )

    if octopus_api.is_available():
        txid = octopus_api.set_flow_temperature(
            flow_temp=clamped, weather_comp=False, wc_min=flow_min, wc_max=flow_max
        )
        if txid is None:
            logging.error("Octopus API: flow temp update failed (no HA fallback)")
    else:
        logging.error("Octopus API: not available, cannot set flow temp")


def _apply_flow_ha_service(config, optimal_flow):
    """Control flow temp via HA service call."""
    flow_svc = config.get("hp_flow_service", {})
    if not flow_svc:
        logging.error("ha_service control: no flow_service configured")
        return

    domain = flow_svc.get("domain", "")
    service = flow_svc.get("service", "")

    # Build service data -- start with base_data if present
    data = dict(flow_svc.get("base_data", {}))

    # Standard climate.set_temperature pattern
    if service == "set_temperature":
        if flow_svc.get("entity_id"):
            data["entity_id"] = flow_svc["entity_id"]
        data["temperature"] = optimal_flow
    # OpenTherm set_control_setpoint pattern
    elif service == "set_control_setpoint":
        if flow_svc.get("entity_id"):
            data["entity_id"] = flow_svc["entity_id"]
        data["temperature"] = optimal_flow
    # Custom service (e.g. Octopus via HA -- includes base_data)
    else:
        if flow_svc.get("entity_id"):
            data["entity_id"] = flow_svc["entity_id"]
        if flow_svc.get("device_id"):
            data["device_id"] = flow_svc["device_id"]
        data["fixed_flow_temperature"] = optimal_flow

    set_ha_service(domain, service, data)
    logging.info(f"HA service: {domain}.{service} flow={optimal_flow:.1f}C")


def _apply_flow_mqtt(config, optimal_flow, optimal_mode):
    """Publish flow temp and mode to MQTT topics via HA."""
    flow_topic = config.get("mqtt_flow_topic", "qsh/heat_pump/flow_temp/set")
    mode_topic = config.get("mqtt_mode_topic", "qsh/heat_pump/mode/set")

    set_ha_service("mqtt", "publish", {"topic": flow_topic, "payload": str(optimal_flow), "retain": True})
    set_ha_service("mqtt", "publish", {"topic": mode_topic, "payload": optimal_mode, "retain": True})
    logging.info(f"MQTT: flow={optimal_flow:.1f}C mode={optimal_mode} ({flow_topic}, {mode_topic})")


def _apply_flow_entity(config, optimal_flow, optimal_mode):
    """Write flow temp and mode to HA entities for user automation."""
    flow_entity = config.get("entity_flow_target", "input_number.qsh_target_flow_temp")
    mode_entity = config.get("entity_mode_target", "input_text.qsh_target_mode")

    set_ha_service("input_number", "set_value", {"entity_id": flow_entity, "value": optimal_flow})
    set_ha_service("input_text", "set_value", {"entity_id": mode_entity, "value": optimal_mode})
    logging.debug(f"Entity output: flow={optimal_flow:.1f}C mode={optimal_mode}")


# ========================================================================
# MODE CONTROL (per control method)
# ========================================================================


def _apply_mode_octopus_api(optimal_mode):
    """Control HP mode via Octopus GraphQL API.

    Setpoint is handled internally by octopus_api.set_zone_mode() --
    it includes the stored zone setpoint on heat transitions automatically.
    """
    from . import octopus as octopus_api

    result = octopus_api.set_zone_mode(optimal_mode)
    if result == "skipped":
        logging.debug(f"HP already in '{optimal_mode}' mode - no API call needed")
    elif result:
        logging.info(f"HP mode -> '{optimal_mode}'")
    else:
        logging.warning(f"HP mode change to '{optimal_mode}' failed")


def _apply_mode_ha_service(config, optimal_mode):
    """Control heat source mode via HA service call."""
    hvac_svc = config.get("hp_hvac_service", {})
    if not hvac_svc:
        logging.error("ha_service control: no hvac_service configured")
        return

    domain = hvac_svc.get("domain", "climate")
    service = hvac_svc.get("service", "set_hvac_mode")

    data = {}
    if hvac_svc.get("entity_id"):
        data["entity_id"] = hvac_svc["entity_id"]
    if hvac_svc.get("device_id"):
        data["device_id"] = hvac_svc["device_id"]
    data["hvac_mode"] = optimal_mode

    set_ha_service(domain, service, data)
    logging.info(f"HA service: {domain}.{service} mode={optimal_mode}")


# ========================================================================
# PUBLIC API
# ========================================================================


def apply_hardware_control(
    config,
    optimal_mode,
    optimal_flow,
    room_targets,
    prev_mode,
    prev_flow,
    current_time,
    debouncer,
    flow_min,
    flow_max,
    urgent,
    action_counter,
    dfan_control,
    trv_offset_tracker=None,
    hp_power_kw=None,
    prev_mismatch_count=0,
):
    """
    Apply hardware control to heat source and TRVs.

    Routes control commands based on config['control_method']:
      octopus_api  -- Octopus GraphQL
      ha_service   -- HA service calls
      mqtt         -- MQTT publish
      entity       -- HA entity output (user automation)
      trvs_only    -- TRV control only, no heat source control

    Returns:
        (applied_mode, new_mismatch_count)
          applied_mode -- the mode actually applied to the HP. If debounce
            prevented a mode change, this is prev_mode (what the HP is still
            doing). If a readback is available, this is the observed mode
            derived from hp_power_kw.
          new_mismatch_count -- the consecutive-cycle readback mismatch count
            after this cycle. Increments when observed_mode != optimal_mode
            regardless of should_update_mode (alarm semantics are about
            intent-vs-reality, not debouncer state). Resets to zero when they
            match. Unchanged when readback unavailable (hp_power_kw is None)
            or optimal_mode is None.
    """
    if not dfan_control:
        logging.debug("SHADOW MODE: No hardware control")
        return prev_mode, prev_mismatch_count

    should_update_mode = debouncer.should_update_mode(optimal_mode, prev_mode, current_time, urgent=urgent)

    # Track what mode was actually applied to the HP
    applied_mode = optimal_mode if should_update_mode else prev_mode

    should_update_flow = debouncer.should_update_flow(optimal_flow, prev_flow, current_time, urgent=urgent)
    should_update_trvs = debouncer.should_update_trvs(room_targets, current_time, urgent=urgent)

    # ====================================================================
    # TRV SETPOINTS (universal -- works with any heat source)
    # ====================================================================
    if should_update_trvs:
        persistent_zones = set(config.get("persistent_zones", []))
        rooms_set = []
        for room in config["rooms"]:
            if room in persistent_zones:
                continue  # Don't override user-set TRV setpoints

            entity_key = room + "_temp_set_hum"
            valve_entity = f"number.qsh_{room}_valve_target"
            config_mode = config["room_control_mode"].get(room, "indirect")

            if entity_key in config["entities"]:
                if config_mode == "indirect" or (
                    config_mode == "direct" and fetch_ha_entity(valve_entity, default=None, suppress_log=True) is None
                ):
                    # Apply TRV sensor offset compensation
                    # room_targets[room] is the REAL desired temperature
                    # Compensated setpoint accounts for TRV reading hot
                    real_target = room_targets[room]
                    if trv_offset_tracker is not None:
                        temperature = trv_offset_tracker.get_compensated_setpoint(room, real_target)
                    else:
                        temperature = real_target

                    data = {"entity_id": config["entities"][entity_key], "temperature": temperature}
                    set_ha_service("climate", "set_temperature", data)

                    offset = trv_offset_tracker.get_offset(room) if trv_offset_tracker else 0.0
                    if abs(offset) > 0.3:
                        rooms_set.append(f"{room}:{temperature:.1f}(+{offset:.1f})")
                    else:
                        rooms_set.append(f"{room}:{temperature:.1f}")

        if rooms_set:
            logging.debug(
                f"TRV setpoints: {', '.join(rooms_set[:5])}"
                + (f" +{len(rooms_set) - 5} more" if len(rooms_set) > 5 else "")
            )

    # ====================================================================
    # HEAT SOURCE CONTROL (method-specific routing)
    # ====================================================================
    control_method = config.get("control_method", "trvs_only")

    if control_method == "octopus_api":
        if should_update_flow:
            _apply_flow_octopus_api(optimal_flow, flow_min, flow_max)
        if should_update_mode:
            _apply_mode_octopus_api(optimal_mode)

    elif control_method == "ha_service":
        if should_update_flow:
            _apply_flow_ha_service(config, optimal_flow)
        if should_update_mode:
            _apply_mode_ha_service(config, optimal_mode)

    elif control_method == "mqtt":
        # MQTT publishes flow + mode together (cheap, retained)
        if should_update_flow or should_update_mode:
            _apply_flow_mqtt(config, optimal_flow, optimal_mode)

    elif control_method == "entity":
        # Entity output always writes (let user automation handle debouncing)
        if should_update_flow or should_update_mode:
            _apply_flow_entity(config, optimal_flow, optimal_mode)

    elif control_method == "trvs_only":
        logging.debug("TRVs-only mode: no heat source control")

    else:
        logging.error(f"Unknown control_method: {control_method}")

    if not should_update_mode and not should_update_flow and not should_update_trvs:
        logging.debug("Hardware update skipped (debounced)")

    # Readback: derive applied_mode from HP power draw, not from command.
    # Mismatch counter is degated from should_update_mode (see INSTRUCTION-116 D1):
    # a 600s debouncer window would otherwise make the alarm unreachable during
    # a real outage. Log severity still uses should_update_mode to distinguish
    # "we just tried and it didn't stick" (WARNING) from "quiescent mismatch"
    # (INFO), and ERROR is raised on threshold crossing.
    new_mismatch_count = prev_mismatch_count
    if hp_power_kw is not None and optimal_mode is not None:
        observed_mode = "heat" if hp_power_kw >= 0.1 else "off"
        if observed_mode != optimal_mode:
            new_mismatch_count = prev_mismatch_count + 1
            if new_mismatch_count >= READBACK_MISMATCH_ALARM_THRESHOLD:
                logging.error(
                    "Mode readback mismatch persisted for %d cycles "
                    "(threshold %d) — HP not responding to commanded '%s'. "
                    "Check Octopus API status and HP connectivity.",
                    new_mismatch_count, READBACK_MISMATCH_ALARM_THRESHOLD, optimal_mode,
                )
            elif should_update_mode:
                logging.warning(
                    "Mode readback mismatch (%d consecutive): commanded %s but HP power=%.2fkW (observed %s)",
                    new_mismatch_count, optimal_mode, hp_power_kw, observed_mode,
                )
            else:
                logging.info(
                    "Mode readback (%d consecutive): optimal=%s but HP power=%.2fkW (observed %s) — "
                    "will trigger re-command next cycle",
                    new_mismatch_count, optimal_mode, hp_power_kw, observed_mode,
                )
        else:
            new_mismatch_count = 0
        applied_mode = observed_mode

    return applied_mode, new_mismatch_count


def set_heat_source_mode(config, mode, dfan_control=True):
    """
    Set heat source mode directly (bypassing debouncer).

    Used for shoulder season shutdown/recovery where we need
    immediate mode changes regardless of debounce timing.

    Args:
        config: HOUSE_CONFIG dict
        mode: 'heat' or 'off'
        dfan_control: If False (shadow mode), logs but doesn't act
    """
    if not dfan_control:
        logging.info(f"SHADOW MODE: Would set heat source mode to '{mode}'")
        return

    control_method = config.get("control_method", "trvs_only")

    if control_method == "octopus_api":
        _apply_mode_octopus_api(mode)
    elif control_method == "ha_service":
        _apply_mode_ha_service(config, mode)
    elif control_method == "mqtt":
        # For MQTT, send both flow (safe default) and mode
        safe_flow = config.get("mqtt_safe_flow", 35.0) if mode == "heat" else config.get("flow_min", 25.0)
        _apply_flow_mqtt(config, safe_flow, mode)
    elif control_method == "entity":
        mode_entity = config.get("entity_mode_target", "input_text.qsh_target_mode")
        set_ha_service("input_text", "set_value", {"entity_id": mode_entity, "value": mode})
        logging.info(f"Entity output: mode={mode}")
    elif control_method == "trvs_only":
        logging.debug("TRVs-only mode: cannot control heat source mode")
    else:
        logging.error(f"Unknown control_method: {control_method}")


def get_current_heat_source_mode(config):
    """
    Read current heat source mode at startup.

    Returns the current operating mode if readable, None otherwise.
    Used by main.py to initialise prev_mode correctly.
    """
    control_method = config.get("control_method", "trvs_only")

    if control_method == "octopus_api":
        from . import octopus as octopus_api

        return octopus_api.get_current_hp_mode()

    elif control_method == "ha_service":
        hvac_svc = config.get("hp_hvac_service", {})
        entity_id = hvac_svc.get("entity_id")
        if entity_id:
            state = fetch_ha_entity(entity_id, default=None)
            if state in ("heat", "off", "cool", "auto"):
                return state
        return None

    elif control_method == "entity":
        mode_entity = config.get("entity_mode_target", "input_text.qsh_target_mode")
        state = fetch_ha_entity(mode_entity, default=None)
        if state in ("heat", "off"):
            return state
        return None

    # MQTT and trvs_only -- can't read current mode
    return None


def apply_failsafe(config, safe_flow=40.0, safe_mode="heat"):
    """
    Apply safe defaults when the main control loop crashes.

    Routes through the correct control method. If even this fails,
    logs the error but doesn't raise (we're already in error handling).
    """
    control_method = config.get("control_method", "trvs_only")
    logging.warning(f"FAILSAFE: Setting flow={safe_flow}C mode={safe_mode} via {control_method}")

    try:
        if control_method == "octopus_api":
            from . import octopus as octopus_api

            if octopus_api.is_available():
                octopus_api.set_flow_temperature(safe_flow)
                octopus_api.set_zone_mode(safe_mode)
            else:
                logging.error("FAILSAFE: Octopus API not available")

        elif control_method == "ha_service":
            _apply_flow_ha_service(config, safe_flow)
            _apply_mode_ha_service(config, safe_mode)

        elif control_method == "mqtt":
            _apply_flow_mqtt(config, safe_flow, safe_mode)

        elif control_method == "entity":
            _apply_flow_entity(config, safe_flow, safe_mode)

        elif control_method == "trvs_only":
            logging.warning("FAILSAFE: No heat source control available (TRVs-only)")

        else:
            logging.error(f"FAILSAFE: Unknown control method '{control_method}'")

    except Exception as e:
        logging.error(f"FAILSAFE: Failed to apply safe defaults: {e}")
