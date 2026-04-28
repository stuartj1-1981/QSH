"""Thread-safe shared state between pipeline and API server."""

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import qsh.config  # noqa: F401 — module import (NOT `from qsh.config import CONFIG_IS_TEMPLATE`).
                    # The bound-at-import form would capture the value at this module's
                    # import time and miss any later placeholder-reroute write in
                    # qsh.config (INSTRUCTION-134 Task 1b). The live-attribute-read
                    # pattern in is_setup_mode() reads the current value per request.

from ..drivers.ha.hardware_dispatch import READBACK_MISMATCH_ALARM_THRESHOLD


@dataclass
class ControlSource:
    """Describes the source of a resolved control value for the frontend."""

    key: str              # e.g. "flow_min", "dfan_control", "away_mode"
    value: Any            # Current resolved value
    source: str           # "external" | "internal"
    external_id: str      # Entity ID or MQTT topic (empty string if internal)
    external_raw: str     # Raw state string (empty string if internal or unavailable)


@dataclass
class CycleSnapshot:
    """Immutable snapshot of one completed pipeline cycle."""

    timestamp: float = 0.0
    cycle_number: int = 0

    # System status
    operating_state: str = "Starting"
    control_enabled: bool = False
    comfort_temp: float = 20.0
    optimal_flow: float = 0.0
    applied_flow: float = 0.0
    optimal_mode: str = "off"
    applied_mode: str = "off"
    readback_mismatch_count: int = 0                                            # consecutive cycles where observed_mode != optimal_mode
    readback_mismatch_threshold: int = READBACK_MISMATCH_ALARM_THRESHOLD        # single source of truth: hardware_dispatch.READBACK_MISMATCH_ALARM_THRESHOLD
    last_readback_mismatch_alarm_time: float = 0.0                              # Unix epoch seconds (wall-clock) of the cycle the alarm first fired
    det_flow: float = 0.0
    total_demand: float = 0.0
    outdoor_temp: float = 0.0

    # Comfort schedule
    comfort_schedule_active: bool = False
    comfort_temp_active: float = 21.0

    # Recovery & capacity metrics
    recovery_time_hours: float = 0.0
    per_room_ttc: Dict[str, float] = field(default_factory=dict)
    capacity_pct: float = 0.0
    hp_capacity_kw: float = 0.0
    min_load_pct: float = 0.0

    # HP telemetry (all normalised to kW in SharedState.update())
    hp_power_kw: float = 0.0
    # INSTRUCTION-120B: `hp_cop` is None whenever the HP is off OR performance
    # is in sensor-loss fallback. The gate lives in `_resolve_snapshot_hp_cop`
    # — render sites must treat None as '—' and never second-guess positive
    # values. JSON serialises None as null.
    hp_cop: Optional[float] = None
    hp_flow_temp: float = 0.0
    hp_return_temp: float = 0.0
    delta_t: float = 0.0
    flow_rate: float = 0.0

    # Per-room state
    rooms: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    # Each room: {temp, target, valve, occupancy, status, facing, area_m2}

    # Energy
    current_rate: float = 0.0
    export_rate: float = 0.0
    cost_today_pence: float = 0.0
    cost_yesterday_pence: float = 0.0
    energy_today_kwh: float = 0.0
    predicted_saving: float = 0.0
    predicted_energy_saving: float = 0.0

    # Engineering (optional — only populated if requested)
    rl_blend: float = 0.0
    rl_flow: Optional[float] = None
    rl_reward: float = 0.0
    rl_loss: float = 0.0
    shoulder_monitoring: bool = False
    summer_monitoring: bool = False
    cascade_active: bool = False
    frost_cap_active: bool = False

    # Winter mode (antifrost override)
    antifrost_override_active: bool = False
    winter_equilibrium: bool = False    # True when in equilibrium sub-mode
    antifrost_threshold: float = 7.0    # Current OAT threshold for winter mode

    # Boost
    boost_active: bool = False
    boost_rooms: Dict[str, Dict] = field(default_factory=dict)

    # Signal quality
    signal_quality: Dict[str, str] = field(default_factory=dict)

    # Source selection (multi-source installs only)
    source_selection: Optional[Dict] = None

    # Away state
    away_mode_active: bool = False
    away_days: float = 0.0
    per_zone_away: Dict[str, float] = field(default_factory=dict)
    recovery_active: bool = False
    zones_recovering: List[str] = field(default_factory=list)

    # Control sources (external value visibility — 36C Task 4)
    control_sources: List[Any] = field(default_factory=list)

    # Source foundation (INSTRUCTION-117A — pass-through from CycleContext).
    # 117A's snapshot shape is pass-through only; /api/status response shape
    # is unchanged (reshape deferred to 117E).
    active_source_type: str = "heat_pump"
    source_caps: Optional[Any] = None
    active_source_input_power_kw: float = 0.0
    active_source_thermal_output_kw: Optional[float] = None
    active_source_thermal_output_source: str = "unknown"
    active_source_performance: Optional[Any] = None
    peak_thermal_demand_kw: float = 0.0


