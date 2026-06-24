"""Thread-safe shared state between pipeline and API server."""

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import qsh.config  # noqa: F401 — module import (NOT `from qsh.config import CONFIG_IS_TEMPLATE`).
                    # The bound-at-import form would capture the value at this module's
                    # import time and miss any later placeholder-reroute write in
                    # qsh.config (INSTRUCTION-134 Task 1b). The live-attribute-read
                    # pattern in is_setup_mode() reads the current value per request.

from ..drivers.ha.hardware_dispatch import READBACK_MISMATCH_ALARM_THRESHOLD
from qsh.tariff import (
    Fuel,
    ProviderKind,
    ProviderStatus,
    SUPPORTED_PROVIDER_KINDS,
)


# INSTRUCTION-257 — threshold for "this room's effective target meaningfully
# diverges from the commanded comfort temperature." 0.3°C sits comfortably
# below the human visual perception threshold for indoor temperature (~0.5°C)
# and above the noise floor of a typical room sensor (±0.1°C). Single source
# of truth for the Home page divergence sub-line; the frontend reads the
# pre-computed rooms_overridden_count field rather than re-applying this
# threshold.
COMFORT_DIVERGENCE_THRESHOLD_C: float = 0.3


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
    # INSTRUCTION-257 — mean of post-override per-room targets. Diverges from
    # comfort_temp_active when per-room overrides (MQTT, persistent zones,
    # away mode, setback, recovery) modify individual room targets away from
    # the commanded comfort. Drives the Home page divergence gate.
    comfort_temp_effective: float = 21.0
    # INSTRUCTION-257 — count of rooms whose effective target diverges from
    # comfort_temp_active by at least COMFORT_DIVERGENCE_THRESHOLD_C. Drives
    # the Home page sub-line "Effective X.X°C — N of M rooms overridden."
    # Backend-computed so the frontend does not need to recompute from
    # status.rooms (which is absent on legacy snapshots).
    rooms_overridden_count: int = 0
    # INSTRUCTION-267 — True when sensor_controller.py:174 fallback fired this
    # cycle (no inputs.target_temp from driver). Parallel mirror of the LATCHED
    # SENSOR.target_temp_missing event; kept as a direct ctx field for pattern
    # consistency with the sibling comfort-schedule snapshot fields above.
    target_temp_fallback_active: bool = False
    # INSTRUCTION-268 — set True by the MQTT driver when the LATCHED
    # COMFORT.writeback_unverified event is entered (writeback deadline expired
    # without a broker-sourced match). Field name reads naturally as "not yet
    # verified" but the field is set True only on terminal hard-failure
    # transition (V1 LOW-2 disposition: rename rejected on cost-vs-benefit).
    comfort_temp_writeback_unverified: bool = False

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

    # INSTRUCTION-224D — per-emitter valve positions for multi-emitter zones.
    # Outer key: room. Inner key: emitter stem (matches the 222A-derived
    # trv_name[i] for HA, or _mqtt_emitter_stem(topic) for MQTT). Value:
    # per-emitter valve position 0-100. Single-emitter rooms have a one-entry
    # inner dict; multi-emitter rooms have N entries. Empty for rooms without
    # per-emitter data. The room aggregate continues to live in rooms[room].valve.
    valve_positions_per_emitter: Dict[str, Dict[str, float]] = field(default_factory=dict)

    # Energy
    current_rate: float = 0.0
    export_rate: float = 0.0
    cost_today_pence: float = 0.0
    cost_yesterday_pence: float = 0.0
    energy_today_kwh: float = 0.0
    predicted_saving: float = 0.0
    predicted_energy_saving: float = 0.0

    # INSTRUCTION-191B: mode-resolved SCOP and underlying counters.
    # Today-rolling values from CostController.get_daily_summary().
    # None when bucket electrical input is zero.
    daily_cop_combined: Optional[float] = None
    daily_cop_ch: Optional[float] = None
    daily_cop_hw: Optional[float] = None
    energy_today_kwh_ch: float = 0.0
    energy_today_kwh_hw: float = 0.0
    thermal_kwh_today_ch: float = 0.0
    thermal_kwh_today_hw: float = 0.0

    # Engineering (optional — only populated if requested)
    rl_blend: float = 0.0
    rl_flow: Optional[float] = None
    rl_reward: float = 0.0
    rl_loss: float = 0.0
    shoulder_monitoring: bool = False
    summer_monitoring: bool = False
    # INSTRUCTION-364 — live active-cooling flag (363's observed_mode == "cool").
    # Sourced from ctx.inputs.cooling_active; drives the Home cooling banner.
    cooling_active: bool = False
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
    # INSTRUCTION-246 Task 4 Step 4d — provenance for input_power_kw.
    # "live" (sensor reading) | "legacy" (pre-117A boiler-on-HP-slot) |
    # "nameplate" (caps.rated_kw fallback) | "unknown" (128A future-strengthening
    # sentinel — no information at all).
    active_source_input_power_source: str = "unknown"
    # INSTRUCTION-340 — name of the source selected for recording this cycle.
    active_source_name: str = ""

    # Tariff providers (INSTRUCTION-150C V5 E-M1).
    # tariff_providers_status: per-fuel snapshot of provider state (read off
    #   pipeline.tariff_providers — populated in SharedState.update()).
    # available_provider_kinds: backend capability flag the frontend gates
    #   radio options on. Mirrors qsh.tariff.SUPPORTED_PROVIDER_KINDS.
    tariff_providers_status: Dict[Fuel, ProviderStatus] = field(default_factory=dict)
    available_provider_kinds: Tuple[ProviderKind, ...] = SUPPORTED_PROVIDER_KINDS

    # INSTRUCTION-193 Task 4: server-side revocation flag.
    # True when the fleet collector has revoked this install (403 with
    # body {"revoked": true}); telemetry pushes are suppressed locally.
    # Cleared on successful re-registration. Surfaced via /api/status so
    # the UI can render a banner; Zod schema parses via .passthrough()
    # (frontend/src/types/schemas.ts:54-62) — no schema update required.
    telemetry_revoked: bool = False

    # ====================================================================
    # INSTRUCTION-208A V2 — DFAN forecast extension.
    # All fields default to "no data" (empty dicts / lists) so the
    # snapshot is JSON-serialisable from the very first cycle before
    # forecast_extension_master_enable flips on.
    # ====================================================================
    forecast_state_snapshot: Dict[str, Any] = field(default_factory=dict)
    passive_recovery: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    forecast_predicted_decisions: Dict[str, Dict[str, Dict[str, Any]]] = field(
        default_factory=dict
    )
    twin_calibration_drift: Dict[str, bool] = field(default_factory=dict)
    active_alarms: List[Dict[str, Any]] = field(default_factory=list)

    # INSTRUCTION-261 Task 8 — allostatic-load surface (Bucket 8.1).
    # Forwarded as-is from ctx.allostatic_load_snapshot. Design A applies the
    # "__system__" sentinel inside AllostaticLoadRegistry.snapshot(); the
    # str-keyed shape is JSON-safe and is the StatePacket-extras carrier per
    # Quantum-Swarm-Packet-Spec-V1-State.md §6.3 (no spec amendment required).
    # Shape: {controller_name: {room_id_or_system_sentinel: {load_24h,
    # load_7d, load_28d, accumulated_cycles, saturation_active}}}.
    # Empty dict before AllostaticLoadController has run.
    allostatic_load: Dict[str, Dict[str, Dict[str, Any]]] = field(default_factory=dict)

    # INSTRUCTION-225C — operator MANUAL/AUTO override map for direct-TRV rooms.
    # Outer key: room. Inner: {mode, position_pct, set_by, set_at, hardware_type}.
    # Populated from qsh.manual_state for every room in configured_direct_rooms.
    # AUTO rooms appear with the sentinel; rooms with non-direct hardware are
    # omitted. Plain dict so the existing WS JSON encoder serialises it without
    # touching ManualEntry's frozen dataclass.
    manual_state: Dict[str, Dict[str, Any]] = field(default_factory=dict)


