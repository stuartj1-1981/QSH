export interface RoomState {
  temp: number | null
  target: number | null
  valve: number
  occupancy: string
  occupancy_source?: string
  temperature_source?: string  // 'independent' | 'trv' | 'trv_stale' | 'unavailable' | 'none_configured' | 'unknown'
  status: string
  facing: number | string
  area_m2: number
  ceiling_m: number
  // Aux output (INSTRUCTION-131C V6 — tri-state per V4/C5)
  aux_state?: boolean | null         // null = not configured
  aux_dispatched?: boolean | null    // null = not configured OR shadow OR no live attempt yet
                                     // true  = last live attempt succeeded
                                     // false = last live attempt failed (alarm)
  aux_rated_kw?: number              // 0 or absent = no thermal contribution asserted (e.g. MVHR)
  aux_min_on_s?: number | null
  aux_min_off_s?: number | null
  aux_max_cycles_per_hour?: number | null
  // INSTRUCTION-224E — per-emitter valve positions flattened onto the room
  // view-model at the page-level call site (Rooms.tsx) from the top-level
  // CycleMessage.valve_positions_per_emitter[name] field. Undefined or
  // empty for single-emitter rooms.
  valve_positions_per_emitter?: Record<string, number>
}

export interface HpState {
  power_kw: number
  // INSTRUCTION-120B: null when HP is off or performance is in sensor-loss
  // fallback. Render sites must treat null as '—'. Matches the backend
  // `_resolve_snapshot_hp_cop` gate — never a positive fallback baseline.
  cop: number | null
  flow_temp: number
  return_temp: number
  delta_t: number
  flow_rate: number
}

// INSTRUCTION-117E Task 3a: flat HeatSourceState with closed Literal `type`
// enum. `performance.source` carries provenance ("live" = measured ratio
// this cycle or within the 5-cycle HP hold window; "config" = fallback to
// caps.performance_baseline). Rendering label ("COP" vs "η") is derived at
// the UI layer from `type` alone — 1:1 derivable, so a `performance.kind`
// discriminator is information redundancy per parent 117 V5.
export interface HeatSourceState {
  type: 'heat_pump' | 'gshp' | 'gas_boiler' | 'lpg_boiler' | 'oil_boiler'
  input_power_kw: number
  thermal_output_kw: number | null
  thermal_output_source: 'measured' | 'computed' | 'unknown'
  // INSTRUCTION-246 Task 8 Step 8a — provenance for input_power_kw.
  // Optional on the frontend (forward-compat against old servers that have
  // not yet shipped V3); the backend pydantic model declares it REQUIRED so
  // a backend bug emitting a value outside this Literal set fails at
  // serialisation. The asymmetry (backend strict + frontend forgiving) is
  // intentional and matches the existing performance.source shape.
  input_power_source?: 'live' | 'legacy' | 'nameplate' | 'unknown'
  performance: { value: number; source: 'live' | 'config' }
  flow_temp: number
  return_temp: number
  delta_t: number
  flow_rate: number
}

export interface EnergyState {
  current_rate: number
  export_rate?: number
  cost_today_pence: number
  energy_today_kwh: number
  predicted_saving?: number
  // INSTRUCTION-191B/D: mode-resolved SCOP today-rolling values from
  // CostController.get_daily_summary(). Null when bucket has no input.
  daily_cop_combined: number | null
  daily_cop_ch: number | null
  daily_cop_hw: number | null
  energy_today_kwh_ch: number
  energy_today_kwh_hw: number
  thermal_kwh_today_ch: number
  thermal_kwh_today_hw: number
}

// INSTRUCTION-191C/D: SCOP windowed-aggregation response.
export type ScopWindow = 'today' | '7d' | '30d' | '90d' | 'season'
export type ScopMode = 'combined' | 'ch' | 'hw'

export interface ScopResponse {
  available: boolean
  message?: string
  window: ScopWindow
  mode: ScopMode
  window_start?: string
  window_end?: string
  scop?: number | null
  thermal_kwh?: number
  electrical_kwh?: number
}

// INSTRUCTION-150E: Tariff Provider Abstraction (frontend types).
// V2 E-H1: tariff_providers_status is a Partial<Record<Fuel, ProviderStatus>> —
// the backend populates only fuels in the install. Component code uses
// optional chaining; the type system distinguishes "fuel present in install
// but provider failed" from "fuel not present in install at all".
export type Fuel = 'electricity' | 'gas' | 'lpg' | 'oil'

