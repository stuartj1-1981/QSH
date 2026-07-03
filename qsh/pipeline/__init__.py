"""
QSH Controller Pipeline — v0.4.0

S88-inspired controller pipeline architecture for thermal control.
Replaces the monolithic sim_step with independently testable,
mode-aware controllers sharing state through CycleContext.

Public API:
    CycleContext  — per-cycle shared state object
    Controller    — base class for pipeline controllers
    run_cycle     — orchestrator: create context, run controllers, return result
    build_pipeline — factory: create ordered list of all controllers
"""

import os
from pathlib import Path
from typing import List, Tuple

from qsh.paths import find_state_file
from .context import CycleContext
from .controller import Controller
from .cycle_protection import CycleProtectionGate, CycleProtectionState
from .orchestrator import run_cycle, save_pipeline_state, restore_pipeline_state

from .controllers import (
    BoostController,
    DegradationController,
    HeatSourceSensorSelector,
    SensorController,
    ThermalController,
    EnergyController,
    ForecastController,
    CycleController,
    ValveController,
    HydraulicController,
    AntifrostOverrideController,
    ShoulderController,
    SummerController,
    HWController,
    CascadeController,
    AuxiliaryOutputController,
    FlowController,
    RLController,
    SourceSelectionController,
    HardwareController,
    ShadowController,
    CostController,
    HistorianController,
    TariffOptimiserController,
    AllostaticLoadController,
    CompositeConfidenceController,
    SwarmTelemetryController,
    ApoptosisArbiterController,
)
from .controllers.swarm_context_enricher import SwarmContextEnricher

__all__ = [
    "CycleContext",
    "Controller",
    "run_cycle",
    "save_pipeline_state",
    "restore_pipeline_state",
    "build_pipeline",
    "BoostController",
    "DegradationController",
    "HeatSourceSensorSelector",
    "SensorController",
    "ThermalController",
    "EnergyController",
    "ForecastController",
    "CycleController",
    "ValveController",
    "HydraulicController",
    "AntifrostOverrideController",
    "ShoulderController",
    "SummerController",
    "HWController",
    "CascadeController",
    "AuxiliaryOutputController",
    "FlowController",
    "RLController",
    "SourceSelectionController",
    "HardwareController",
    "ShadowController",
    "CostController",
    "HistorianController",
    "TariffOptimiserController",
    "AllostaticLoadController",
    "CompositeConfidenceController",
    "SwarmTelemetryController",
    "ApoptosisArbiterController",
    "SwarmContextEnricher",
]


def _resolve_driver_defaults(kwargs, driver_type):
    """Resolve default driver functions for any DI slot not explicitly provided.

    For driver_type='ha': imports from drivers.ha (the composition root).
    For driver_type='mqtt' (or any non-HA, non-mock): provides no-op stubs
    that log at debug level. Data arrives via InputBlock; control decisions
    leave via OutputBlock; the MQTT driver dispatches them.

    This is the composition root — the ONLY place outside drivers/ha/ that is
    allowed to know which concrete driver functions exist. Controllers
    themselves must never import from drivers.ha.
    """
    import logging as _log

    _logger = _log.getLogger(__name__)

    if driver_type == "ha":
        return _resolve_ha_defaults(kwargs)

    # Non-HA real-time driver (MQTT): no-op stubs with logging
    return _resolve_noop_defaults(kwargs, _logger, driver_type)