def _resolve_operating_state(ctx) -> str:
    """Extract operating_state with clear priority and fallback.

    Priority:
      1. ctx.operating_state (set by ShadowController — canonical source)
      2. ctx.outputs.operating_state (HA dispatch copy)
      3. "Initialising" (pipeline hasn't run ShadowController yet)
    """
    # Primary: CycleContext attribute (set by ShadowController)
    state = ctx.operating_state
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


def _safe_pos(value: Any) -> Optional[float]:
    """Return ``float(value)`` if it parses to a finite number > 0, else ``None``.

    INSTRUCTION-278 gate for the capacity / min-output figures: an active-source
    or config value is only trusted when it is a strictly-positive finite
    number. ``None``, zero, negative, NaN and inf all fall through to the next
    source in the resolution chain.
    """
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):  # NaN / inf guard
        return None
    return f if f > 0 else None


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
        # INSTRUCTION-340 — additive: name of the selected source.
        "name": snap.active_source_name,
        "input_power_kw": round(snap.active_source_input_power_kw, 3),
        "thermal_output_kw": (
            round(snap.active_source_thermal_output_kw, 3)
            if snap.active_source_thermal_output_kw is not None
            else None
        ),
        "thermal_output_source": snap.active_source_thermal_output_source,
        # INSTRUCTION-246 Task 4 Step 4d — provenance discriminator for
        # input_power_kw. Pydantic HeatSourceState in routes/status.py
        # declares it as a REQUIRED Literal of the four values.
        "input_power_source": snap.active_source_input_power_source,
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


