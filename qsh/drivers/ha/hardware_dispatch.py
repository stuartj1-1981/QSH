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
import math
from typing import Optional
from .integration import fetch_ha_entity, fetch_ha_entity_full, set_ha_service
from qsh.signal_bus import FLOW_BELOW_RETURN_MARGIN_C


# Lower bound on the readback mismatch alarm threshold. Preserves
# pre-INSTRUCTION-249 behaviour as a floor; the effective threshold is
# the larger of this constant and a write-budget-derived value.
READBACK_MISMATCH_FLOOR_CYCLES = 5

# Pipeline cycle interval in seconds. Source of truth: HADriver
# constructor at qsh/drivers/ha/driver.py:122
# (self._cycle_interval = config.get("cycle_interval", 30)). If the
# cycle interval is ever made per-install-tunable beyond the default,
# plumb the value through here from the driver rather than leaving the
# constant.
PIPELINE_CYCLE_SECONDS = 30.0

# Safety margin (cycles) added on top of the debounce-derived wait.
# Sized for typical R290 compressor cold-start response: 90-180 s from
# command receipt to observable power draw crossing the 0.1 kW threshold
# in hardware_dispatch's observed_mode classifier. 6 cycles = 180 s
# covers the upper end of normal response.
READBACK_SAFETY_MARGIN_CYCLES = 6

# Legacy alias retained for downstream consumers that imported the
# pre-INSTRUCTION-249 name (qsh/pipeline/controllers/hardware_controller.py,
# qsh/pipeline/context.py, qsh/api/state.py). Those modules use this name
# only as a default for fields/initial state; the live alarm threshold
# is now derived per-debouncer via _derive_readback_threshold() called
# inside apply_hardware_control(). Binding to the floor preserves their
# behaviour at the legacy value.
READBACK_MISMATCH_ALARM_THRESHOLD = READBACK_MISMATCH_FLOOR_CYCLES


def _derive_readback_threshold(
    mode_debounce_time_s: float,
    response_timeout_s: Optional[float] = None,
) -> int:
    """Compute the readback mismatch alarm threshold (in cycles).

    The single threshold (INSTRUCTION-339B B-1). The operator alarm must not
    fire before:
      - the debouncer has permitted the corresponding mode-write to land AND the
        HP has had time to respond observably:
        ceil(mode_debounce_time / cycle_time) + safety_margin; AND
      - the active source's configured command-to-fire latency has elapsed:
        ceil(response_timeout_s / cycle_time) (INSTRUCTION-339B).
    Floored at READBACK_MISMATCH_FLOOR_CYCLES. The floor/margin are a lower bound,
    so a configured response_timeout_s below the floor is clamped up and no HA
    install regresses. response_timeout_s=None (or 0) drops the timeout term,
    preserving the pre-339B value for any caller that does not supply it.

    `mode_debounce_time_s` stays the first positional argument for backward
    compatibility with the pre-339B single-arg callers; `response_timeout_s` is
    an optional keyword (HardwareController / the MQTT injection pass it through).
    """
    debounce_cycles = int(math.ceil(mode_debounce_time_s / PIPELINE_CYCLE_SECONDS))
    derived = debounce_cycles + READBACK_SAFETY_MARGIN_CYCLES
    timeout_cycles = (
        int(math.ceil(response_timeout_s / PIPELINE_CYCLE_SECONDS))
        if response_timeout_s
        else 0
    )
    return max(timeout_cycles, derived, READBACK_MISMATCH_FLOOR_CYCLES)


# ========================================================================
# FLOW TEMPERATURE CONTROL (per control method)
# ========================================================================

# Octopus API hard limits (KT-CT-4321: "not in range 30 to 70")
OCTOPUS_FLOW_MIN = 30.0
OCTOPUS_FLOW_MAX = 70.0

# Per-entity attribute cache for the HA-service flow dispatch path. Populated
# only on a successful read where all three of (min_temp, max_temp,
# target_temp_step) are present and numeric. A failed/incomplete read leaves
# the cache empty so the next dispatch retries — see INSTRUCTION-152 Task 4
# (M1: cache-on-success-only, L2: step ≤ 0 fallback).
_FLOW_ENTITY_ATTR_CACHE: dict = {}