def _resolve_ha_defaults(kwargs):
    """HA-specific DI resolution. Only called when driver_type='ha'."""
    resolved = dict(kwargs)

    if resolved.get("fetch_ha_entity_fn") is None:
        from ..drivers.ha.integration import fetch_ha_entity

        resolved["fetch_ha_entity_fn"] = fetch_ha_entity

    if resolved.get("apply_hardware_control_fn") is None:
        from ..drivers.ha.hardware_dispatch import apply_hardware_control

        resolved["apply_hardware_control_fn"] = apply_hardware_control

    if resolved.get("get_reliable_cop_fn") is None:
        from ..drivers.ha.cop_fetcher import get_reliable_cop

        resolved["get_reliable_cop_fn"] = get_reliable_cop

    # INSTRUCTION-370 — DegradationController dispatch callables. Reachability is
    # the existing direct-valve availability probe; the park-once write is the
    # new open-bias dispatch. Bound here (the composition root) so the controller
    # never imports from drivers.ha directly.
    if resolved.get("degradation_check_fn") is None:
        from ..drivers.ha.valve_dispatch import check_direct_valve_available

        resolved["degradation_check_fn"] = check_direct_valve_available

    if resolved.get("degradation_park_fn") is None:
        from ..drivers.ha.valve_dispatch import park_degraded_zone

        resolved["degradation_park_fn"] = park_degraded_zone

    # Valve functions: bind HA dispatch callables into the pure logic functions
    # so ValveController can call them with the original positional signature.
    if resolved.get("apply_dissipation_fn") is None:
        from ..drivers.ha.valve_dispatch import (
            get_room_valve_fraction,
            check_direct_valve_available,
            apply_valve_position,
        )
        from ..valve_control import apply_dissipation_control as _pure_dissipation

        def _bound_dissipation(
            config,
            heating_percs,
            room_targets,
            control_state,
            sensor_temps,
            low_delta_persist,
            avg_open_frac,
            dfan_control,
        ):
            return _pure_dissipation(
                config,
                heating_percs,
                room_targets,
                control_state,
                sensor_temps,
                low_delta_persist,
                avg_open_frac,
                dfan_control,
                get_valve_fraction_fn=get_room_valve_fraction,
                check_valve_available_fn=check_direct_valve_available,
                apply_valve_position_fn=apply_valve_position,
            )

        resolved["apply_dissipation_fn"] = _bound_dissipation

    if resolved.get("apply_hybrid_fn") is None:
        from ..drivers.ha.valve_dispatch import (
            get_room_valve_fraction,
            check_direct_valve_available,
            apply_direct_valve_control,
        )
        from ..valve_control import apply_hybrid_room_control as _pure_hybrid

        def _bound_hybrid(
            config,
            heating_percs,
            room_targets,
            control_state,
            heat_up_rate,
            dfan_control,
            balancing_detector=None,
            sensor_temps=None,
            degraded_zones=None,
        ):
            return _pure_hybrid(
                config,
                heating_percs,
                room_targets,
                control_state,
                heat_up_rate,
                dfan_control,
                balancing_detector,
                sensor_temps,
                get_valve_fraction_fn=get_room_valve_fraction,
                check_valve_available_fn=check_direct_valve_available,
                apply_direct_control_fn=apply_direct_valve_control,
                degraded_zones=degraded_zones,
            )

        resolved["apply_hybrid_fn"] = _bound_hybrid

    return resolved