export type ProviderKind =
  | 'octopus_electricity'
  | 'octopus_gas'
  | 'edf_freephase'
  | 'fixed'
  | 'fallback'
  | 'ha_entity'  // 158C: mirrors backend qsh/tariff/__init__.py

export interface ProviderStatus {
  fuel: Fuel
  provider_kind: ProviderKind
  last_refresh_at: number | null
  stale: boolean
  last_price: number
  source_url: string | null
  last_error: string | null
  // V5 C-2: human-readable label authored by the backend ("Octopus Agile",
  // "EDF FreePhase Green Band", "Fixed £0.0712/kWh"). The frontend renders
  // it directly — never combines provider_kind + tariff_code itself.
  tariff_label: string | null
}

export interface EngineeringState {
  det_flow: number
  rl_flow: number | null
  rl_blend: number
  rl_reward: number
  rl_loss?: number
  shoulder_monitoring: boolean
  summer_monitoring: boolean
  antifrost_override_active?: boolean
  winter_equilibrium?: boolean
  antifrost_threshold?: number
  cascade_active?: boolean
  frost_cap_active?: boolean
  signal_quality?: Record<string, string>
}

export interface SourceState {
  name: string
  type: string
  status: 'active' | 'standby' | 'offline'
  efficiency: number
  fuel_cost_per_kwh: number
  cost_per_kwh_thermal: number
  carbon_per_kwh_thermal: number
  score: number
  signal_quality: string
}

// 228B Task 1: Literal-constrained reason vocabulary mirroring the
// backend SourceSelectionReason at qsh/pipeline/controllers/source_selection.py.
// Adding a new branch in the backend requires extending this Literal AND
// the chip-text map in StatusBanner.tsx.
export type SourceSelectionReasonKind =
  | 'cost'
  | 'carbon'
  | 'manual_lock'
  | 'failover'
  | 'dwell_hold'
  | 'deadband_hold'
  | 'daily_cap_hold'
  | 'single_source'

// 228B Task 1: per-cycle blocked-switch entry. `failover` is NOT a
// member here per parent Decision 4 — failover displaces, it does not
// block. The displaced source's name flows through
// SourceSelectionPayload.detail.
export interface BlockedSwitch {
  to: string                                  // candidate source name
  reason: 'dwell' | 'deadband' | 'daily_cap'
}

// 228B Task 1: narrow runtime payload surfaced on /ws/live and
// /api/status under `source_selection`. Strict subset of
// SourceSelectionState; consumed by StatusBanner for the badge.
export interface SourceSelectionPayload {
  active_source: string
  reason: SourceSelectionReasonKind
  detail: string                  // free-form, displayed in tooltip
  blocked_switches: BlockedSwitch[]
  failover_active: boolean
}

// SourceSelectionState extends SourceSelectionPayload so existing
// consumers (SourceSelector, useSourceSelection) keep working while
// new consumers can read the narrow SourceSelectionPayload shape.
// `last_switch_reason` is the back-compat alias for `reason` retained
// during the frontend rollout (228A backend writes both keys).
export interface SourceSelectionState extends SourceSelectionPayload {
  mode: string
  preference: number
  sources: SourceState[]
  switch_count_today: number
  max_switches_per_day: number
  last_switch_reason: string
}

export interface DriverStatus {
  status: 'pending' | 'connected' | 'error'
  error: string | null
}

// INSTRUCTION-186: read-only diagnostic surface for the active control
// routing path. Mirrors qsh/config.py:1879-1897 resolution + the "pending"
// sentinel from line 1686 + the "unknown" defensive default in
// qsh/api/routes/status.py. Used only for display; not a wire-format
// constraint on any input path.
export type ControlMethod =
  | 'octopus_api'
  | 'ha_service'
  | 'mqtt'
  | 'entity'
  | 'trvs_only'
  | 'monitor_only'
  | 'pending'
  | 'unknown'

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  pipeline_age_seconds: number
  cycle_number: number
  api_version: string
  addon_version: string
  // INSTRUCTION-252 backend fields, typed under INSTRUCTION-327 for the
  // Schedule page caption. local_timezone is the resolved IANA name; source
  // names which step of the precedence chain won. Optional so the caption
  // degrades gracefully against older backends / partial mocks.
  local_timezone?: string
  local_timezone_source?: 'supervisor' | 'config' | 'env' | 'default'
  driver: { status: string; [key: string]: unknown }
}