def _collect_tariff_providers_status() -> Dict[Fuel, ProviderStatus]:
    """V5 C-5 / 150C: read pipeline.tariff_providers (set by main.py at
    startup) and return a fuel->ProviderStatus dict. status() is cheap and
    does not hit upstream, so it is safe to call every cycle.

    Returns an empty dict when the pipeline module has not yet attached
    tariff_providers (e.g. unit tests that bypass main.py)."""
    try:
        from qsh import pipeline as _pipeline_module
    except Exception:
        return {}
    providers = getattr(_pipeline_module, "tariff_providers", None)
    if not providers:
        return {}
    out: Dict[Fuel, ProviderStatus] = {}
    for fuel, provider in providers.items():
        try:
            out[fuel] = provider.status()
        except Exception:
            # Defensive: a provider raising in status() must not poison the
            # snapshot. Skip and let the rest of the cycle proceed.
            continue
    return out


def serialise_tariff_providers_status(
    statuses: Dict[Fuel, ProviderStatus],
) -> Dict[str, Dict[str, Any]]:
    """V2 C-L2: convert the dataclass-valued dict into a JSON-friendly shape
    for /api/status and /ws/live. Each ProviderStatus is flattened to a plain
    dict so FastAPI's JSON encoder (which doesn't natively serialise frozen
    dataclasses) emits the documented field shape."""
    from dataclasses import asdict
    return {fuel: asdict(status) for fuel, status in statuses.items()}


