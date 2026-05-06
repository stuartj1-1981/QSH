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
  type: 'heat_pump' | 'gas_boiler' | 'lpg_boiler' | 'oil_boiler'
  input_power_kw: number
  thermal_output_kw: number | null
  thermal_output_source: 'measured' | 'computed' | 'unknown'
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

export interface SourceSelectionState {
  active_source: string
  mode: string
  preference: number
  sources: SourceState[]
  switch_count_today: number
  max_switches_per_day: number
  failover_active: boolean
  last_switch_reason: string
}

export interface DriverStatus {
  status: 'pending' | 'connected' | 'error'
  error: string | null
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  pipeline_age_seconds: number
  cycle_number: number
  api_version: string
  addon_version: string
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

export interface SysidResponse {
  rooms: Record<string, SysidRoom>
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
