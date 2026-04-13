export interface RoomState {
  temp: number | null
  target: number | null
  valve: number
  occupancy: string
  occupancy_source?: string
  status: string
  facing: number | string
  area_m2: number
  ceiling_m: number
}

export interface HpState {
  power_kw: number
  cop: number
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
  total_demand: number
  outdoor_temp: number
  recovery_time_hours: number
  capacity_pct: number
  hp_capacity_kw: number
  min_load_pct: number
  hp: HpState
  rooms_total: number
  rooms_below_target: number
  comfort_pct: number
  energy: EnergyState
  away: { active: boolean; days: number }
  engineering: EngineeringState
  source_selection?: SourceSelectionState
  migration_pending?: boolean
  driver?: DriverStatus
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
    total_demand: number
    outdoor_temp: number
    recovery_time_hours: number
    per_room_ttc?: Record<string, number>
    capacity_pct: number
    hp_capacity_kw: number
    min_load_pct: number
    hp_power_kw: number
    hp_cop: number
    comfort_pct: number
  }
  hp?: {
    flow_temp: number
    return_temp: number
    delta_t: number
    flow_rate: number
  }
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
