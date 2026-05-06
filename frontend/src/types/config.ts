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
  room_temp?: RoomMqttTopicValue
  valve_position?: RoomMqttTopicValue
  valve_setpoint?: string
  trv_setpoint?: string
  occupancy_sensor?: string
}

/** Boundary referencing another room (INSTRUCTION-106A/B).
 *  `floor_ceiling` is auto-set when a floor or ceiling face references a room;
 *  the UI does not offer it as a user-selectable option on wall faces. */
export interface RoomBoundaryYaml {
  room: string
  type?: 'wall' | 'open' | 'party' | 'floor_ceiling'
}

/** Face value — a reserved literal (per-face) or a RoomBoundaryYaml (scalar or array). */
export type FaceValue = 'external' | 'ground' | 'roof' | 'unheated' | RoomBoundaryYaml | RoomBoundaryYaml[]

/** Normalise a face value to an array of room refs. String literals and null return []. */
export function normaliseFaceRefs(face: FaceValue | null | undefined): RoomBoundaryYaml[] {
  if (face == null || typeof face === 'string') return []
  if (Array.isArray(face)) return face
  return [face]
}

/** True when a face value contains at least one room reference.
 *  NOTE: Empty arrays should not exist (backend validates against them),
 *  but the check is defensive for intermediate editing states. */
export function hasRoomRefs(face: FaceValue | null | undefined): boolean {
  if (face == null || typeof face === 'string') return false
  if (Array.isArray(face)) return face.length > 0
  return 'room' in face
}

/** True when a face value is a single RoomBoundaryYaml (not array, not string). */
export function isSingleRoomRef(face: FaceValue | null | undefined): face is RoomBoundaryYaml {
  return !!face && typeof face === 'object' && !Array.isArray(face) && 'room' in face
}

export interface RoomEnvelopeYaml {
  north_wall?: FaceValue | null
  east_wall?: FaceValue | null
  south_wall?: FaceValue | null
  west_wall?: FaceValue | null
  floor?: FaceValue | null
  ceiling?: FaceValue | null
}

/** Per-room boolean output (INSTRUCTION-131A schema, exposed via 162A).
 *  Validation rules live in qsh.config.validate_auxiliary_output_block on
 *  the backend; the frontend mirrors them client-side via AuxOutputEditor. */
export interface AuxiliaryOutputYaml {
  enabled?: boolean
  ha_entity?: string | null
  mqtt_topic?: string | null
  rated_kw?: number
  min_on_time_s?: number
  min_off_time_s?: number
  max_cycles_per_hour?: number
}

export interface RoomConfigYaml {
  area_m2: number
  facing?: string
  ceiling_m?: number
  /** Storey index (−1 basement, 0 ground, 1 first, ...). */
  floor?: number
  /** 6-face room envelope. */
  envelope?: RoomEnvelopeYaml
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
  /** Per-room auxiliary boolean output (INSTRUCTION-131A schema). */
  auxiliary_output?: AuxiliaryOutputYaml | null

  /** INSTRUCTION-172 — per-room absolute target override for monitor-only
   *  zones with manual TRVs. Range [10.0, 25.0] °C. Backend rejects unless
   *  `control_mode === 'none'`. */
  fixed_setpoint?: number

  // Per-zone away internal values (36C — N3)
  away_active_internal?: boolean
  away_days_internal?: number
}

/** Response from PATCH /api/rooms/envelope (INSTRUCTION-106A). */
export interface EnvelopePatchResponse {
  updated: string[]
  warnings: string[]
  restart_required: boolean
}

/** Response from POST/PUT /api/rooms/{name} (INSTRUCTION-162A).
 *  `created` is set on POST, `updated` on PUT. `warnings` always present
 *  (empty list when nothing fired). */
export interface RoomCrudResponse {
  created?: string
  updated?: string
  restart_required: boolean
  warnings: string[]
}

/** 422 detail shape when auxiliary_output validation fails (INSTRUCTION-162A).
 *  Other 422 paths still return `detail: string` per the existing convention;
 *  discriminate via `typeof detail === 'object' && detail.kind === 'aux'`. */
export interface AuxValidationErrorDetail {
  errors: string[]
  warnings: string[]
  kind: 'aux'
}