export interface StatusResponse {
  timestamp: number
  cycle_number: number
  operating_state: string
  control_enabled: boolean
  comfort_temp: number
  comfort_schedule_active?: boolean
  comfort_temp_active?: number
  // INSTRUCTION-257 — mean of post-override per-room targets and count of
  // rooms diverging from comfort_temp_active by >= COMFORT_DIVERGENCE_THRESHOLD_C
  // (0.3°C, single-sourced backend-side). Optional during the rollout window;
  // pre-257 snapshots will not carry these fields, so the Home page tolerates
  // their absence by treating the count as 0 (no divergence sub-line shown).
  comfort_temp_effective?: number
  rooms_overridden_count?: number
  // INSTRUCTION-267 — True when the pipeline's fallback at sensor_controller.py:174 fired this cycle (no inputs.target_temp from driver). Drives the "no comfort temperature set" sub-line branch.
  target_temp_fallback_active?: boolean
  // INSTRUCTION-268 — True when the most recent MQTT comfort-temp writeback did not match the next-cycle readback within WRITEBACK_DEADLINE_S (60s) AND a broker-sourced readback never matched. Drives the ComfortControl "writeback unverified" pill. Source=internal matches (INSTRUCTION-105 disk fallback) emit an OCCURRED event but do not set this field.
  comfort_temp_writeback_unverified?: boolean
  optimal_flow: number
  applied_flow: number
  optimal_mode: string
  applied_mode: string
  readback_mismatch_count?: number
  readback_mismatch_threshold?: number
  last_readback_mismatch_alarm_time?: number
  total_demand: number
  outdoor_temp: number
  recovery_time_hours: number
  capacity_pct: number
  hp_capacity_kw: number
  min_load_pct: number
  heat_source: HeatSourceState
  // INSTRUCTION-117E Task 3b: legacy shim; populated only when
  // heat_source.type === 'heat_pump'.
  hp: HpState | null
  rooms_total: number
  rooms_below_target: number
  comfort_pct: number
  energy: EnergyState
  away: { active: boolean; days: number }
  engineering: EngineeringState
  source_selection?: SourceSelectionState
  migration_pending?: boolean
  driver?: DriverStatus
  // INSTRUCTION-135: true when qsh.config.CONFIG_IS_TEMPLATE is set
  // (placeholder qsh.yaml — wizard incomplete). Optional during the rollout
  // window only; once 134 + 135 ship through one release cycle this should
  // be flipped to required (V1 Finding 7 follow-up).
  setup_mode?: boolean
  // INSTRUCTION-150E: tariff provider abstraction (mirror of CycleMessage
  // fields for REST consumers). Optional during phase 7 rollout.
  tariff_providers_status?: Partial<Record<Fuel, ProviderStatus>>
  available_provider_kinds?: ProviderKind[]
  // INSTRUCTION-186: active control routing path — display-only.
  control_method?: ControlMethod
  // INSTRUCTION-208B V5 — DFAN forecast extension. Optional because
  // mid-rollout pre-208A backends may emit pre-extension payloads; frontend
  // null-coalesces gracefully.
  forecast_state_snapshot?: ForecastStateSnapshot
  passive_recovery?: Record<string, PassiveRecoveryState>
  forecast_predicted_decisions?: Record<string, Record<string, PredictionRecord>>
  twin_calibration_drift?: Record<string, boolean>
  active_alarms?: AlarmEvent[]
  // INSTRUCTION-255: most recent permanent telemetry-push failure for the
  // Settings → Data Sharing diagnostic block. `null` when no failure has
  // been recorded (or has been cleared by a subsequent successful push).
  telemetry_last_permanent_failure?: {
    timestamp: number
    status_code: number
    detail: string
    date: string | null
  } | null
}

export interface RoomsResponse {
  timestamp: number
  rooms: Record<string, RoomState>
}

export interface BoostRoom {
  target: number
  remaining_s: number
  original_target: number
}

