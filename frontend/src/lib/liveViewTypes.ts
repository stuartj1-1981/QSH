/** Parsed operating state — derived from CycleSnapshot.operating_state string */
export interface LiveViewState {
  season: 'winter' | 'shoulder' | 'summer' | 'shadow'
  strategy:
    | 'heating'
    | 'equilibrium'
    | 'hw'
    | 'cycle_pause'
    | 'monitoring'
    | 'shadow'
  hwState: 'pre_charge' | 'hw_active' | 'recovery' | null
  cyclePause: 'defrost' | 'oil_recovery' | 'short_cycle' | null
  label: string
}

/** Room data as needed by the renderer */
export interface LiveViewRoom {
  id: string
  name: string
  temp: number
  target: number
  valve: number // 0-100
  area: number // m2, for node sizing
  u: number // kW/C, for wall leak scaling (from sysid)
  status: string // 'ok' | 'heating' | 'cold' | 'away' | ...
}

/** Heat source appearance */
export interface LiveViewSource {
  type: 'heat_pump' | 'gas_boiler' | 'lpg_boiler' | 'oil_boiler'
  name: string
  isMultiSource: boolean
}

/** DHW configuration — determines cylinder visibility and behaviour */
export interface LiveViewDHW {
  hwPlan: 'W' | 'Y' | 'S' | 'S+' | 'C' | 'Combi'
  hasCylinder: boolean // derived: !(C or Combi)
}

/** Complete data snapshot for one render frame */
export interface LiveViewData {
  rooms: LiveViewRoom[]
  hp: {
    power_kw: number
    capacity_kw: number
    cop: number
    flow_temp: number
    return_temp: number
    outdoor_temp: number
  }
  state: LiveViewState
  source: LiveViewSource
  dhw: LiveViewDHW
}
