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

from qsh.paths import find_state_file
from .context import CycleContext
from .controller import Controller
from .orchestrator import run_cycle, save_pipeline_state, restore_pipeline_state

from .controllers import (
    BoostController,
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
    FlowController,
    RLController,
    SourceSelectionController,
    HardwareController,
    ShadowController,
    CostController,
    HistorianController,
)

__all__ = [
    "CycleContext",
    "Controller",
    "run_cycle",
    "save_pipeline_state",
    "restore_pipeline_state",
    "build_pipeline",
    "BoostController",
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
    "FlowController",
    "RLController",
    "SourceSelectionController",
    "HardwareController",
    "ShadowController",
    "CostController",
    "HistorianController",
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

    # Energy: rates already in InputBlock.tariff_rates
    if resolved.get("fetch_ha_entity_fn") is None:

        def _noop_fetch(entity_id, attribute="state", default=None):
            return default

        resolved["fetch_ha_entity_fn"] = _noop_fetch

    # Hardware: OutputBlock captures decisions, driver dispatches
    # Signature: apply_hw(config, mode, flow, targets, prev_mode, prev_flow,
    #                     timestamp, debouncer, flow_min, flow_max, urgent,
    #                     action_counter, control_enabled, trv_tracker)
    if resolved.get("apply_hardware_control_fn") is None:

        def _noop_hw(*args, **kw):
            # Return applied_mode — default to the optimal_mode (arg[1])
            return args[1] if len(args) > 1 else "heat"

        resolved["apply_hardware_control_fn"] = _noop_hw

    # COP: already in InputBlock.hp_cop
    # Signature: get_cop(config, cop_history)
    if resolved.get("get_reliable_cop_fn") is None:

        def _noop_cop(*args, **kw):
            return 3.5

        resolved["get_reliable_cop_fn"] = _noop_cop

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


def build_pipeline(config, **kwargs):
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
        List of Controller instances in execution order.
    """
    driver_type = config.get("driver", "ha")
    if driver_type == "mock":
        kw = _resolve_noop_defaults(kwargs, __import__("logging").getLogger(__name__), "mock")
    else:
        kw = _resolve_driver_defaults(kwargs, driver_type)

    valve = ValveController(
        room_control_state=kw.get("room_control_state"),
        apply_dissipation_fn=kw.get("apply_dissipation_fn"),
        apply_hybrid_fn=kw.get("apply_hybrid_fn"),
        calc_flow_adjust_fn=kw.get("calc_flow_adjust_fn"),
    )
    shoulder = ShoulderController(
        room_control_state=valve.room_control_state,
    )
    summer = SummerController(shoulder_controller=shoulder)
    boost = BoostController()
    controllers = [
        SensorController(
            config=config,
            zone_offsets=kw.get("zone_offsets"),
            trv_offset_tracker=kw.get("trv_offset_tracker"),
            sysid=kw.get("sysid"),
        ),
        boost,
        ThermalController(
            calculate_thermal_state_fn=kw.get("calculate_thermal_state_fn"),
        ),
        EnergyController(
            fetch_ha_entity_fn=kw.get("fetch_ha_entity_fn"),
            parse_rates_array_fn=kw.get("parse_rates_array_fn"),
            get_current_rate_fn=kw.get("get_current_rate_fn"),
        ),
        SourceSelectionController(config=config),
        ForecastController(
            config=config,
            weather_forecaster=kw.get("weather_forecaster"),
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
            zone_offsets=kw.get("zone_offsets"),
        ),
        CostController(),
        HistorianController(
            room_control_state=kw.get("room_control_state"),
        ),
    ]
    return controllers