export interface CycleMessage {
  type: 'cycle' | 'keepalive'
  timestamp?: number
  cycle_number?: number
  status?: {
    operating_state: string
    control_enabled: boolean
    comfort_temp: number
    comfort_schedule_active?: boolean
    comfort_temp_active?: number
    comfort_temp_effective?: number
    rooms_overridden_count?: number
    target_temp_fallback_active?: boolean
    comfort_temp_writeback_unverified?: boolean
    optimal_flow: number
    applied_flow: number
    optimal_mode: string
    applied_mode: string
    readback_mismatch_count?: number
    readback_mismatch_threshold?: number
    last_readback_mismatch_alarm_time?: number
    total_demand: number
    outdoor_temp: number
    recovery_time_hours: number
    per_room_ttc?: Record<string, number>
    capacity_pct: number
    hp_capacity_kw: number
    min_load_pct: number
    heat_source: HeatSourceState
    comfort_pct: number
  }
  // INSTRUCTION-117E Task 3b: legacy shim; null on non-HP installs.
  hp?: HpState | null
  rooms?: Record<string, RoomState>
  energy?: {
    current_rate: number
    cost_today_pence: number
    cost_yesterday_pence: number
    energy_today_kwh: number
    predicted_saving: number
    predicted_energy_saving: number
    export_rate: number
  }
  engineering?: {
    det_flow: number
    rl_flow: number | null
    rl_blend: number
    rl_reward: number
    rl_loss: number
    shoulder_monitoring: boolean
    summer_monitoring: boolean
    antifrost_override_active?: boolean
    winter_equilibrium?: boolean
    antifrost_threshold?: number
    cascade_active: boolean
    frost_cap_active: boolean
    signal_quality: Record<string, string>
  }
  boost?: {
    active: boolean
    rooms: Record<string, BoostRoom>
  }
  source_selection?: SourceSelectionState
  // INSTRUCTION-150E V2 E-H1: Partial map. Backend populates only fuels in
  // the install. Use optional-chaining or hasOwn() guards; do NOT assume
  // every fuel has a status entry.
  tariff_providers_status?: Partial<Record<Fuel, ProviderStatus>>
  // V5 E-M1: backend capability flag — which provider kinds is this build
  // of QSH able to construct? Frontend gates radio options on this, NOT
  // on whether a given provider is currently configured.
  available_provider_kinds?: ProviderKind[]
  // INSTRUCTION-208B V5 — DFAN forecast extension. Optional because
  // mid-rollout pre-208A backends may emit pre-extension payloads; frontend
  // null-coalesces gracefully.
  forecast_state_snapshot?: ForecastStateSnapshot
  passive_recovery?: Record<string, PassiveRecoveryState>
  forecast_predicted_decisions?: Record<string, Record<string, PredictionRecord>>
  twin_calibration_drift?: Record<string, boolean>
  active_alarms?: AlarmEvent[]
  // INSTRUCTION-224D — per-emitter valve readings. Outer key: room.
  // Inner key: emitter stem. Empty dict for rooms without declared
  // per-emitter actuators. 224E renders this on RoomDetail's per-emitter
  // section. Optional because pre-224D backends do not emit the field;
  // frontend null-coalesces gracefully.
  valve_positions_per_emitter?: Record<string, Record<string, number>>
  // INSTRUCTION-225D — operator MANUAL/AUTO override map for direct TRVs.
  // Outer key: room. Inner: per-room ManualEntry minus the redundant `room`
  // field. Optional because backends predating the 225 family do not emit
  // the key; consumers (RoomCard badge, RoomDetail strip, Valves page)
  // must null-coalesce.
  manual_state?: Record<string, Omit<ManualEntry, 'room'>>
}

// INSTRUCTION-225D — operator MANUAL/AUTO override for direct-TRV positions.
export type ManualMode = 'AUTO' | 'MANUAL'

export interface ManualEntry {
  room: string
  mode: ManualMode
  position_pct: number | null
  set_by: string
  set_at: number
  // hardware_type kept as plain string for forward-compat (new direct-control
  // hardware types added without lock-step type updates).
  hardware_type: string
}

export interface SysidRoom {
  u_kw_per_c: number
  c_kwh_per_c: number
  u_observations: number
  c_observations: number
  c_source: string
  pc_fits: number
  solar_gain: number
  confidence: string
  /** INSTRUCTION-172 — per-room absolute target override (°C) when set in YAML.
   *  Null/undefined when the room follows global comfort. Surfaced for the
   *  RoomDetail "(fixed)" target annotation and any diagnostic readouts. */
  fixed_setpoint?: number | null
}

// INSTRUCTION-227C Task 8 — observed solar production envelope from
// `/api/sysid`. Four-state contract from 227B (sole source of truth):
//   1. sysid is None              → top-level `installation_solar_capacity_kw` is null
//   2. sysid present, obs == 0    → value: null, observations: 0, mature: false
//   3. sysid present, immature    → value: <max>, observations: N, mature: false
//   4. sysid present, mature      → value: <max>, observations: N, mature: true
// Consumers MUST handle the top-level-null state.
export interface InstallationSolarCapacity {
  value: number | null
  observations: number
  mature: boolean
  last_updated_ts: number | null
}