export interface HeatSourceYaml {
  name?: string
  type: 'heat_pump' | 'gas_boiler' | 'oil_boiler' | 'lpg_boiler'
  efficiency?: number
  min_output_kw?: number
  // INSTRUCTION-154C: nameplate rated capacity (kW). Heat pumps:
  // electrical input. Boilers: fuel input. Powers fleet telemetry's
  // heat_pump.declared_output_kw column.
  capacity_kw?: number
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
    hot_water_boolean?: string
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

// INSTRUCTION-150E: Per-fuel tariff config types. Wizard / Settings build
// these and PATCH /api/config; backend's migrate-on-save (150C) strips
// any legacy keys.
// INSTRUCTION-158C: + 'ha_entity' for HA-brokered rates (Octopus HACS
// integration et al). The matching ElectricityTariffConfig.rates_entity
// holds the HA entity ID; no API key required.
export type ElectricityProviderKind = 'octopus' | 'edf_freephase' | 'fixed' | 'ha_entity'
export type GasProviderKind = 'octopus' | 'fixed'

export interface ElectricityTariffConfig {
  provider: ElectricityProviderKind
  octopus_api_key?: string
  octopus_account_number?: string
  octopus_tariff_code?: string
  edf_region?: string     // A-P
  fixed_rate?: number
  rates_entity?: string        // 158C: HA-brokered rates path (current day)
  rates_entity_next?: string   // 159C: HA-brokered rates path (next day, optional). Concatenated with rates_entity by the HA driver per 159B Task 5.
}

export interface GasTariffConfig {
  provider: GasProviderKind
  octopus_api_key?: string
  octopus_account_number?: string
  octopus_tariff_code?: string
  fixed_rate?: number
}

export interface FixedOnlyTariffConfig {
  provider: 'fixed'
  fixed_rate: number
}

// INSTRUCTION-136A Task 6: tariff aggression mode + thresholds.
export type TariffAggressionMode = 'comfort' | 'optimise' | 'aggressive'

export interface TariffAggressionConfig {
  comfort_threshold?: number
  optimise_threshold?: number
  aggressive_threshold?: number
  preheat_lookahead_hours?: number
  overshoot_guard_c?: number
  sysid_immaturity_fallback_fraction?: number
  u_maturity_observations?: number
  c_maturity_observations?: number
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
  // INSTRUCTION-150E: per-fuel provider configs. Optional during the
  // 150C migrate-on-save rollout window.
  electricity?: ElectricityTariffConfig
  gas?: GasTariffConfig
  lpg?: FixedOnlyTariffConfig
  oil?: FixedOnlyTariffConfig
  // INSTRUCTION-136A Task 6: aggression slider state.
  tariff_aggression_mode?: TariffAggressionMode
  tariff_aggression?: TariffAggressionConfig
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

/** 409 destructive-deploy refusal — wizard config would remove top-level
 *  sections from the on-disk YAML. Surface a Force Deploy affordance.
 *  See INSTRUCTION-137 Task 3. */
export interface DestructiveDeployError {
  kind: 'destructive'
  removed_sections: string[]
  existing_sections: string[]
  incoming_sections: string[]
}

export function isDestructiveDeployError(
  v: DeployResponse | DestructiveDeployError | null
): v is DestructiveDeployError {
  return !!v && (v as DestructiveDeployError).kind === 'destructive'
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
  /** INSTRUCTION-150C: gas tariff code discovered alongside electricity
   *  on the same Octopus account. null when no gas meter is registered. */
  gas_tariff_code?: string | null
}

/** Response from POST /api/wizard/persist-octopus-tariff-codes
 *  (INSTRUCTION-174). Auto-persists tariff codes discovered by
 *  POST /test-octopus directly to YAML. */
export interface PersistOctopusTariffCodesResponse {
  persisted: { electricity: boolean; gas: boolean }
  restart_required: boolean
  message: string
}

/** Response from POST /api/wizard/test-edf-region (INSTRUCTION-150D Task 5
 *  — backend route owned by 150D; 150E is the frontend consumer). */
export interface TestEdfRegionResponse {
  success: boolean
  message: string
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