def _resolve_operating_state(ctx) -> str:
    """Extract operating_state with clear priority and fallback.

    Priority:
      1. ctx.operating_state (set by ShadowController — canonical source)
      2. ctx.outputs.operating_state (HA dispatch copy)
      3. "Initialising" (pipeline hasn't run ShadowController yet)
    """
    # Primary: CycleContext attribute (set by ShadowController)
    state = getattr(ctx, 'operating_state', None)
    if state:  # truthy — non-None, non-empty
        return state

    # Secondary: OutputBlock (populated during write_outputs prep)
    if ctx.outputs is not None:
        state = getattr(ctx.outputs, 'operating_state', None)
        if state:
            return state

    return "Initialising"


def _normalise_power_kw(raw: float) -> float:
    """Normalise HP power to kW. Some HA integrations report Watts, others kW.

    Heuristic: no domestic HP draws > 100 kW, so values > 100 are Watts.
    """
    if raw > 100:
        return round(raw / 1000, 3)
    return round(raw, 3)


def build_heat_source_payload(snap: "CycleSnapshot") -> Dict[str, Any]:
    """Build the source-aware `heat_source` payload from a CycleSnapshot.

    INSTRUCTION-117E Task 1a: flat shape across all source types, with
    `performance: {value, source}` carrying provenance. No per-source-type
    branching — the resolver has already unified the representation.
    """
    perf = snap.active_source_performance
    perf_value = float(perf.value) if perf is not None else 0.0
    perf_source = perf.source if perf is not None else "config"
    return {
        "type": snap.active_source_type,
        "input_power_kw": round(snap.active_source_input_power_kw, 3),
        "thermal_output_kw": (
            round(snap.active_source_thermal_output_kw, 3)
            if snap.active_source_thermal_output_kw is not None
            else None
        ),
        "thermal_output_source": snap.active_source_thermal_output_source,
        "performance": {
            "value": round(perf_value, 3),
            "source": perf_source,
        },
        "flow_temp": round(snap.hp_flow_temp, 1),
        "return_temp": round(snap.hp_return_temp, 1),
        "delta_t": round(snap.delta_t, 1),
        "flow_rate": round(snap.flow_rate, 2),
    }


def build_hp_shim(snap: "CycleSnapshot") -> Optional[Dict[str, Any]]:
    """Build the legacy `hp` shim payload or return None on non-HP installs.

    INSTRUCTION-117E Task 1b: populated only when the active source is a
    heat pump. Never assigns an η value to `cop` — the `type` check is the
    guard, not `performance.source`. INSTRUCTION-120B: `cop` is null-
    preserving against `snap.hp_cop` — when the data-layer gate
    `_resolve_snapshot_hp_cop` has suppressed the value (HP off or in
    sensor-loss fallback), `cop` is JSON null rather than the fallback
    baseline (2.5 for HP).
    """
    if snap.active_source_type != "heat_pump":
        return None
    return {
        "power_kw": round(snap.active_source_input_power_kw, 3),
        "cop": None if snap.hp_cop is None else round(snap.hp_cop, 1),
        "flow_temp": round(snap.hp_flow_temp, 1),
        "return_temp": round(snap.hp_return_temp, 1),
        "delta_t": round(snap.delta_t, 1),
        "flow_rate": round(snap.flow_rate, 2),
    }


