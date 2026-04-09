"""Thread-safe shared state between pipeline and API server."""

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


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
    det_flow: float = 0.0
    total_demand: float = 0.0
    outdoor_temp: float = 0.0

    # Comfort schedule
    comfort_schedule_active: bool = False
    comfort_temp_active: float = 21.0

    # Recovery & capacity metrics
    recovery_time_hours: float = 0.0
    capacity_pct: float = 0.0
    hp_capacity_kw: float = 0.0
    min_load_pct: float = 0.0

    # HP telemetry (all normalised to kW in SharedState.update())
    hp_power_kw: float = 0.0
    hp_cop: float = 0.0
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
            det_flow=ctx.det_flow,
            total_demand=ctx.smoothed_total_demand if hasattr(ctx, 'smoothed_total_demand') else ctx.smoothed_demand,
            outdoor_temp=ctx.sensor_data.outdoor_temp if ctx.sensor_data else 0.0,
            hp_power_kw=_normalise_power_kw(ctx.inputs.hp_power) if ctx.inputs else 0.0,
            # Only report COP when HP is actually drawing power (>=0.1 kW).
            # Off-period fallback values (3.5 from config default) are meaningless
            # and mislead the frontend display.  Matches historian gate (INSTRUCTION-43).
            hp_cop=(ctx.live_cop if ctx.live_cop else (ctx.inputs.hp_cop if ctx.inputs else 0.0))
                   if (ctx.inputs and ctx.inputs.hp_power >= 0.1) else 0.0,
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
        )

        # ── Recovery time & capacity % ──
        hp_capacity_kw = config.get("hp_capacity_kw", 6.0)

        energy_deficit_kwh = 0.0
        thermal_mass_per_m2 = config.get("thermal_mass_per_m2", 0.025)
        learned_c = {}
        if sysid is not None:
            try:
                learned_c = sysid.get_all_c() or {}
            except Exception:
                pass

        for room_name, area in room_areas.items():
            temp = room_temps.get(room_name)
            target = room_targets.get(room_name, ctx.target_temp if hasattr(ctx, 'target_temp') else 21.0)
            if temp is not None and target is not None:
                deficit = target - temp - 0.5  # SETPOINT_DEADBAND_C
                if deficit > 0:
                    room_c = learned_c.get(room_name, area * thermal_mass_per_m2)
                    energy_deficit_kwh += room_c * min(deficit, 15.0)

        fabric_loss = 0.0
        if ctx.thermal_state:
            fabric_loss = ctx.thermal_state.actual_loss
        net_recovery_kw = max(hp_capacity_kw - fabric_loss, 0.1)
        recovery_time_hours = energy_deficit_kwh / net_recovery_kw

        total_demand = ctx.smoothed_total_demand if hasattr(ctx, 'smoothed_total_demand') else ctx.smoothed_demand
        capacity_pct = (total_demand / hp_capacity_kw * 100) if hp_capacity_kw > 0 else 0.0

        snap.recovery_time_hours = round(recovery_time_hours, 2)
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