export interface SysidResponse {
  rooms: Record<string, SysidRoom>
  // Optional because backends pre-dating 227B do not emit the key.
  installation_solar_capacity_kw?: InstallationSolarCapacity | null
}

// Trend persistence types
export interface TrendPoint {
  t: number
  v: number
}

export interface TrendResponse {
  metric: string
  room: string | null
  points: TrendPoint[]
}

// Historian types
export interface HistorianMeasurement {
  name: string
  fields: string[]
}

export interface HistorianMeasurementsResponse {
  available: boolean
  message?: string
  measurements: HistorianMeasurement[]
}

export interface HistorianQueryPoint {
  t: number
  [field: string]: number | null
}

export interface HistorianQueryResponse {
  measurement?: string
  fields?: string[]
  tags?: Record<string, string | null>
  points: HistorianQueryPoint[]
  aggregation?: string
  interval?: string
  error?: string
}

export interface HistorianTagsResponse {
  available: boolean
  tags: Record<string, string[]>
}

export interface HistorianFieldsResponse {
  available: boolean
  fields: string[]
}

// Control source (external value visibility — 36C Task 4)
export interface ControlSource {
  key: string
  value: number | boolean | string
  source: 'external' | 'internal'
  external_id: string
  external_raw: string
}

// Control response types
export interface ControlResponse {
  comfort_temp: number
  comfort_temp_active: number
  comfort_schedule_active: boolean
  control_enabled: boolean
  antifrost_threshold: number
}

// Balancing types
export interface BalancingRoom {
  normalised_rate: number | null
  imbalance_ratio: number
  consecutive_imbalanced: number
  observations: number
  stability: number | null
  recommendation_pending: boolean
  recommendation_text: string
  recommendations_given: number
  balance_offset: number
  control_mode: 'direct' | 'indirect' | 'none'
  balance_status: 'automatic' | 'balanced' | 'monitoring'
  notification_disabled: boolean
}

export interface BalancingResponse {
  reference_rate: number | null
  rooms: Record<string, BalancingRoom>
  imbalanced_count: number
  total_observations: number
  error?: string
}

// INSTRUCTION-288B: quarantine read surface over the swarm publisher's
// latest_quarantine() accessor (QS-INSTRUCTION-007 unit-reader half).
export interface QuarantineStatus {
  quarantined: boolean
  reason: string | null
  contact: string | null
}

// INSTRUCTION-289B: swarm unit read surface — shapes mirror 289A's four GET
// routes (qsh/api/routes/swarm.py) exactly; every field is the contract.
export interface SwarmStatus {
  enabled: boolean
  unit_id: string | null
  cohort_id: string | null
  subscribe_enabled: boolean
  endpoint: string | null
  queue: Record<string, number>
  pending: number
}

// Provenance dict per received-prior family — permissive but typed (not `any`).
export type SwarmPriorEntry = Record<string, unknown>

export interface SwarmPriors {
  families: Record<string, SwarmPriorEntry>
  family_names: string[]
  last_etag: string | null
  count: number
}

export interface SwarmDivergenceRow {
  room: string
  u_shadow: number | null
  u_live: number | null
  u_delta: number | null
  c_shadow: number | null
  c_live: number | null
  c_delta: number | null
  solar_shadow: number | null
  solar_live: number | null
  solar_delta: number | null
}

export interface SwarmDivergence {
  rooms: SwarmDivergenceRow[]
  counterfactual_summary: string | null
}

export type SwarmGateState = 'UNKNOWN' | 'CLOSED' | 'OPEN'

export interface SwarmGates {
  gates: Record<string, SwarmGateState>
}

// INSTRUCTION-294A/294B: freshness-checked GLOBAL gate + master live-enable.
// Mirrors GET /api/swarm/global (qsh/api/routes/swarm.py). global_gate is the
// FRESH state — a read aged past max_age collapses to UNKNOWN server-side.
export interface SwarmGlobal {
  global_gate: SwarmGateState // OPEN | CLOSED | UNKNOWN (fresh; stale → UNKNOWN)
  live_enabled: boolean // operator intent
  live_active: boolean // intent ∧ fresh-OPEN — actual consumption state
  can_enable: boolean // backend = (fresh global_gate === 'OPEN')
}