def _is_positive_number(value) -> bool:
    """True iff value is a real number (not bool, not NaN) and > 0."""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    if value != value:  # NaN check
        return False
    return value > 0


def _is_finite_number(value) -> bool:
    """True iff value is a real (finite) number, regardless of sign."""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    if value != value:  # NaN check
        return False
    return value not in (float("inf"), float("-inf"))


def _clamp_and_round_flow(config, flow_svc, optimal_flow):
    """Clamp the dispatched LWT flow temperature and round to the dispatched
    step.

    INSTRUCTION-185: the entity-advertised ``min_temp``/``max_temp`` are LWT
    bounds ONLY when the dispatched HA service writes the entity's
    ``temperature`` attribute -- ``climate.set_temperature`` (Daikin /
    Vaillant / Samsung) and ``climate.set_control_setpoint`` (OpenTherm).
    For any other service the entity at ``flow_control.entity_id`` is a
    routing target rather than an LWT setpoint; reading its min/max is a
    category error.

    Concrete failure mode the gate prevents (Connor 6 May 2026): for Octopus
    Cosy via ``octopus_energy.set_heat_pump_flow_temp_config`` the climate
    entity is the **room-temperature setpoint** ("Heating Setpoint",
    min_temp=7, max_temp=30, step=0.5). Reading those bounds as LWT clamps
    silently pinned every flow demand >=30°C to 30°C, starving the HP of
    capacity on real cold days.

    When the gate evaluates False (non-LWT service), bounds come from the
    HOUSE_CONFIG runtime values: ``flow_min_internal`` /
    ``flow_max_internal`` (API-managed, defaults 25/50 per
    ``qsh/config.py:651-652``) with legacy ``flow_min`` / ``flow_max``
    (defaults 25/55 per ``qsh/config.py:1595-1596``) as a second-tier
    fallback. ``config`` IS HOUSE_CONFIG (top-level), not the
    ``flow_control`` sub-block -- the ``_internal`` keys live at the top
    level. The Octopus primary write path goes via
    ``_apply_flow_octopus_api`` and bypasses this function entirely once
    ``has_octopus`` resolves True; this function is the safety-net path for
    api-key-loss / runtime-fallback / future-vendor cases.
    """
    entity_id = flow_svc.get("entity_id")
    service = flow_svc.get("service", "")

    # Entity-advertised min/max are LWT-relevant ONLY when the dispatched
    # service writes the entity's temperature attribute. Custom services
    # (e.g. octopus_energy.set_heat_pump_flow_temp_config) treat the climate
    # entity as a routing target only -- their min/max are room-temp bounds.
    entity_is_lwt_setpoint = service in ("set_temperature", "set_control_setpoint")

    # Fallback priority: HOUSE_CONFIG _internal values (API-managed runtime
    # bounds, always present, defaults 25/50) > heat_source legacy keys
    # (defaults 25/55). config IS HOUSE_CONFIG (top-level), not flow_control.
    fallback_min = float(config.get("flow_min_internal", config.get("flow_min", 25.0)))
    fallback_max = float(config.get("flow_max_internal", config.get("flow_max", 55.0)))
    fallback_step = 0.5

    min_temp = fallback_min
    max_temp = fallback_max
    step = fallback_step

    if entity_id and entity_is_lwt_setpoint:
        cached = _FLOW_ENTITY_ATTR_CACHE.get(entity_id)
        if cached is not None:
            min_temp, max_temp, step = cached
        else:
            full = fetch_ha_entity_full(entity_id, suppress_log=True)
            if full is not None:
                attrs = full.get("attributes", {}) or {}
                cand_min = attrs.get("min_temp")
                cand_max = attrs.get("max_temp")
                cand_step = attrs.get("target_temp_step")
                # Cache only if all three are present, numeric, and step > 0.
                if (
                    _is_finite_number(cand_min)
                    and _is_finite_number(cand_max)
                    and _is_positive_number(cand_step)
                ):
                    min_temp = float(cand_min)
                    max_temp = float(cand_max)
                    step = float(cand_step)
                    _FLOW_ENTITY_ATTR_CACHE[entity_id] = (min_temp, max_temp, step)
                # else: leave cache empty so next dispatch retries; use
                # fallbacks for THIS dispatch only.
    # else: entity_is_lwt_setpoint is False -- min_temp/max_temp/step retain
    # the config-derived fallback values above.

    # Per-vendor step override applies in BOTH branches: it lives outside the
    # entity-attr block so it overrides both the entity-advertised step
    # (LWT-setpoint path) and the 0.5 default (non-LWT path).
    # Daikin EDLA082 advertises 0.5 but only retains integers. The runtime
    # source is heat_source.flow_control.step_override from qsh.yaml, which
    # the config loader exposes as hp_flow_service[step_override] (the
    # flow_control dict is pass-through). config["flow_control"] is the
    # supported alternative for callers passing a YAML-shaped dict.
    override = flow_svc.get("step_override")
    if not _is_positive_number(override):
        flow_ctrl_cfg = config.get("flow_control", {}) or {}
        override = flow_ctrl_cfg.get("step_override")
    if _is_positive_number(override):
        step = float(override)

    # Clamp, then round to the nearest multiple of step.
    clamped = max(min_temp, min(max_temp, optimal_flow))
    if step <= 0:
        # Defensive — _is_positive_number already guards both code paths,
        # but make the divide unconditionally safe.
        step = 0.5
    rounded = round(clamped / step) * step
    rounded = round(rounded, 4)  # cleanup floating-point artefacts

    if rounded != optimal_flow:
        if entity_is_lwt_setpoint:
            logging.info(
                "HA service: clamped flow %.2f → %.2f (entity %s, range %.1f-%.1f, step %.2f)",
                optimal_flow, rounded, entity_id or "<none>", min_temp, max_temp, step,
            )
        else:
            logging.info(
                "HA service: clamped flow %.2f → %.2f (range %.1f-%.1f, config bounds, "
                "entity attrs not used for service '%s')",
                optimal_flow, rounded, min_temp, max_temp, service,
            )

    return rounded