def _resolve_noop_defaults(kwargs, logger, driver_type):
    """Provide no-op stubs for DI slots on non-HA drivers (MQTT, mock).

    External data arrives via InputBlock and control decisions leave via
    OutputBlock. Controllers that would normally call HA directly (energy
    rates, COP fetch, valve dispatch, hardware apply) get stub functions
    that either read from the signal or do nothing.
    """
    resolved = dict(kwargs)

    if resolved.get("fetch_ha_entity_fn") is None:

        def _noop_fetch(entity_id, attribute="state", default=None):
            return default

        resolved["fetch_ha_entity_fn"] = _noop_fetch

    # Hardware: OutputBlock captures decisions, driver dispatches
    # Signature: apply_hw(config, mode, flow, targets, prev_mode, prev_flow,
    #                     timestamp, debouncer, flow_min, flow_max, urgent,
    #                     action_counter, control_enabled, trv_tracker)
    if resolved.get("apply_hardware_control_fn") is None:
        if driver_type == "mqtt":
            # MQTT does NOT dispatch flow/mode here — publication stays in
            # driver.write_outputs (and is shadow-gated there). But the
            # heat-source mode readback is driver-agnostic and must run so
            # ctx.readback_mismatch_count is LIVE on MQTT installs, at parity
            # with the HA driver (INSTRUCTION-339A). It calls the SAME shared
            # helper apply_hardware_control uses, so the readback math cannot
            # drift between drivers. This is the composition root — the only
            # place outside drivers/ha permitted to import a concrete driver
            # function (mirrors the HA apply_hardware_control import in
            # _resolve_ha_defaults above).
            from ..drivers.ha.hardware_dispatch import (
                _derive_readback_threshold,
                compute_mode_readback,
            )

            def _mqtt_readback_hw(*args, **kw):
                # HardwareController call contract (see
                # qsh/pipeline/controllers/hardware_controller.py:229-248):
                #   args[1]=optimal_mode, args[2]=optimal_flow, args[4]=prev_mode;
                #   readback inputs (hp_power_kw, prev_mismatch_count, return_temp,
                #   has_live_return_temp) arrive as kwargs.
                #
                # No silent fallback. HardwareController always supplies the full
                # positional arg list; any shorter call is by construction a DI
                # signature drift event and must fail loudly so it is caught by
                # tests and startup smoke, not by misleading state downstream.
                if len(args) < 2:
                    raise RuntimeError(
                        "_mqtt_readback_hw called with fewer than 2 positional "
                        "args — DI signature drift at apply_hardware_control boundary"
                    )
                optimal_mode = args[1]
                optimal_flow = args[2] if len(args) > 2 else 0.0
                prev_mode = args[4] if len(args) > 4 else None
                # should_update_mode=True: MQTT re-publishes flow+mode together
                # every cycle in write_outputs, so the mode write is never
                # debounced away (mode_debounce_time_s=0.0). The threshold is the
                # SINGLE per-source threshold (INSTRUCTION-339B B-1/B-2) — the same
                # _derive_readback_threshold the HA path uses — driven by the
                # active source's response_timeout_s that HardwareController
                # resolves and forwards, so the per-source operator alarm fires on
                # MQTT too. The floor/margin remain a lower bound.
                return compute_mode_readback(
                    prev_mismatch_count=kw.get("prev_mismatch_count", 0),
                    optimal_mode=optimal_mode,
                    prev_mode=prev_mode,
                    hp_power_kw=kw.get("hp_power_kw"),
                    optimal_flow=optimal_flow,
                    return_temp=kw.get("return_temp"),
                    has_live_return_temp=kw.get("has_live_return_temp", False),
                    readback_threshold=_derive_readback_threshold(
                        0.0, response_timeout_s=kw.get("response_timeout_s")
                    ),
                    should_update_mode=True,
                )

            resolved["apply_hardware_control_fn"] = _mqtt_readback_hw
        else:

            def _noop_hw(*args, **kw):
                # HardwareController expects (applied_mode, new_mismatch_count).
                # The mock driver has no hardware readback — mismatch is always 0.
                # `applied_mode` is the commanded optimal_mode (args[1] per the caller
                # contract at qsh/pipeline/controllers/hardware_controller.py:114–131).
                #
                # No silent fallback. HardwareController always supplies 13 positional
                # args; any shorter call is by construction a DI signature drift event
                # and must fail loudly so it is caught by tests and startup smoke,
                # not by misleading shadow-mode state downstream.
                if len(args) < 2:
                    raise RuntimeError(
                        "_noop_hw called with fewer than 2 positional args — "
                        "DI signature drift at apply_hardware_control boundary"
                    )
                applied_mode = args[1]
                return applied_mode, 0

            resolved["apply_hardware_control_fn"] = _noop_hw

    # COP: already in InputBlock.hp_cop
    # Signature: get_cop(config, cop_history)
    # COP (INSTRUCTION-395): live COP, where a topic exists, reaches
    # ctx.live_cop via the CycleController live-first path — this fallback
    # covers the no-topic case. It mirrors drivers/ha/cop_fetcher.py:26-29:
    # track the ACTIVE source's stored efficiency, stamped into config each
    # cycle by SourceSelection (source_selection.py:1133) and seeded at boot
    # (config.py:2412). Never an UNCONDITIONAL constant — the constant-3.5
    # stub was the root cause of the stuck-COP defect (3 Jul 2026, MQTT
    # dual-source install, v1.5.20); 3.5 below survives only as the
    # key-absent default, matching cop_fetcher.py:26.
    if resolved.get("get_reliable_cop_fn") is None:

        def _config_baseline_cop(config, cop_history):
            del cop_history  # signature parity with get_reliable_cop
            return config.get("heat_source_efficiency", 3.5)

        resolved["get_reliable_cop_fn"] = _config_baseline_cop

    # INSTRUCTION-370 — non-HA drivers have no HA valve-entity reachability path.
    # Report every zone as reachable (never demote) and make the park a no-op:
    # degradation detection is an HA-entity concern, and MQTT/mock dispatch
    # leaves via OutputBlock, not these callables.
    if resolved.get("degradation_check_fn") is None:

        def _noop_degradation_check(room, config):
            return True, ""

        resolved["degradation_check_fn"] = _noop_degradation_check

    if resolved.get("degradation_park_fn") is None:

        def _noop_degradation_park(*args, **kw):
            return False

        resolved["degradation_park_fn"] = _noop_degradation_park

    # Valve functions: OutputBlock captures setpoints, driver dispatches
    if resolved.get("apply_dissipation_fn") is None:

        def _noop_dissipation(*a, **kw):
            return {}

        resolved["apply_dissipation_fn"] = _noop_dissipation

    # Signature: apply_hybrid(config, heating_percs, targets, state,
    #                         heat_up_rate, dfan_control, balancing_detector)
    # Returns: (flow_adjust_rooms: float, upward_nudge_count: int)
    if resolved.get("apply_hybrid_fn") is None:

        def _noop_hybrid(*a, **kw):
            return 0.0, 0

        resolved["apply_hybrid_fn"] = _noop_hybrid

    logger.info("Pipeline DI: using no-op stubs for %s driver", driver_type)
    return resolved