// INSTRUCTION-296A/296B: per-channel swarm consumption status. Mirrors
// GET /api/swarm/channels (qsh/api/routes/swarm.py::get_channels). The frontend
// derives the traffic-light tile colour from gate × data × wired × live_active.
export type SwarmChannelData = 'fresh' | 'stale' | 'none'

export interface SwarmChannel {
  gate: SwarmGateState
  family: string | null
  data: SwarmChannelData
  wired: boolean
}

export interface SwarmChannels {
  channels: Record<string, SwarmChannel>
}

// INSTRUCTION-192: pre-write configuration snapshot mechanism.
export interface Snapshot {
  snapshot_id: string
  captured_at: number
  size_bytes: number
  trigger_path: string
}

export interface DiffEntry {
  path: string
  old: unknown
  new: unknown
  is_secret: boolean
  added?: boolean
  removed?: boolean
  type_change?: boolean
}

export interface SnapshotsResponse {
  retention_count: number
  snapshots: Snapshot[]
}

export interface DiffResponse {
  snapshot_id: string
  entries: DiffEntry[]
}

export interface RevertResponse {
  reverted_to: Snapshot
  pre_revert_snapshot: Snapshot
  restart_required: boolean
  message: string
}

// =====================================================================
// INSTRUCTION-208B V5 — DFAN Forecast Extension types.
// Consumed by frontend/src/hooks/use{FeatureFlags,CutoverGates,
// FallbackCounts,Alarms,Reconciliation}.ts and by CycleMessage /
// StatusResponse extensions below.
// =====================================================================

export interface ForecastStateSnapshot {
  oat_rise_next_6h_c: number | null
  solar_kwh_12h: number | null
  forecast_load_kwh_4h: number | null
  forecast_load_kwh_12h: number | null
  forecast_load_kwh_24h: number | null
  forecast_load_per_room_kwh: Record<string, number>
  forecast_solar_per_room_kwh: Record<string, number>
  hourly_temps_first_6: number[]
  hourly_solar_first_6: number[]
  cold_snap_active: boolean
  wind_active: boolean
}

/**
 * V208B V5 — upstream-provenance citation.
 *
 * Schema source: `qsh.forecast_confidence.PassiveRecoveryState` — a frozen
 * dataclass declared in INSTRUCTION-200 V3 Task 3 (predicted_t_indoor,
 * composite_confidence, weather_class, bias_correction_c,
 * prediction_target_ts).
 *
 * Population: `qsh.api.state.SharedState.update()` unpacks the 5 fields
 * into a JSON-serialisable dict per INSTRUCTION-208A V2 Task 2.
 *
 * Live-payload field-presence is established by the 208A V2 pytest gate
 * (exercises `dataclasses.asdict` population), NOT by the curl-based
 * reachability check (which only covers feature-flags / cutover-gates /
 * fallback-counts endpoints). Do not collapse the two chains.
 */
export interface PassiveRecoveryState {
  predicted_t_indoor: number
  composite_confidence: number
  weather_class: [string, string, string] | null
  bias_correction_c: number
  prediction_target_ts: number | null
}

export interface PredictionRecord {
  predicted_value: number
  predicted_metric: string
  prediction_target_ts: number
  decision_basis: Record<string, unknown>
  decision_taken: string
}

export interface AlarmEvent {
  alarm_id: 'A' | 'B'
  timestamp: number
  room: string | null
  payload: Record<string, unknown>
  severity: 'notification'
}

export interface FeatureFlagsResponse {
  master_enable: boolean
  flags: Record<string, Record<string, boolean>>
  rooms: string[]
  deferred_enforcement_note: string
}

export interface CutoverGateResult {
  prediction_error_p95_c: number | null
  prediction_error_p95_threshold_c: number
  prediction_error_gate_pass: boolean
  comfort_excursions_attributable: number
  comfort_gate_pass: boolean
  c_maturity: number | null
  c_maturity_threshold: number
  c_historical_min_observed: number | null
  c_historical_threshold: number
  composite_confidence_gate_pass: boolean
  twin_drift_flagged: boolean
  twin_gate_pass: boolean
  all_gates_pass: boolean
  cycles_holding: number
  cycles_required: number
  cutover_eligible: boolean
  rationale: string
}

export interface CutoverGatesResponse {
  window_cycles: number
  cycles_required: number
  gates: Record<string, Record<string, CutoverGateResult>>
}

export interface FallbackCountsResponse {
  fallback_counts: Record<string, number>
}
