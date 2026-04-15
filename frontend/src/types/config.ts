/** TypeScript types for QSH configuration shapes. */

export type Driver = 'ha' | 'mqtt'

export interface MqttTopicInput {
  topic: string
  format?: 'plain' | 'json'
  json_path?: string
  scale?: number
  offset?: number
}

export interface MqttConfig {
  broker: string
  port: number
  username?: string
  password?: string
  client_id?: string
  tls?: boolean
  topic_prefix?: string
  inputs: Record<string, MqttTopicInput>
  outputs?: {
    flow_temp?: string
    mode?: string
    heat_source_command?: string
  }
}

export type RoomMqttTopicValue = string | MqttTopicInput

export interface RoomMqttTopics {
  room_temp: RoomMqttTopicValue
  valve_position?: RoomMqttTopicValue
  valve_setpoint?: string
  trv_setpoint?: string
  occupancy_sensor?: string
}

export interface RoomConfigYaml {
  area_m2: number
  facing?: string
  ceiling_m?: number
  emitter_kw?: number
  emitter_type?: 'radiator' | 'ufh' | 'fan_coil'
  trv_entity?: string | string[]
  independent_sensor?: string
  heating_entity?: string
  control_mode?: 'indirect' | 'direct' | 'none'
  valve_hardware?: 'direct_type1' | 'direct_type2' | 'generic'
  valve_scale?: number
  trv_name?: string
  mqtt_topics?: RoomMqttTopics
  occupancy_sensor?: string
  occupancy_debounce?: number
  occupancy_fallback?: 'schedule' | 'occupied' | 'last_known'
  last_known_timeout_s?: number

  // Per-zone away internal values (36C — N3)
  away_active_internal?: boolean
  away_days_internal?: number
}

export interface HeatSourceYaml {
  name?: string
  type: 'heat_pump' | 'gas_boiler' | 'oil_boiler' | 'lpg_boiler'
  efficiency?: number
  min_output_kw?: number
  flow_min?: number
  flow_max?: number
  flow_min_entity?: string
  flow_max_entity?: string
  fuel_cost_per_kwh?: number
  fuel_cost_entity?: string
  carbon_factor?: number
  carbon_factor_entity?: string
  flow_control?: {
    method?: 'ha_service' | 'mqtt' | 'entity'
    domain?: string
    service?: string
    entity_id?: string
    topic?: string
    mode_topic?: string
    flow_entity?: string
    mode_entity?: string
    base_data?: Record<string, unknown>
  }
  on_off_control?: {
    domain?: string
    service?: string
    entity_id?: string
    device_id?: string
  }
  pump_control?: {
    method?: 'mqtt' | 'ha_service'
    topic?: string
    entity_id?: string
    max_speed_pct?: number
  }
  sensors?: {
    flow_temp?: string
    power_input?: string
    heat_output?: string
    total_energy?: string
    cop?: string
    delta_t?: string
    return_temp?: string
    flow_rate?: string
    water_heater?: string
    pump_power?: string
  }
}

export interface SourceSelectionYaml {
  mode: 'auto' | string
  preference: number
  min_dwell_minutes: number
  score_deadband_pct: number
  max_switches_per_day: number
}

export interface OutdoorYaml {
  temperature?: string
  weather_forecast?: string
}

export interface OctopusYaml {
  api_key?: string
  account_number?: string
  hp_euid?: string
  zone_entity_id?: string
  rates?: {
    current_day?: string
    next_day?: string
    current_day_export?: string
    next_day_export?: string
  }
}

export interface EnergyYaml {
  octopus?: OctopusYaml
  fixed_rates?: {
    import_rate?: number
    export_rate?: number
  }
  fallback_rates?: {
    cheap?: number
    standard?: number
    peak?: number
    export?: number
  }
}

export interface ThermalYaml {
  peak_loss_kw?: number
  peak_external_temp?: number
  thermal_mass_per_m2?: number
  heat_up_tau_h?: number
  overtemp_protection?: number
  persistent_zones?: string[]
}