def _apply_flow_octopus_api(optimal_flow, flow_min, flow_max):
    """Clamp to user-configured flow_min/flow_max from HOUSE_CONFIG, then
    dispatch via Octopus GraphQL API (which has its own internal 30-70 °C
    protection). User config takes precedence — the API protection is a
    safety net, not the primary bound.
    """
    from . import octopus_hp_control as octopus_api

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
    """Control flow temp via HA service call.

    Clamps to the climate entity's advertised min_temp/max_temp and rounds
    to its target_temp_step (or `flow_control.step_override` if set). The
    entity is the authoritative source for what the hardware will accept;
    HOUSE_CONFIG flow_min/flow_max are used only as fallback when the
    entity attributes cannot be read.
    """
    flow_svc = config.get("hp_flow_service", {})
    if not flow_svc:
        logging.error("ha_service control: no flow_service configured")
        return

    domain = flow_svc.get("domain", "")
    service = flow_svc.get("service", "")

    safe_flow = _clamp_and_round_flow(config, flow_svc, optimal_flow)

    # Build service data -- start with base_data if present
    data = dict(flow_svc.get("base_data", {}))

    # Standard climate.set_temperature pattern
    if service == "set_temperature":
        if flow_svc.get("entity_id"):
            data["entity_id"] = flow_svc["entity_id"]
        data["temperature"] = safe_flow
    # OpenTherm set_control_setpoint pattern
    elif service == "set_control_setpoint":
        if flow_svc.get("entity_id"):
            data["entity_id"] = flow_svc["entity_id"]
        data["temperature"] = safe_flow
    # Custom service (e.g. Octopus via HA -- includes base_data)
    else:
        if flow_svc.get("entity_id"):
            data["entity_id"] = flow_svc["entity_id"]
        if flow_svc.get("device_id"):
            data["device_id"] = flow_svc["device_id"]
        data["fixed_flow_temperature"] = safe_flow

    set_ha_service(domain, service, data)
    logging.info(f"HA service: {domain}.{service} flow={safe_flow:.1f}C")


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
    from . import octopus_hp_control as octopus_api

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