def build_pipeline(config, **kwargs) -> Tuple[List[Controller], AuxiliaryOutputController]:
    """
    Build the full controller pipeline in correct execution order.

    All external dependencies are passed via kwargs for testability.
    When called without explicit overrides, defaults are resolved from
    the HA driver package via _resolve_ha_defaults (the composition root).
    When driver is 'mock', no-op stubs are used instead.

    Args:
        config: HOUSE_CONFIG dict
        **kwargs: Optional dependency overrides for each controller.
            See individual controller __init__ signatures for available
            injection points.

    Returns:
        Tuple of (controllers, aux_controller):
        - controllers: List of Controller instances in execution order.
        - aux_controller: Explicit handle to the AuxiliaryOutputController
          instance in the list (V6/B12). The orchestrator (qsh/main.py)
          uses this handle to call aux_controller.post_dispatch_finalise(ctx)
          AFTER driver.write_outputs(...) returns and BEFORE the next
          cycle's pipeline. Wiring of the post-dispatch hook is 131B's
          responsibility; 131A defines the interface.
    """
    driver_type = config.get("driver", "ha")
    if driver_type == "mock":
        kw = _resolve_noop_defaults(kwargs, __import__("logging").getLogger(__name__), "mock")
    else:
        kw = _resolve_driver_defaults(kwargs, driver_type)

    # INSTRUCTION-117D Task 3b: validate installer flow_limits override against
    # the active source's capability envelope at startup. Out-of-envelope
    # values raise ConfigValidationError (fail-hard, process exits non-zero).
    from .controllers.flow_controller import (
        validate_flow_limits,
        warn_source_flow_limits,
    )
    validate_flow_limits(config)
    # INSTRUCTION-372A — warn-once (no raise) for out-of-envelope per-source
    # heat_sources[].flow_min/flow_max; the value is clamped per-cycle by
    # build_caps_from_config using the same shared predicate.
    warn_source_flow_limits(config)

    # INSTRUCTION-261 Task 5 — orchestrator-owned allostatic-load registry.
    # Constructed once per pipeline; injected into AllostaticLoadController
    # at position immediately before HistorianController.
    from ..allostatic_load import AllostaticLoadRegistry
    allostatic_registry = AllostaticLoadRegistry()

    valve = ValveController(
        room_control_state=kw.get("room_control_state"),
        apply_dissipation_fn=kw.get("apply_dissipation_fn"),
        apply_hybrid_fn=kw.get("apply_hybrid_fn"),
        calc_flow_adjust_fn=kw.get("calc_flow_adjust_fn"),
    )
    # INSTRUCTION-117D Task 2d: single pipeline-owned CycleProtectionState /
    # CycleProtectionGate. One physical heat source → one pair of timers.
    # Same gate instance is injected into both ShoulderController and
    # SummerController so cross-arbiter coherence is enforced at the state
    # level, not at an arbiter-local level.
    cycle_protection_path = Path(find_state_file("cycle_protection.json"))
    cycle_protection_state = CycleProtectionState.load_or_default(cycle_protection_path)
    cycle_protection_gate = CycleProtectionGate(
        cycle_protection_state, cycle_protection_path
    )
    shoulder = ShoulderController(
        room_control_state=valve.room_control_state,
        cycle_protection_gate=cycle_protection_gate,
    )
    summer = SummerController(
        shoulder_controller=shoulder,
        cycle_protection_gate=cycle_protection_gate,  # SAME instance
    )
    boost = BoostController()
    # INSTRUCTION-131A — AuxiliaryOutputController sits immediately after
    # CascadeController and before FlowController. Constructor takes only
    # the config slice it needs (V3/A6). The instance is also returned
    # alongside the controllers list so the orchestrator gets a stable
    # handle for post_dispatch_finalise(ctx) without isinstance filtering.
    from ..thermal import SETPOINT_DEADBAND_C as _AUX_DEADBAND
    aux_controller = AuxiliaryOutputController(
        auxiliary_outputs=config.get("auxiliary_outputs", {}),
        setpoint_deadband_c=_AUX_DEADBAND,
    )
    controllers = [
        SensorController(
            config=config,
            fixed_setpoints=kw.get("fixed_setpoints"),
            trv_offset_tracker=kw.get("trv_offset_tracker"),
            sysid=kw.get("sysid"),
        ),
        # INSTRUCTION-241A — HeatSourceSensorSelector sits immediately after
        # SensorController (which populates ctx.sensor_data, including the
        # heat_sources dict copied from inputs). Selector routes the active
        # source's reading into the canonical flat sensor_data.hp_* slots
        # before any downstream controller reads them. ALL_MODES — must run
        # transparently every cycle. Per parent §D-3 V2 the cascade output
        # holds (bumpless-hold idiom) on heat_source_selector_bad_status.
        HeatSourceSensorSelector(config=config),
        # INSTRUCTION-370 — DegradationController runs after SensorController /
        # HeatSourceSensorSelector and BEFORE the valve/flow/dispatch stage, so
        # ctx.degraded_zones is populated before ValveController consumes it.
        # Detects loss of DIRECT-TRV actuation authority (HA valve entity
        # unreachable), parks the zone open-biased once, and demotes it to a
        # runtime `none` emitter.
        DegradationController(
            config=config,
            room_control_state=kw.get("room_control_state"),
            check_valve_available_fn=kw.get("degradation_check_fn"),
            park_fn=kw.get("degradation_park_fn"),
        ),
        boost,
        ThermalController(
            calculate_thermal_state_fn=kw.get("calculate_thermal_state_fn"),
        ),
        EnergyController(
            config=config,
            providers=kw.get("tariff_providers"),
            fetch_ha_entity_fn=kw.get("fetch_ha_entity_fn"),
            parse_rates_fn=kw.get("parse_rates_fn"),
            current_rate_fn=kw.get("current_rate_fn"),
        ),
        SourceSelectionController(config=config),
        ForecastController(
            config=config,
            forecast_provider=kw.get("forecast_provider"),
        ),
        # INSTRUCTION-136A V7 Task 6: TariffOptimiserController inserted
        # between ForecastController and CycleController. Reads the active
        # electricity TariffProvider directly via DI (parent V3-NEW-A3 lock —
        # single source of truth; same `tariff_providers` registry kwarg
        # EnergyController consumes) and ctx.forecast_state. Must run before
        # any controller that consumes the modified det_flow (i.e. before
        # FlowController). Does NOT read ctx.current_rate or
        # ctx.price_per_input_kwh.
        TariffOptimiserController(
            config=config,
            providers=kw.get("tariff_providers"),
        ),
        CycleController(
            config=config,
            cycle_detector=kw.get("cycle_detector"),
            balancing_detector=kw.get("balancing_detector"),
            get_reliable_cop_fn=kw.get("get_reliable_cop_fn"),
        ),
        valve,
        HydraulicController(),
        AntifrostOverrideController(),
        shoulder,
        summer,
        HWController(
            config=config,
            hw_aware_controller=kw.get("hw_aware_controller"),
        ),
        CascadeController(),
        aux_controller,
        FlowController(
            calculate_deterministic_flow_fn=kw.get("calculate_deterministic_flow_fn"),
            determine_hp_mode_fn=kw.get("determine_hp_mode_fn"),
            get_flow_temp_limits_fn=kw.get("get_flow_temp_limits_fn"),
            shoulder_controller=shoulder,
            summer_controller=summer,
        ),
        RLController(
            model=kw.get("model"),
            optimizer=kw.get("optimizer"),
            checkpoint_path=kw.get("checkpoint_path", find_state_file("rl_model_checkpoint.pt")),
            calculate_rl_reward_fn=kw.get("calculate_rl_reward_fn"),
            update_rl_model_safe_fn=kw.get("update_rl_model_safe_fn"),
            initialize_rl_system_fn=kw.get("initialize_rl_system_fn"),
            background_train_safe_fn=kw.get("background_train_safe_fn"),
            get_flow_temp_limits_fn=kw.get("get_flow_temp_limits_fn"),
        ),
        HardwareController(
            debouncer=kw.get("debouncer"),
            trv_offset_tracker=kw.get("trv_offset_tracker"),
            check_control_urgency_fn=kw.get("check_control_urgency_fn"),
            apply_hardware_control_fn=kw.get("apply_hardware_control_fn"),
            get_flow_temp_limits_fn=kw.get("get_flow_temp_limits_fn"),
        ),
        ShadowController(
            get_flow_temp_limits_fn=kw.get("get_flow_temp_limits_fn"),
            fixed_setpoints=kw.get("fixed_setpoints"),
        ),
        # INSTRUCTION-392 — same tariff_providers registry EnergyController
        # consumes; CostController uses it only to source per-fuel standing
        # charges for the reporting-only total-cost view (never selection).
        CostController(tariff_providers=kw.get("tariff_providers")),
        AllostaticLoadController(
            registry=allostatic_registry,
            config=config,
        ),
        HistorianController(
            room_control_state=kw.get("room_control_state"),
        ),
        # INSTRUCTION-264 V3 — CompositeConfidenceController writes
        # ctx.composite_confidence per cycle for State V1 §6.3. Position
        # contract: AFTER SensorController + RLController + HistorianController,
        # BEFORE SwarmTelemetryController. Always-on regardless of swarm
        # enablement; the conditional SwarmTelemetryController appended below
        # consumes the ctx field via the StatePacket builder.
        CompositeConfidenceController(config=config),
    ]

    # INSTRUCTION-263A V5 Task 7 — SwarmTelemetryController appended AFTER
    # HistorianController when SwarmRuntime is supplied by the orchestrator.
    # No runtime ⇒ no append ⇒ bit-identical pre-263A behaviour.
    swarm_runtime = kw.get("swarm_runtime")
    if swarm_runtime is not None:
        # 274C — SwarmContextEnricher runs FIRST (Client Sketch §3.1), before
        # SensorController touches sysid. Inserted at the head; conditional on
        # the same sentinel that gates the telemetry append. 274D routes the live
        # sysid to both swarm controllers for shadow seed/blend + reconciliation.
        controllers.insert(
            0, SwarmContextEnricher(runtime=swarm_runtime, sysid=kw.get("sysid"))
        )
        controllers.append(
            SwarmTelemetryController(runtime=swarm_runtime, sysid=kw.get("sysid"))
        )
        # INSTRUCTION-321A — apoptosis arbiter runs LAST (after telemetry), reads
        # swarm + sysid state. Disabled-by-default; evaluates + records for the
        # CAPA §7.1 soak. config carries per-room areas for Trigger C.
        controllers.append(
            ApoptosisArbiterController(
                runtime=swarm_runtime, sysid=kw.get("sysid"), config=config
            )
        )

    return controllers, aux_controller