export interface OccupancyScheduleYaml {
  schedule?: string | { weekday?: string; weekend?: string }
}

export interface ControlYaml {
  dfan_control_entity?: string
  pid_target_entity?: string
  dfan_control_topic?: string
  pid_target_topic?: string
  nudge_budget?: number
}

export interface BatteryYaml {
  soc_entity?: string
  soc_topic?: string
  min_soc_reserve?: number
  efficiency?: number
  voltage?: number
  max_rate_kw?: number
}

export interface GridYaml {
  power_entity?: string
  power_topic?: string
  nominal_voltage?: number
  min_voltage?: number
  max_voltage?: number
}

export interface InverterYaml {
  fallback_efficiency?: number
}

export interface SolarYaml {
  production_entity?: string
  production_topic?: string
}

export interface HwScheduleYaml {
  source?: 'entity' | 'fixed'
  entity_id?: string
  attribute_name?: string
  fixed_start_time?: string
}

export interface HwTankYaml {
  volume_litres?: number
  target_temperature?: number
  water_heater_entity?: string
  sensor_top?: string
  sensor_bottom?: string
}

export interface HwPrechargeYaml {
  enabled?: boolean
  factor?: number
  lead_minutes?: number
  min_cycle_minutes?: number
}

export interface HistorianYaml {
  enabled?: boolean
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  batch_size?: number
  flush_interval_s?: number
}

export interface ShoulderYaml {
  forecast_horizon_hours?: number
}

export interface SummerYaml {
  demand_threshold_kw?: number
}

export type HwPlanType = 'W' | 'Y' | 'S' | 'S+' | 'C' | 'Combi'

export interface TelemetryYaml {
  agreed?: boolean
  install_id?: string
  api_token?: string | null
  region?: string
  endpoint?: string
}

export interface QshConfigYaml {
  driver?: 'ha' | 'mqtt'
  rooms?: Record<string, RoomConfigYaml>
  mqtt?: MqttConfig
  heat_source?: HeatSourceYaml
  heat_sources?: HeatSourceYaml[]
  source_selection?: SourceSelectionYaml
  outdoor?: OutdoorYaml
  energy?: EnergyYaml
  thermal?: ThermalYaml
  control?: ControlYaml
  occupancy?: Record<string, OccupancyScheduleYaml> & {
    sensor_debounce_s?: number
    sensor_mode?: 'sensor_priority' | 'schedule_priority' | 'either' | 'sensor_only'
  }
  shoulder?: ShoulderYaml
  summer?: SummerYaml
  solar?: SolarYaml
  battery?: BatteryYaml
  grid?: GridYaml
  inverter?: InverterYaml
  cascade?: Record<string, unknown>
  historian?: HistorianYaml
  hw_plan?: HwPlanType
  hw_schedule?: HwScheduleYaml
  hw_tank?: HwTankYaml
  hw_precharge?: HwPrechargeYaml
  telemetry?: TelemetryYaml
  disclaimer_accepted?: boolean

  // Internal value overrides (36C — HA helper decoupling)
  flow_min_internal?: number
  flow_max_internal?: number
  dfan_control_internal?: boolean
  pid_target_internal?: number
  publish_mqtt_shadow?: boolean
}

/** Entity candidate returned by the wizard scan endpoint. */
export interface EntityCandidate {
  entity_id: string
  friendly_name: string
  score: number
  /** Operator-facing confidence label derived from `score` in the backend.
   * high    — near-perfect match (score >= 25), auto-highlighted in the UI.
   * medium  — likely match (score 15-24).
   * low     — possible match (score < 15), present but not suggested. */
  confidence: 'high' | 'medium' | 'low'
  state: string
  device_class: string
  unit: string
}

/** Response from POST /api/wizard/scan-entities */
export interface ScanEntitiesResponse {
  candidates: Record<string, EntityCandidate[]>
  total_entities: number
}

/** Response from POST /api/wizard/scan-entities/{room} */
export interface ScanRoomResponse {
  room: string
  candidates: Record<string, EntityCandidate[]>
}