def _resolve_snapshot_hp_cop(ctx) -> Optional[float]:
    """Emit COP for display only when it is live-sourced and meaningful.

    INSTRUCTION-120B: single source of truth for `snap.hp_cop`. Returns
    None (→ JSON null, → frontend '—') when:
    - ctx.inputs is unavailable, OR
    - HP is off (hp_power < caps.off_power_threshold_kw), OR
    - The active source is a heat pump and performance is in fallback
      (performance.source == "config" — sensor-loss fallback per 117A M8).

    Returns the numeric COP value only when all three guards pass. Render
    sites MUST treat None as '—' and never second-guess positive values.
    Boilers are not gated on `performance.source` — η is always
    config-sourced per the resolver contract, so the HP-only gate avoids
    nulling out the (unrendered) boiler value as a side-effect.
    """
    if ctx.inputs is None:
        return None
    caps = ctx.source_caps
    if ctx.inputs.hp_power < caps.off_power_threshold_kw:
        return None
    perf = ctx.active_source_performance
    if caps.source_type == "heat_pump" and perf.source == "config":
        return None
    return ctx.live_cop if ctx.live_cop else ctx.inputs.hp_cop


class SharedState:
    """Thread-safe container for the latest cycle snapshot.

    Pipeline thread calls update() after each run_cycle().
    API thread calls get_snapshot() to read.
    WebSocket broadcaster calls get_snapshot() + checks cycle_number for changes.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._snapshot = CycleSnapshot()
        self._sysid_ref = None      # Reference to SystemIdentifier (read-only)
        self._config_ref = None     # Reference to HOUSE_CONFIG dict (read-only)
        self._balancing_ref = None  # Reference to BalancingDetector (set after API start)
        self._boost_controller = None  # Reference to BoostController (set after pipeline build)
        self._mqtt_client = None       # Reference to MQTTClient (set for MQTT driver, for API write-back)
        self._migration_pending: bool = False
        self._driver_status: str = "pending"        # "pending" | "connected" | "error"
        self._driver_error: Optional[str] = None    # Human-readable error message

    def update(self, ctx, config: dict, sysid=None):
        """Called by pipeline thread after each run_cycle().

        Extract all needed values from CycleContext HERE, not in the API thread.
        This avoids the API thread touching mutable pipeline objects.

        Args:
            ctx: CycleContext from the just-completed cycle
            config: HOUSE_CONFIG dict
            sysid: SystemIdentifier instance (optional, for sysid endpoints)
        """
        rooms = {}
        if ctx.sensor_data:
            room_temps = getattr(ctx.sensor_data, 'room_temps', {})
            valve_positions = getattr(ctx.sensor_data, 'heating_percs', {})
        else:
            room_temps = {}
            valve_positions = {}

        room_targets = getattr(ctx, 'room_targets', {})
        occupancy_states = getattr(ctx, 'occupancy_states', {})
        occupancy_source = getattr(ctx, 'occupancy_source', {})

        # HOUSE_CONFIG["rooms"] is {room_name: area_m2} (flat floats)
        # Facings, ceiling heights etc. are in separate top-level dicts
        room_areas = config.get('rooms', {})
        facings_map = config.get('facings', {})
        ceiling_map = config.get('ceiling_heights', {})

        for room_name in room_areas:
            temp = room_temps.get(room_name)
            target = room_targets.get(room_name, ctx.target_temp if hasattr(ctx, 'target_temp') else 21.0)
            valve = valve_positions.get(room_name, 0)
            occ = occupancy_states.get(room_name, 'occupied')

            # Derive simple status
            # NOTE: The 'heating' token here means "mid-deficit". The frontend gates
            # its display on `applied_mode === 'heat'` (RoomCard/RoomDetail) and
            # `state.strategy === 'heating'` (Live view). New consumers of room.status
            # must apply the same gate or they will mislabel idle states. See
            # INSTRUCTION-141.
            if occ == 'away':
                status = 'away'
            elif temp is not None and target is not None:
                diff = target - temp
                if diff <= 0.2:
                    status = 'ok'
                elif diff > 1.5:
                    status = 'cold'
                else:
                    status = 'heating'
            else:
                status = 'unknown'

            rooms[room_name] = {
                'temp': temp,
                'target': target,
                'valve': valve,
                'occupancy': occ,
                'occupancy_source': occupancy_source.get(room_name, 'schedule'),
                'status': status,
                'facing': facings_map.get(room_name, 0.2),
                'area_m2': room_areas.get(room_name, 0),
                'ceiling_m': ceiling_map.get(room_name, 2.4),
            }

        # Read shadow entities for cost/energy if available
        shadow = {}
        if ctx.outputs:
            shadow = getattr(ctx.outputs, 'shadow_entities', {}) or {}

        snap = CycleSnapshot(
            timestamp=ctx.timestamp,
            cycle_number=ctx.cycle_number,
            operating_state=_resolve_operating_state(ctx),
            control_enabled=ctx.control_enabled,
            comfort_temp=ctx.target_temp if hasattr(ctx, 'target_temp') else 20.0,
            optimal_flow=ctx.optimal_flow,
            applied_flow=ctx.applied_flow,
            optimal_mode=ctx.optimal_mode,
            applied_mode=ctx.applied_mode,
            readback_mismatch_count=getattr(ctx, "readback_mismatch_count", 0),
            readback_mismatch_threshold=getattr(ctx, "readback_mismatch_threshold", READBACK_MISMATCH_ALARM_THRESHOLD),
            last_readback_mismatch_alarm_time=getattr(ctx, "last_readback_mismatch_alarm_time", 0.0),
            det_flow=ctx.det_flow,
            total_demand=ctx.smoothed_total_demand if hasattr(ctx, 'smoothed_total_demand') else ctx.smoothed_demand,
            outdoor_temp=ctx.sensor_data.outdoor_temp if ctx.sensor_data else 0.0,
            hp_power_kw=_normalise_power_kw(ctx.inputs.hp_power) if ctx.inputs else 0.0,
            # INSTRUCTION-120B: data-layer gate. None (→ JSON null) when HP is
            # off, inputs missing, or performance is in sensor-loss fallback.
            # Single source of truth for all downstream consumers.
            hp_cop=_resolve_snapshot_hp_cop(ctx),
            hp_flow_temp=ctx.inputs.hp_flow_temp if ctx.inputs else 0.0,
            hp_return_temp=ctx.inputs.hp_return_temp if ctx.inputs else 0.0,
            delta_t=ctx.inputs.delta_t if ctx.inputs else 0.0,
            flow_rate=ctx.inputs.flow_rate if ctx.inputs else 0.0,
            rooms=rooms,
            current_rate=ctx.current_rate if hasattr(ctx, 'current_rate') else 0.0,
            export_rate=ctx.inputs.export_rate if ctx.inputs else 0.0,
            cost_today_pence=shadow.get('input_number.qsh_hp_cost_today_p', 0.0),
            cost_yesterday_pence=shadow.get('input_number.qsh_hp_cost_yesterday', 0.0),
            energy_today_kwh=shadow.get('input_number.qsh_hp_energy_today', 0.0),
            predicted_saving=shadow.get('input_number.qsh_predicted_saving', 0.0),
            predicted_energy_saving=shadow.get('input_number.qsh_predicted_energy_saving', 0.0),
            rl_blend=ctx.current_blend,
            rl_flow=ctx.rl_flow,
            rl_reward=ctx.reward,
            rl_loss=ctx.loss_value,
            shoulder_monitoring=ctx.shoulder_monitoring,
            summer_monitoring=ctx.summer_monitoring,
            cascade_active=ctx.cascade_active if hasattr(ctx, 'cascade_active') else False,
            frost_cap_active=ctx.frost_cap_active if hasattr(ctx, 'frost_cap_active') else False,
            antifrost_override_active=getattr(ctx, 'antifrost_override_active', False),
            winter_equilibrium=(
                getattr(ctx, 'antifrost_override_active', False)
                and ctx.smoothed_demand < 0.5
                and ctx.applied_mode == "heat"
            ),
            antifrost_threshold=config.get("antifrost", {}).get("oat_threshold", 7.0),
            boost_active=getattr(ctx, 'boost_active', False),
            boost_rooms=getattr(ctx, 'boost_rooms', {}),
            signal_quality=ctx.inputs.signal_quality if ctx.inputs else {},
            away_mode_active=ctx.inputs.away_mode_active if ctx.inputs else False,
            away_days=ctx.inputs.away_days if ctx.inputs else 0.0,
            comfort_schedule_active=getattr(ctx, 'comfort_schedule_active', False),
            comfort_temp_active=getattr(ctx, 'comfort_temp_active', ctx.target_temp if hasattr(ctx, 'target_temp') else 21.0),
            active_source_type=getattr(ctx, 'active_source_type', 'heat_pump'),
            source_caps=getattr(ctx, 'source_caps', None),
            active_source_input_power_kw=getattr(ctx, 'active_source_input_power_kw', 0.0),
            active_source_thermal_output_kw=getattr(ctx, 'active_source_thermal_output_kw', None),
            active_source_thermal_output_source=getattr(ctx, 'active_source_thermal_output_source', 'unknown'),
            active_source_performance=getattr(ctx, 'active_source_performance', None),
            peak_thermal_demand_kw=getattr(ctx, 'peak_thermal_demand_kw', 0.0),
        )

        # ── Recovery time & capacity % (Newton's law per-room solver) ──
        hp_capacity_kw = config.get("hp_capacity_kw", 6.0)
        thermal_mass_per_m2 = config.get("thermal_mass_per_m2", 0.025)

        learned_c = {}
        if sysid is not None:
            try:
                learned_c = sysid.get_all_c() or {}
            except Exception:
                pass

        learned_u = {}
        if sysid is not None:
            try:
                learned_u = sysid.get_all_u() or {}
            except Exception:
                pass

        outdoor_temp = ctx.sensor_data.outdoor_temp if ctx.sensor_data else 5.0
        room_losses = ctx.thermal_state.room_losses if ctx.thermal_state else {}

        # Measured HP thermal output — ground truth
        hp_thermal_kw = 0.0
        if ctx.sensor_data:
            hp_thermal_kw = ctx.sensor_data.hp_output
            if hp_thermal_kw <= 0 and ctx.sensor_data.hp_power > 0:
                hp_thermal_kw = ctx.sensor_data.hp_power * ctx.sensor_data.hp_cop

        from .ttc import calculate_per_room_ttc

        actual_loss = ctx.thermal_state.actual_loss if ctx.thermal_state else 0.0
        room_demands = ctx.thermal_state.room_demands if ctx.thermal_state else {}
        total_active_demand = ctx.thermal_state.active_demand if ctx.thermal_state else 0.0
        aggregate_heat_up = ctx.thermal_state.aggregate_heat_up if ctx.thermal_state else 0.0

        system_ttc, per_room_ttc = calculate_per_room_ttc(
            room_temps=room_temps,
            room_targets=room_targets,
            room_areas=room_areas,
            outdoor_temp=outdoor_temp,
            hp_thermal_kw=hp_thermal_kw,
            valve_positions=valve_positions,
            learned_u=learned_u,
            learned_c=learned_c,
            room_losses=room_losses,
            config=config,
            thermal_mass_per_m2=thermal_mass_per_m2,
            actual_loss=actual_loss,
            room_demands=room_demands,
            total_active_demand=total_active_demand,
            aggregate_heat_up=aggregate_heat_up,
        )

        snap.recovery_time_hours = round(system_ttc, 2)
        snap.per_room_ttc = per_room_ttc

        total_demand = ctx.smoothed_total_demand if hasattr(ctx, 'smoothed_total_demand') else ctx.smoothed_demand
        capacity_pct = (total_demand / hp_capacity_kw * 100) if hp_capacity_kw > 0 else 0.0

        snap.capacity_pct = round(capacity_pct, 1)
        snap.hp_capacity_kw = hp_capacity_kw

        hp_min_output_kw = config.get("hp_min_output_kw", 2.0)
        snap.min_load_pct = round((hp_min_output_kw / hp_capacity_kw * 100) if hp_capacity_kw > 0 else 0.0, 1)

        # Away state from pipeline
        away_state = getattr(ctx, 'away_state', None)
        if away_state is not None:
            snap.recovery_active = getattr(away_state, 'recovery_active', False)
            snap.zones_recovering = list(getattr(away_state, 'zones_recovering', []))
            snap.per_zone_away = dict(getattr(away_state, 'per_zone_away', {}))

        # Source selection (multi-source installs only)
        if len(config.get("heat_sources", [])) > 1:
            source_scores = getattr(ctx, 'source_scores', {})
            heat_sources = config.get("heat_sources", [])
            active_name = getattr(ctx, 'active_source', '')
            source_states = ctx.inputs.source_states if ctx.inputs else {}

            sources_list = []
            for src in heat_sources:
                name = src.get("name", "")
                score = source_scores.get(name, 0.0)
                eff = src.get("efficiency", 1.0)
                fuel_cost = src.get("fuel_cost_per_kwh", 0.0)
                carbon = src.get("carbon_factor", 0.0)

                # Determine status
                if name == active_name:
                    status = "active"
                else:
                    sq = source_states.get(name, {}).get("signal_quality", "good")
                    status = "offline" if sq == "unavailable" else "standby"

                cost_thermal = (fuel_cost / eff) if eff > 0 else 0.0
                carbon_thermal = (carbon / eff) if eff > 0 else 0.0

                sources_list.append({
                    "name": name,
                    "type": src.get("type", ""),
                    "status": status,
                    "efficiency": round(eff, 2),
                    "fuel_cost_per_kwh": round(fuel_cost, 4),
                    "cost_per_kwh_thermal": round(cost_thermal, 4),
                    "carbon_per_kwh_thermal": round(carbon_thermal, 4),
                    "score": round(score, 5),
                    "signal_quality": source_states.get(name, {}).get("signal_quality", "good"),
                })

            sel_config = config.get("source_selection", {})
            snap.source_selection = {
                "active_source": active_name,
                "mode": sel_config.get("mode", "auto"),
                "preference": sel_config.get("preference", 0.7),
                "sources": sources_list,
                "switch_count_today": getattr(ctx, 'source_switch_count_today', 0),
                "max_switches_per_day": sel_config.get("max_switches_per_day", 6),
                "failover_active": getattr(ctx, 'source_failover_active', False),
                "last_switch_reason": getattr(ctx, 'source_switch_reason', 'auto'),
            }

        with self._lock:
            self._snapshot = snap
            if sysid is not None:
                self._sysid_ref = sysid
            if config is not None:
                self._config_ref = config

        # Append to history ring buffer (outside lock — history has its own)
        from .history import cycle_history, snapshot_to_history_entry
        cycle_history.append(snapshot_to_history_entry(snap))

    def get_snapshot(self) -> CycleSnapshot:
        with self._lock:
            return self._snapshot

    def get_sysid(self):
        with self._lock:
            return self._sysid_ref

    def get_config(self):
        with self._lock:
            return self._config_ref

    def is_ha_driver(self) -> bool:
        """True when the active driver is Home Assistant (default)."""
        with self._lock:
            if self._config_ref is None:
                return True  # Default assumption before config is loaded
            return self._config_ref.get("driver", "ha") == "ha"

    def get_balancing(self):
        with self._lock:
            return self._balancing_ref

    def set_balancing(self, detector):
        with self._lock:
            self._balancing_ref = detector

    def get_boost_controller(self):
        with self._lock:
            return self._boost_controller

    def set_boost_controller(self, controller):
        with self._lock:
            self._boost_controller = controller

    def get_mqtt_client(self):
        with self._lock:
            return self._mqtt_client

    def set_mqtt_client(self, client):
        with self._lock:
            self._mqtt_client = client

    def set_migration_pending(self, value: bool) -> None:
        with self._lock:
            self._migration_pending = value

    def get_migration_pending(self) -> bool:
        with self._lock:
            return self._migration_pending

    def set_driver_status(self, status: str, error: Optional[str] = None) -> None:
        with self._lock:
            self._driver_status = status
            self._driver_error = error

    def get_driver_status(self) -> Dict[str, Any]:
        with self._lock:
            return {"status": self._driver_status, "error": self._driver_error}

    def is_setup_mode(self) -> bool:
        """Live read of qsh.config.CONFIG_IS_TEMPLATE for the /api/status setup_mode field.

        Called per-request from the response-assembly site in routes/status.py.
        The dotted-attribute access reads the current value of the module
        attribute every call, so the placeholder-reroute write that happens
        inside qsh.config's load sequence (INSTRUCTION-134) is observed
        regardless of import order.
        """
        return qsh.config.CONFIG_IS_TEMPLATE

    def set_for_testing(self, snapshot: CycleSnapshot, config: dict = None, sysid=None):
        """Inject state directly for unit tests. Not for production use."""
        with self._lock:
            self._snapshot = snapshot
            if config is not None:
                self._config_ref = config
            if sysid is not None:
                self._sysid_ref = sysid


# Module-level singleton — imported by both main.py and API routes
shared_state = SharedState()
