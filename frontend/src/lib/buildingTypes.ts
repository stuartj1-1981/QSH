/** Live data pushed to the engine every 30s cycle. */
export interface BuildingLiveData {
  rooms: Record<string, {
    temp: number | null
    target: number | null
    valve: number
    status: string
  }>
  system: {
    outdoor_temp: number
    flow_temp: number
    return_temp: number
    delta_t: number
    power_kw: number
    cop: number
    mode: string
  }
  cycle_number: number
}

/** View modes supported by the engine. */
export type BuildingViewMode = '3d' | 'exploded' | 'thermal' | 'envelope'