def _comfort_effective_fields(ctx) -> Dict[str, Any]:
    """Return the two INSTRUCTION-257 snapshot fields as a dict.

    `comfort_temp_effective`: mean of post-override per-room targets.
    `rooms_overridden_count`: rooms whose effective target diverges from
    `comfort_temp_active` by at least COMFORT_DIVERGENCE_THRESHOLD_C.

    Returns sensible fallbacks (mean → comfort_temp_active, count → 0)
    when `ctx.room_targets` is absent, not a dict, or empty. The defensive
    isinstance check is required because test harnesses use MagicMock for
    ctx, whose attribute access returns a truthy MagicMock — a plain
    truthy-or-empty check would divide by zero.
    """
    room_targets = getattr(ctx, "room_targets", None)
    if not isinstance(room_targets, dict) or not room_targets:
        return {
            "comfort_temp_effective": ctx.comfort_temp_active,
            "rooms_overridden_count": 0,
        }
    total = float(sum(room_targets.values()))
    return {
        "comfort_temp_effective": total / len(room_targets),
        "rooms_overridden_count": sum(
            1 for v in room_targets.values()
            if abs(v - ctx.comfort_temp_active) >= COMFORT_DIVERGENCE_THRESHOLD_C
        ),
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


@dataclass
class PendingWriteback:
    """Record of a control-topic writeback awaiting next-cycle readback confirmation.

    Overwrite semantics: rapid stepper use overwrites the prior pending record
    (singleton dict-by-key). Transient mismatches between successive writes
    do not fire events — they fall through the "no match yet, within deadline"
    branch of the three-outcome decision tree (Task 3). INSTRUCTION-268 §1.4(i).
    """
    key: str
    value: float
    written_at: float
    deadline: float
    client_unavailable: bool = False


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
        self._swarm_ref = None      # SwarmRuntime (set after construction); None when swarm disabled
        self._boost_controller = None  # Reference to BoostController (set after pipeline build)
        self._mqtt_client = None       # Reference to MQTTClient (set for MQTT driver, for API write-back)
        self._driver_ref = None        # INSTRUCTION-225C: IODriver, set by main.py post-create_driver
        self._telemetry_ref = None     # INSTRUCTION-193 Task 4: TelemetryService for is_revoked()
        self._debouncer_ref = None     # Reference to ControlDebouncer (set after pipeline build)
        self._pending_writebacks: Dict[str, 'PendingWriteback'] = {}
        self._migration_pending: bool = False
        self._driver_status: str = "pending"        # "pending" | "connected" | "error"
        self._driver_error: Optional[str] = None    # Human-readable error message

        # INSTRUCTION-131C V6 — API-facing aux dispatch tracking.
        #
        # SharedState is a per-process singleton constructed once at module
        # import in qsh/api/state.py:668. _aux_dispatched is therefore
        # process-scoped state with the same lifetime as the process (per
        # V5/C11).
        #
        # _aux_dispatched: per-room last-actual-attempt result for the API
        # tri-state. Only mutated by update() when a real dispatch
        # attempt happened this cycle (live + outputs.auxiliary_outputs_changed).
        # Cleared on shadow->live rising edge (per V5/C9) so a stale prior-live
        # value does not mask a never-attempted state after extended shadow
        # operation.
        #
        # Lifetime note (per V5/C10): there is no in-process config-reload
        # path in the codebase, so _aux_dispatched is naturally bounded by the
        # room count at process start. If a future change adds in-process
        # config reload, the maintainer must also prune entries here against
        # the new aux-room set.
        self._aux_dispatched: Dict[str, bool] = {}
        self._was_in_shadow_last_cycle: bool = False

    def update(self, ctx, config: dict, sysid=None):
        """Called by pipeline thread after each run_cycle().

        Extract all needed values from CycleContext HERE, not in the API thread.
        This avoids the API thread touching mutable pipeline objects.

        Args:
            ctx: CycleContext from the just-completed cycle
            config: HOUSE_CONFIG dict
            sysid: SystemIdentifier instance (optional, for sysid endpoints)
        """
        # V5/C9 — clear stale last-attempt values on shadow->live transition.
        # Without this, a True value from a prior live session would survive
        # any duration of shadow operation and surface in the API after return
        # to live, masking a never-attempted state.
        if self._was_in_shadow_last_cycle and ctx.control_enabled:
            self._aux_dispatched.clear()

        rooms = {}
        if ctx.sensor_data:
            room_temps = getattr(ctx.sensor_data, 'room_temps', {})
            valve_positions = getattr(ctx.sensor_data, 'heating_percs', {})
        else:
            room_temps = {}
            valve_positions = {}

        room_targets = ctx.room_targets
        occupancy_states = ctx.occupancy_states
        occupancy_source = ctx.occupancy_source
        temperature_source = ctx.room_temperature_source

        # HOUSE_CONFIG["rooms"] is {room_name: area_m2} (flat floats)
        # Facings, ceiling heights etc. are in separate top-level dicts
        room_areas = config.get('rooms', {})
        facings_map = config.get('facings', {})
        ceiling_map = config.get('ceiling_heights', {})

        # INSTRUCTION-131C V6 — aux derivation prerequisites pulled once.
        aux_outputs_cfg_all = config.get("auxiliary_outputs", {}) or {}
        ctx_aux_state = ctx.auxiliary_state or {}
        outputs = ctx.outputs
        aux_outputs_dispatched_map = (
            getattr(outputs, 'auxiliary_outputs', {}) or {}
        ) if outputs is not None else {}
        aux_outputs_changed = bool(
            getattr(outputs, 'auxiliary_outputs_changed', False)
        ) if outputs is not None else False
        aux_failures = (
            getattr(outputs, 'auxiliary_dispatch_failures', set()) or set()
        ) if outputs is not None else set()

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

            # INSTRUCTION-131C V6 — auxiliary output derivation (V4/C5 tri-state).
            aux_outputs_cfg = aux_outputs_cfg_all.get(room_name, {}) or {}
            aux_configured = bool(aux_outputs_cfg.get("enabled"))

            if aux_configured:
                aux_state_val = ctx_aux_state.get(room_name, False)
                aux_rated_kw_val = aux_outputs_cfg.get("rated_kw", 0.0)
                aux_min_on_s_val = aux_outputs_cfg.get("min_on_time_s", 60)
                aux_min_off_s_val = aux_outputs_cfg.get("min_off_time_s", 60)
                aux_max_cph_val = aux_outputs_cfg.get("max_cycles_per_hour", 6)
            else:
                aux_state_val = None
                aux_rated_kw_val = 0.0
                aux_min_on_s_val = None
                aux_min_off_s_val = None
                aux_max_cph_val = None

            # aux_dispatched derivation (V4/C5 tri-state, current-cycle freshness).
            # True  = last actual dispatch attempt succeeded.
            # False = last actual dispatch attempt failed (alarm).
            # None  = not configured, or running in shadow mode, or no attempt yet.
            if not aux_configured:
                aux_dispatched_val = None
            elif not ctx.control_enabled:
                # Shadow: nothing was dispatched this cycle. The API contract
                # expressly returns None in shadow regardless of the last
                # live-mode value — operators must be able to distinguish
                # "not attempted" from "attempted-and-failed" without
                # inferring the install's mode.
                aux_dispatched_val = None
            else:
                # Live mode. Update _aux_dispatched only when an actual
                # attempt happened this cycle.
                if aux_outputs_changed and room_name in aux_outputs_dispatched_map:
                    if room_name in aux_failures:
                        self._aux_dispatched[room_name] = False
                    else:
                        self._aux_dispatched[room_name] = True
                # No attempt this cycle -> _aux_dispatched[room_name]
                # unchanged (or absent if never attempted in this session).
                aux_dispatched_val = self._aux_dispatched.get(room_name)

            rooms[room_name] = {
                'temp': temp,
                'target': target,
                'valve': valve,
                'occupancy': occ,
                'occupancy_source': occupancy_source.get(room_name, 'schedule'),
                'temperature_source': temperature_source.get(room_name, 'unknown'),
                'status': status,
                'facing': facings_map.get(room_name, 0.2),
                'area_m2': room_areas.get(room_name, 0),
                'ceiling_m': ceiling_map.get(room_name, 2.4),

                # INSTRUCTION-131C V6 — auxiliary output (tri-state per V4/C5)
                'aux_state': aux_state_val,
                'aux_dispatched': aux_dispatched_val,
                'aux_rated_kw': aux_rated_kw_val,
                'aux_min_on_s': aux_min_on_s_val,
                'aux_min_off_s': aux_min_off_s_val,
                'aux_max_cycles_per_hour': aux_max_cph_val,
            }

        # Read shadow entities for cost/energy if available
        shadow = {}
        if ctx.outputs:
            shadow = getattr(ctx.outputs, 'shadow_entities', {}) or {}

        # INSTRUCTION-191B: read mode-resolved SCOP from CostController via the
        # orchestrator handoff established by INSTRUCTION-154B. ctx.cost_controller
        # is attached at qsh/pipeline/orchestrator.py:201-202 after the cost
        # controller's execute() call. On the very first cycle (before the cost
        # controller has run) the attribute is absent — fall back to a zero-state
        # summary so CycleSnapshot construction never raises.
        if hasattr(ctx, 'cost_controller') and ctx.cost_controller is not None:
            cost_summary = ctx.cost_controller.get_daily_summary()
        else:
            cost_summary = {
                "daily_cop_combined": None,
                "daily_cop_ch": None,
                "daily_cop_hw": None,
                "energy_today_kwh_ch": 0.0,
                "energy_today_kwh_hw": 0.0,
                "thermal_kwh_today_ch": 0.0,
                "thermal_kwh_today_hw": 0.0,
            }

        # INSTRUCTION-225C — build the manual_state map from qsh.manual_state.
        # Filter to configured_direct_rooms so indirect rooms are absent (parity
        # with the API GET /api/manual contract). Plain dict per the snapshot
        # field's documented serialisation shape.
        from qsh import manual_state
        manual_map: Dict[str, Dict[str, Any]] = {}
        hardware_map = config.get("room_valve_hardware", {})
        for r in manual_state.configured_direct_rooms(config):
            entry = manual_state.get(r)
            manual_map[r] = {
                "mode": entry.mode,
                "position_pct": entry.position_pct,
                "set_by": entry.set_by,
                "set_at": entry.set_at,
                "hardware_type": hardware_map.get(r, "generic"),
            }

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
            readback_mismatch_count=ctx.readback_mismatch_count,
            readback_mismatch_threshold=ctx.readback_mismatch_threshold,
            last_readback_mismatch_alarm_time=ctx.last_readback_mismatch_alarm_time,
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
            # INSTRUCTION-191B: mode-resolved SCOP today-rolling from CostController
            # (NOT from shadow entities — these fields are not published to HA).
            daily_cop_combined=cost_summary["daily_cop_combined"],
            daily_cop_ch=cost_summary["daily_cop_ch"],
            daily_cop_hw=cost_summary["daily_cop_hw"],
            energy_today_kwh_ch=cost_summary["energy_today_kwh_ch"],
            energy_today_kwh_hw=cost_summary["energy_today_kwh_hw"],
            thermal_kwh_today_ch=cost_summary["thermal_kwh_today_ch"],
            thermal_kwh_today_hw=cost_summary["thermal_kwh_today_hw"],
            rl_blend=ctx.current_blend,
            rl_flow=ctx.rl_flow,
            rl_reward=ctx.reward,
            rl_loss=ctx.loss_value,
            shoulder_monitoring=ctx.shoulder_monitoring,
            summer_monitoring=ctx.summer_monitoring,
            cooling_active=getattr(ctx.inputs, "cooling_active", False),
            cascade_active=ctx.cascade_active if hasattr(ctx, 'cascade_active') else False,
            frost_cap_active=ctx.frost_cap_active if hasattr(ctx, 'frost_cap_active') else False,
            antifrost_override_active=ctx.antifrost_override_active,
            winter_equilibrium=(
                ctx.antifrost_override_active
                and ctx.smoothed_demand < 0.5
                and ctx.applied_mode == "heat"
            ),
            antifrost_threshold=config.get("antifrost", {}).get("oat_threshold", 7.0),
            boost_active=ctx.boost_active,
            boost_rooms=ctx.boost_rooms,
            signal_quality=ctx.inputs.signal_quality if ctx.inputs else {},
            away_mode_active=ctx.inputs.away_mode_active if ctx.inputs else False,
            away_days=ctx.inputs.away_days if ctx.inputs else 0.0,
            comfort_schedule_active=ctx.comfort_schedule_active,
            comfort_temp_active=ctx.comfort_temp_active,
            target_temp_fallback_active=ctx.target_temp_fallback_active,
            comfort_temp_writeback_unverified=getattr(
                getattr(ctx, "driver", None),
                "comfort_temp_writeback_unverified",
                False,
            ),
            # INSTRUCTION-257 — mean of post-override per-room targets, plus
            # the per-room divergence count that drives the Home page sub-line.
            # `ctx.room_targets` is the final effective per-room target dict
            # after the full override stack (per-room comfort, persistent
            # zones, away, setback, recovery). Computed in a single helper to
            # avoid duplicating the empty-/non-dict guard.
            **_comfort_effective_fields(ctx),
            active_source_type=ctx.active_source_type,
            source_caps=ctx.source_caps,
            active_source_input_power_kw=ctx.active_source_input_power_kw,
            active_source_thermal_output_kw=ctx.active_source_thermal_output_kw,
            active_source_thermal_output_source=ctx.active_source_thermal_output_source,
            active_source_performance=ctx.active_source_performance,
            peak_thermal_demand_kw=ctx.peak_thermal_demand_kw,
            # INSTRUCTION-246 Task 4 Step 4d — input-power provenance.
            # Defence-in-depth getattr — pre-246 test contexts may lack the
            # attribute (e.g. SimpleNamespace fixtures in
            # qsh/api/tests/test_status_manual_field.py); fall back to the
            # CycleSnapshot default ("unknown") to keep those green.
            active_source_input_power_source=getattr(
                ctx, "active_source_input_power_source", "unknown"
            ),
            # INSTRUCTION-340 — selected source name (defence-in-depth getattr
            # for pre-340 test contexts that lack the attribute).
            active_source_name=getattr(ctx, "active_source_name", ""),
            tariff_providers_status=_collect_tariff_providers_status(),
            available_provider_kinds=SUPPORTED_PROVIDER_KINDS,
            # INSTRUCTION-224D — per-emitter valve readings deep-copied from
            # InputBlock. Defence-in-depth getattr in case a driver predating
            # 224B emits an InputBlock without the field.
            valve_positions_per_emitter={
                _room: dict(_emitters)
                for _room, _emitters in getattr(
                    ctx.inputs, "valve_positions_per_emitter", {}
                ).items()
            },
            manual_state=manual_map,
            # INSTRUCTION-261 Task 8 — forward as-is. Design A sentinel
            # already applied inside AllostaticLoadRegistry.snapshot();
            # defence-in-depth getattr for pre-261 SimpleNamespace test
            # fixtures.
            allostatic_load=dict(getattr(ctx, "allostatic_load_snapshot", {}) or {}),
        )

        # ── Recovery time & capacity % (Newton's law per-room solver) ──
        # INSTRUCTION-278 — bar capacity + min-output track the ACTIVE source
        # per cycle, falling back to the Task-1-derived config keys. Resolved as
        # an atomic pair (all-active or all-config) so min_load_pct never mixes
        # an active-source numerator with a config denominator. The denominator
        # is the THERMAL figure (active-source capacity_kw /
        # hp_thermal_capacity_kw), NOT the legacy hp_capacity_kw which the 117
        # capability layer reads as electrical-input capacity; hp_capacity_kw
        # stays only the lowest fallback so flat-schema installs keep their
        # historical bar denominator.
        _asc = getattr(ctx, "active_source_config", None) or {}
        _a_cap = _safe_pos(_asc.get("capacity_kw"))
        _a_min = _safe_pos(_asc.get("min_output_kw"))
        if _a_cap is not None and _a_min is not None:
            bar_capacity_kw, hp_min_output_kw = _a_cap, _a_min
        else:
            bar_capacity_kw = (
                _safe_pos(config.get("hp_thermal_capacity_kw"))
                or _safe_pos(config.get("hp_capacity_kw"))
                or 6.0
            )
            hp_min_output_kw = _safe_pos(config.get("hp_min_output_kw")) or 2.0
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
        capacity_pct = (total_demand / bar_capacity_kw * 100) if bar_capacity_kw > 0 else 0.0

        snap.capacity_pct = round(capacity_pct, 1)
        snap.hp_capacity_kw = bar_capacity_kw

        snap.min_load_pct = round((hp_min_output_kw / bar_capacity_kw * 100) if bar_capacity_kw > 0 else 0.0, 1)

        # Away state from pipeline
        away_state = ctx.away_state
        if away_state is not None:
            snap.recovery_active = getattr(away_state, 'recovery_active', False)
            snap.zones_recovering = list(getattr(away_state, 'zones_recovering', []))
            snap.per_zone_away = dict(getattr(away_state, 'per_zone_away', {}))

        # Source selection (multi-source installs only)
        if len(config.get("heat_sources", [])) > 1:
            source_scores = ctx.source_scores
            heat_sources = config.get("heat_sources", [])
            active_name = ctx.active_source
            source_states = ctx.inputs.source_states if ctx.inputs else {}

            sources_list = []
            for src in heat_sources:
                name = src.get("name", "")
                score = source_scores.get(name, 0.0)
                eff = src.get("efficiency", 1.0)

                src_type = src.get("type", "")

                # INSTRUCTION-355 — primary path: read the per-source cost
                # SourceSelectionController published this cycle (pure ctx read;
                # incl. the fuel_cost_entity/topic slot). Replaces the prior
                # fuel_rates-only resolution that ignored per-source topics.
                # Cold-start fallback (V2 — closes reviewer V1 LOW): on the first
                # cycle, before SSC has published this name, resolve directly
                # through the single authority so a topic-priced source is never
                # shown as 0 for one cycle. The lazy import keeps api/state.py off
                # a top-level pipeline.controllers dependency (same local-import
                # idiom as the fuel_for_source import this block replaces).
                # Defence-in-depth isinstance check — test contexts may use
                # MagicMock where ctx.source_fuel_costs returns a non-dict; treat
                # as empty so the direct-resolution fallback runs.
                _published_map = getattr(ctx, "source_fuel_costs", None)
                if not isinstance(_published_map, dict):
                    _published_map = {}
                _published = _published_map.get(name)
                if _published is not None:
                    fuel_cost = _published
                else:
                    from qsh.pipeline.controllers.source_selection import (
                        resolve_source_input_cost,
                    )
                    fuel_cost = resolve_source_input_cost(src, ctx)[0]

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
                    "type": src_type,
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
                "switch_count_today": ctx.source_switch_count_today,
                "max_switches_per_day": sel_config.get("max_switches_per_day", 6),
                # 228A Task 4: backend-to-payload field-name mapping.
                # ctx.source_failover_active → failover_active
                # ctx.source_switch_reason → reason  (Literal — see SourceSelectionReason)
                # ctx.source_selection_detail → detail
                # ctx.source_blocked_switches → blocked_switches
                "failover_active": ctx.source_failover_active,
                "reason": ctx.source_switch_reason,
                "detail": ctx.source_selection_detail,
                "blocked_switches": list(ctx.source_blocked_switches),
                # back-compat alias retained during frontend rollout
                "last_switch_reason": ctx.source_switch_reason,
            }

        # ====================================================================
        # INSTRUCTION-208A V2 — DFAN forecast carriers populated from ctx with
        # defensive getattr fallbacks. Snapshot stays JSON-serialisable on
        # early-boot cycles and when forecast_extension_master_enable=False.
        # ====================================================================
        fs = getattr(ctx, "forecast_state", None)
        if fs is not None:
            snap.forecast_state_snapshot = {
                "oat_rise_next_6h_c": getattr(fs, "oat_rise_next_6h_c", None),
                "solar_kwh_12h": getattr(fs, "solar_kwh_12h", None),
                "forecast_load_kwh_4h": getattr(fs, "forecast_load_kwh_4h", None),
                "forecast_load_kwh_12h": getattr(fs, "forecast_load_kwh_12h", None),
                "forecast_load_kwh_24h": getattr(fs, "forecast_load_kwh_24h", None),
                "forecast_load_per_room_kwh": dict(
                    getattr(fs, "forecast_load_per_room_kwh", {}) or {}
                ),
                "forecast_solar_per_room_kwh": dict(
                    getattr(fs, "forecast_solar_per_room_kwh", {}) or {}
                ),
                "hourly_temps_first_6": list(
                    (getattr(fs, "hourly_temps", []) or [])[:6]
                ),
                "hourly_solar_first_6": list(
                    (getattr(fs, "hourly_solar", []) or [])[:6]
                ),
                "cold_snap_active": bool(getattr(fs, "cold_snap_active", False)),
                "wind_active": bool(getattr(fs, "wind_active", False)),
            }

        pr = getattr(ctx, "passive_recovery", None) or {}
        if pr:
            snap.passive_recovery = {
                room: {
                    "predicted_t_indoor": getattr(state, "predicted_t_indoor", None),
                    "composite_confidence": getattr(state, "composite_confidence", None),
                    "weather_class": (
                        list(state.weather_class)
                        if getattr(state, "weather_class", None) else None
                    ),
                    "bias_correction_c": getattr(state, "bias_correction_c", None),
                    "prediction_target_ts": getattr(state, "prediction_target_ts", None),
                }
                for room, state in pr.items()
            }

        fpd = getattr(ctx, "forecast_predicted_decisions", None) or {}
        snap.forecast_predicted_decisions = {
            controller_name: {
                room_name: {
                    "predicted_value": record["predicted_value"],
                    "predicted_metric": record["predicted_metric"],
                    "prediction_target_ts": record["prediction_target_ts"],
                    "decision_basis": dict(record["decision_basis"]),
                    "decision_taken": record["decision_taken"],
                }
                for room_name, record in room_records.items()
            }
            for controller_name, room_records in fpd.items()
        }

        snap.twin_calibration_drift = dict(
            getattr(ctx, "twin_calibration_drift", None) or {}
        )

        active_alarms_list = getattr(ctx, "active_alarms", None) or []
        snap.active_alarms = [
            {
                "alarm_id": getattr(ev, "alarm_id", None),
                "timestamp": getattr(ev, "timestamp", None),
                "room": getattr(ev, "room", None),
                "payload": dict(getattr(ev, "payload", {}) or {}),
                "severity": getattr(ev, "severity", None),
            }
            for ev in active_alarms_list
        ]

        with self._lock:
            self._snapshot = snap
            if sysid is not None:
                self._sysid_ref = sysid
            if config is not None:
                self._config_ref = config

        # V5/C9 — track shadow status for next cycle's rising-edge detection.
        self._was_in_shadow_last_cycle = not ctx.control_enabled

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

    def get_swarm(self):
        """SwarmRuntime accessor for /api/swarm/* routes (INSTRUCTION-288B).
        Returns None when swarm is disabled or not yet wired."""
        with self._lock:
            return self._swarm_ref

    def set_swarm(self, runtime):
        with self._lock:
            self._swarm_ref = runtime

    def get_telemetry(self):
        """INSTRUCTION-193 Task 4: TelemetryService accessor for /api/status."""
        with self._lock:
            return self._telemetry_ref

    def set_telemetry(self, service):
        with self._lock:
            self._telemetry_ref = service

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

    def get_driver(self):
        """INSTRUCTION-225C: IODriver accessor for API write paths.

        Returns None during the brief startup window before main.py wires the
        driver via set_driver(). API routes that dispatch immediate writes
        (e.g. /api/manual PUT) must handle the None case explicitly per V3 N2.
        """
        with self._lock:
            return self._driver_ref

    def set_driver(self, driver) -> None:
        with self._lock:
            self._driver_ref = driver

    def set_debouncer(self, debouncer) -> None:
        """Register the live ControlDebouncer for runtime PATCH access.
        Called once from main.py after pipeline construction."""
        with self._lock:
            self._debouncer_ref = debouncer

    def get_debouncer(self):
        """Return the live ControlDebouncer or None if not yet registered.
        Returns None during the brief startup window before main.py
        registers the debouncer — API routes must handle the None case."""
        with self._lock:
            return self._debouncer_ref

    # INSTRUCTION-268 — pending writeback lifecycle for comfort-temp round-trip.
    def set_pending_writeback(self, pw: 'PendingWriteback') -> None:
        with self._lock:
            self._pending_writebacks[pw.key] = pw

    def get_pending_writeback(self, key: str) -> 'Optional[PendingWriteback]':
        with self._lock:
            return self._pending_writebacks.get(key)

    def clear_pending_writeback(self, key: str) -> None:
        with self._lock:
            self._pending_writebacks.pop(key, None)

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