def compute_mode_readback(
    prev_mismatch_count: int,
    optimal_mode: Optional[str],
    prev_mode: Optional[str],
    hp_power_kw: Optional[float],
    optimal_flow: float,
    return_temp: Optional[float],
    has_live_return_temp: bool,
    readback_threshold: int,
    should_update_mode: bool,
) -> tuple[Optional[str], int]:
    """Driver-agnostic mode readback. Returns (observed_mode_or_prev, new_mismatch_count).

    Derives observed_mode from HP power draw (>= 0.1 kW => "heat", else "off"),
    counts consecutive cycles where observed_mode != optimal_mode, suppresses the
    count when the HP is legitimately idle because demand is satisfied (commanded
    flow <= return + margin), and raises an operator alarm at readback_threshold.

    The mismatch counter is independent of should_update_mode — alarm semantics are
    intent-vs-reality, not debouncer state (INSTRUCTION-116 D1). should_update_mode
    only selects log severity: WARNING when QSH just attempted the mode-write,
    INFO when quiescent.

    This is the single shared readback computation for every driver: the HA driver
    (apply_hardware_control below) and the MQTT injection slot
    (qsh/pipeline/__init__.py) both call it, so the readback math cannot drift
    between drivers (INSTRUCTION-339A). It is pure — no I/O beyond logging, and it
    references no apply_hardware_control local beyond its own parameters.

    Args mirror the readback inputs only; the dispatch/shadow-mode wrapper is the
    caller's responsibility (HA gates dispatch at the top of apply_hardware_control;
    the MQTT injection is readback-only and never dispatches).

    Returns:
        (applied_mode, new_mismatch_count)
          applied_mode -- observed_mode when readback is available; otherwise the
            pre-readback fallback (optimal_mode if should_update_mode else prev_mode).
          new_mismatch_count -- consecutive-cycle mismatch count after this cycle.
            Increments on observed_mode != optimal_mode, resets to zero when they
            match or when demand-satisfied suppression fires, and passes through
            unchanged when readback is unavailable (hp_power_kw is None or
            optimal_mode is None).
    """
    applied_mode = optimal_mode if should_update_mode else prev_mode
    new_mismatch_count = prev_mismatch_count
    if hp_power_kw is not None and optimal_mode is not None:
        observed_mode = "heat" if hp_power_kw >= 0.1 else "off"
        if observed_mode != optimal_mode:
            flow_below_return = (
                has_live_return_temp
                and return_temp is not None
                and optimal_flow <= return_temp + FLOW_BELOW_RETURN_MARGIN_C
            )
            if optimal_mode == "heat" and flow_below_return:
                # QSH commanded flow at/below return — HP idle is demand-satisfied,
                # not an unresponsive HP. Do not escalate; reset the counter.
                new_mismatch_count = 0
                logging.debug(
                    "Readback: commanded heat but HP idle with flow %.1f°C <= return "
                    "%.1f°C (+%.1f margin) — demand-satisfied wind-down, suppressed",
                    optimal_flow, return_temp, FLOW_BELOW_RETURN_MARGIN_C,
                )
            else:
                new_mismatch_count = prev_mismatch_count + 1
                if new_mismatch_count >= readback_threshold:
                    logging.error(
                        "Mode readback mismatch persisted for %d cycles "
                        "(threshold %d) — HP not responding to commanded '%s'. "
                        "Check Octopus API status and HP connectivity.",
                        new_mismatch_count, readback_threshold, optimal_mode,
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
    return_temp=None,
    has_live_return_temp=False,
    response_timeout_s=None,
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

    # The mode actually applied to the HP (observed readback or pre-readback
    # fallback) is computed by compute_mode_readback at the tail of this function.

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
    #
    # INSTRUCTION-249 Task 1: the alarm threshold is derived per-debouncer
    # from mode_debounce_time so it scales with the configured write budget.
    # The legacy hardcoded 5-cycle threshold fired before the debouncer
    # could even permit the next mode-write at any mode_writes_per_hour in
    # [3,6], rendering the alarm meaningless on tight write budgets.
    readback_threshold = _derive_readback_threshold(
        debouncer.mode_debounce_time, response_timeout_s=response_timeout_s
    )
    if not getattr(debouncer, "_readback_threshold_logged", False):
        logging.info(
            "Readback mismatch ERROR threshold = %d cycles (%.0fs) "
            "(mode_debounce_time=%.0fs, safety_margin=%d cycles, "
            "floor=%d cycles)",
            readback_threshold,
            readback_threshold * PIPELINE_CYCLE_SECONDS,
            debouncer.mode_debounce_time,
            READBACK_SAFETY_MARGIN_CYCLES,
            READBACK_MISMATCH_FLOOR_CYCLES,
        )
        debouncer._readback_threshold_logged = True

    # Readback computation is the driver-agnostic shared helper (the same one
    # the MQTT injection calls), so HA and MQTT cannot drift. INSTRUCTION-339A.
    return compute_mode_readback(
        prev_mismatch_count=prev_mismatch_count,
        optimal_mode=optimal_mode,
        prev_mode=prev_mode,
        hp_power_kw=hp_power_kw,
        optimal_flow=optimal_flow,
        return_temp=return_temp,
        has_live_return_temp=has_live_return_temp,
        readback_threshold=readback_threshold,
        should_update_mode=should_update_mode,
    )


def apply_source_command(config, commands, dfan_control=True):
    """Dispatch per-source on/off commands (228A).

    For each source in `commands`, look up its `control_method` from
    `config['heat_sources'][]` by name. Route to the existing per-method
    apply functions (_apply_mode_octopus_api, _apply_mode_ha_service,
    _apply_flow_mqtt, _apply_mode_entity) on a per-source basis, passing
    each that source's config slice (the heat_source dict) as the dispatch
    context.

    Sources whose `control_method` is `trvs_only` are silently skipped —
    there is no heat-source actuator to command, only TRVs.

    Sources whose name appears in `commands` but is absent from
    `config['heat_sources']` are logged as a warning and skipped.

    Shadow mode (`dfan_control=False`) suppresses every dispatch and logs
    SHADOW MODE for each suppressed source.

    Args:
        config: HOUSE_CONFIG dict
        commands: {source_name: 'heat'|'off'}
        dfan_control: If False (shadow mode), logs but doesn't act.

    Returns:
        {source_name: applied_mode} for telemetry/state tracking.
    """
    applied: dict = {}
    sources_by_name = {s.get("name", ""): s for s in config.get("heat_sources", [])}

    for source_name, mode in commands.items():
        if source_name not in sources_by_name:
            logging.warning(
                "apply_source_command: unknown source '%s' — skipping", source_name,
            )
            continue
        src_cfg = sources_by_name[source_name]
        control_method = src_cfg.get("control_method", "trvs_only")

        if not dfan_control:
            logging.debug(
                "SHADOW MODE: suppressed source command %s -> %s (method=%s)",
                source_name, mode, control_method,
            )
            continue

        if control_method == "octopus_api":
            _apply_mode_octopus_api(mode)
        elif control_method == "ha_service":
            # ha_service: read hvac_service slice from this source's config.
            # The per-source slice may carry its own hp_hvac_service shape
            # (preferred) or fall back to top-level config for back-compat.
            slice_cfg = dict(config)
            if "hp_hvac_service" in src_cfg:
                slice_cfg["hp_hvac_service"] = src_cfg["hp_hvac_service"]
            _apply_mode_ha_service(slice_cfg, mode)
        elif control_method == "mqtt":
            # MQTT mode dispatch through the existing flow_mqtt path with a
            # safe flow default. Per-source MQTT topic templating belongs to
            # the MQTT driver (see qsh/drivers/mqtt/driver.write_outputs).
            safe_flow = (
                src_cfg.get("mqtt_safe_flow", config.get("mqtt_safe_flow", 35.0))
                if mode == "heat"
                else src_cfg.get("flow_min", config.get("flow_min", 25.0))
            )
            slice_cfg = dict(config)
            if "mqtt_flow_topic" in src_cfg:
                slice_cfg["mqtt_flow_topic"] = src_cfg["mqtt_flow_topic"]
            if "mqtt_mode_topic" in src_cfg:
                slice_cfg["mqtt_mode_topic"] = src_cfg["mqtt_mode_topic"]
            _apply_flow_mqtt(slice_cfg, safe_flow, mode)
        elif control_method == "entity":
            mode_entity = src_cfg.get(
                "entity_mode_target",
                config.get("entity_mode_target", "input_text.qsh_target_mode"),
            )
            set_ha_service(
                "input_text", "set_value",
                {"entity_id": mode_entity, "value": mode},
            )
            logging.info("Entity output (%s): mode=%s", source_name, mode)
        elif control_method == "trvs_only":
            logging.debug(
                "trvs_only source '%s': no heat source actuator to command",
                source_name,
            )
        else:
            logging.error(
                "apply_source_command: unknown control_method '%s' for source '%s'",
                control_method, source_name,
            )
            continue

        applied[source_name] = mode

    return applied


def set_auxiliary_output(config, entity: str, state: bool) -> bool:
    """Dispatch switch.turn_on / turn_off (or input_boolean.turn_on / turn_off)
    for an auxiliary boolean output entity.

    Returns True on successful dispatch, False on failure. Caller must surface
    failures to OutputBlock.auxiliary_dispatch_failures so the controller can
    revert state on the next cycle (per INSTRUCTION-131B Task 1).
    """
    domain = entity.split(".", 1)[0]
    service = "turn_on" if state else "turn_off"
    if domain not in ("switch", "input_boolean"):
        logging.warning(
            "set_auxiliary_output: unsupported domain '%s' for %s", domain, entity
        )
        return False
    try:
        set_ha_service(domain, service, {"entity_id": entity})
        return True
    except Exception as e:
        logging.warning("set_auxiliary_output: dispatch failed for %s: %s", entity, e)
        return False


def release_supervisory_surface(config, surface, record=None) -> bool:
    """Hand one supervisory surface back to native control on apoptosis dormancy
    (INSTRUCTION-322A).

    The hand-back is "stop overriding", not a new control action — the manufacturer
    / native controller resumes ownership. Best-effort and defensive: never raises;
    a surface with no actuatable hand-back is a logged no-op. Returns True when a
    native hand-back dispatch was attempted, False otherwise.

    Shadow-mode gating is the CALLER's responsibility — write_outputs only calls
    this when control_enabled is True. The 225A manual-TRV carve-out is NOT used.
    """
    try:
        if surface in ("hp_mode", "shoulder_command"):
            # Release heat-source mode: command native 'heat' per source so the
            # manufacturer controller (incl. native antifrost) resumes ownership.
            sources = config.get("heat_sources", []) or []
            named = {s.get("name", ""): "heat" for s in sources if s.get("name")}
            if named:
                apply_source_command(config, named, dfan_control=True)
                return True
            # Legacy single-source install with no per-source list — fall back to
            # the configured control_method's native mode write.
            apply_source_command(config, {}, dfan_control=True)
            return False
        if surface == "hp_flow_setpoint":
            # Nothing to actively write — native weather compensation resumes once
            # QSH ceases flow writes. The override simply stops.
            return False
        if surface in ("trv_position", "type2_external_temp"):
            # Reset every direct-control valve (Type1/Type2) to native thermostat
            # operation; this also drops any Type-2 external-temperature push.
            from .valve_dispatch import reset_all_direct_valves_to_normal

            count = reset_all_direct_valves_to_normal(config)
            return count > 0
        if surface == "auxiliary_output":
            # Release every configured aux actuator to its native (off) state.
            aux_cfg = config.get("auxiliary_outputs", {}) or {}
            dispatched = False
            for _room, room_aux in aux_cfg.items():
                if not isinstance(room_aux, dict) or not room_aux.get("enabled"):
                    continue
                entity = room_aux.get("ha_entity")
                if entity and set_auxiliary_output(config, entity, False):
                    dispatched = True
            return dispatched
        logging.warning(
            "release_supervisory_surface: unknown surface '%s' — skipped", surface
        )
        return False
    except Exception as e:
        logging.warning(
            "release_supervisory_surface: %s hand-back failed: %s", surface, e
        )
        return False


def get_current_heat_source_mode(config):
    """
    Read current heat source mode at startup.

    Returns the current operating mode if readable, None otherwise.
    Used by main.py to initialise prev_mode correctly.
    """
    control_method = config.get("control_method", "trvs_only")

    if control_method == "octopus_api":
        from . import octopus_hp_control as octopus_api

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
            from . import octopus_hp_control as octopus_api

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