/** Response from POST /api/wizard/validate */
export interface ValidationResponse {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** Response from POST /api/wizard/deploy */
export interface DeployResponse {
  deployed: boolean
  yaml_path: string
  message: string
  warnings: string[]
}

/** Response from POST /api/wizard/test-octopus (INSTRUCTION-90E direction filter). */
export interface OctopusTestResponse {
  success: boolean
  message: string
  /** Primary import tariff — null when the account has no import meter point. */
  tariff_code?: string | null
  /** Extra import tariffs beyond the primary (Economy 7 day/night, dual-MPAN).
   *  Empty array when the account has a single import meter point. */
  additional_import_tariffs?: string[]
  /** Outgoing / export tariff code, informational. null when none. */
  export_tariff?: string | null
  account_number?: string
}

/** Response from POST /api/config/test-influxdb */
export interface InfluxTestResponse {
  success: boolean
  message: string
}

/** Response from POST /api/wizard/test-mqtt */
export interface MqttTestResponse {
  success: boolean
  message: string
  broker_version?: string
}

/** Envelope-level metadata returned by POST /api/wizard/scan-mqtt-topics (INSTRUCTION-93B). */
export interface MqttScanMeta {
  started_at: number
  duration_s: number
  window_seconds: number
  total_topics: number
  partial_topics: number
}

/** Topic discovered by POST /api/wizard/scan-mqtt-topics */
export interface MqttTopicCandidate {
  topic: string
  payload: string
  is_numeric: boolean
  suggested_field?: string | null
  suggested_room?: string | null
  // INSTRUCTION-93B — optional so legacy backends still type-check:
  payloads_seen?: number
  aggregated_payload?: string | null
  retained?: boolean
  scan_completeness?: 'retained' | 'heartbeat' | 'partial'
  suggested_fields_per_key?: Record<string, string> | null
}

/** Response from POST /api/wizard/scan-mqtt-topics */
export interface MqttScanResponse {
  topics: MqttTopicCandidate[]
  scan_meta?: MqttScanMeta // INSTRUCTION-93B — optional for legacy-shape compatibility
}

/** FACING options */
export const FACING_OPTIONS = [
  'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'interior',
] as const

export type Facing = (typeof FACING_OPTIONS)[number]

/** Entity IDs for external setpoint overrides. Empty string = use internal value. */
export interface ExternalSetpoints {
  comfort_temp: string
  flow_min_temp: string
  flow_max_temp: string
  antifrost_oat_threshold: string
  shoulder_threshold: string
  overtemp_protection: string
}

/**
 * Valid ranges for setpoints that this component manages.
 * Used for amber out-of-range warnings on resolved entity values.
 * Enforcement is NOT done here — this is display-only.
 */
export const SETPOINT_RANGES: Record<string, { min: number; max: number; unit: string; label: string; placeholder: string }> = {
  comfort_temp:            { min: 15,  max: 25,  unit: '°C', label: 'Comfort Temperature',              placeholder: 'input_number.comfort_temp' },
  flow_min_temp:           { min: 20,  max: 45,  unit: '°C', label: 'Flow Minimum Temperature Entity',  placeholder: 'input_number.flow_min_temp' },
  flow_max_temp:           { min: 30,  max: 60,  unit: '°C', label: 'Flow Maximum Temperature Entity',  placeholder: 'input_number.flow_max_temp' },
  antifrost_oat_threshold: { min: 0,   max: 15,  unit: '°C', label: 'Antifrost OAT Threshold',          placeholder: 'input_number.antifrost_oat_threshold' },
  shoulder_threshold:      { min: 0.5, max: 10,  unit: 'kW', label: 'Shoulder Shutdown Threshold',      placeholder: 'input_number.shoulder_threshold' },
  overtemp_protection:     { min: 18,  max: 30,  unit: '°C', label: 'Overtemp Protection',              placeholder: 'input_number.overtemp_protection' },
} as const
