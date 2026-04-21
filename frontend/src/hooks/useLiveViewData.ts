import { useMemo, useEffect, useState } from 'react'
import { useLive } from './useLive'
import { useSysid } from './useSysid'
import { apiUrl } from '../lib/api'
import { parseOperatingState } from '../lib/parseOperatingState'
import type { LiveViewData, LiveViewRoom, LiveViewSource, LiveViewDHW } from '../lib/liveViewTypes'
import type { HwPlanType } from '../types/config'

export function useLiveViewData(): {
  data: LiveViewData | null
  isConnected: boolean
} {
  const { data: live, isConnected } = useLive()
  const { data: sysid } = useSysid()
  const [hwPlan, setHwPlan] = useState<HwPlanType>('W')

  // Fetch hw_plan once on mount
  useEffect(() => {
    fetch(apiUrl('api/config'))
      .then(r => r.json())
      .then(cfg => {
        if (cfg?.hw_plan) setHwPlan(cfg.hw_plan)
      })
      .catch(() => { /* hw_plan defaults to 'W' */ })
  }, [])

  const data = useMemo<LiveViewData | null>(() => {
    if (!live) return null

    // Build rooms array from CycleMessage.rooms + sysid U-values
    const rooms: LiveViewRoom[] = Object.entries(live.rooms ?? {}).map(([id, r]) => ({
      id,
      name: id,
      temp: r.temp ?? 0,
      target: r.target ?? 0,
      valve: r.valve ?? 0,
      area: r.area_m2 ?? 10,
      u: sysid?.rooms?.[id]?.u_kw_per_c ?? 0.15,
      status: r.status ?? 'ok',
    }))

    // Parse operating state
    const state = parseOperatingState(live.status?.operating_state)

    // Determine source appearance
    const sourceSelection = live.source_selection
    let source: LiveViewSource
    if (sourceSelection) {
      const activeSrc = sourceSelection.sources.find(
        s => s.name === sourceSelection.active_source
      )
      const srcType = activeSrc?.type ?? 'heat_pump'
      source = {
        type: (srcType === 'heat_pump' || srcType === 'gas_boiler' ||
               srcType === 'lpg_boiler' || srcType === 'oil_boiler')
          ? srcType : 'heat_pump',
        name: sourceSelection.active_source,
        isMultiSource: true,
      }
    } else {
      source = { type: 'heat_pump', name: 'heat_pump', isMultiSource: false }
    }

    // DHW config
    const hasCylinder = hwPlan !== 'C' && hwPlan !== 'Combi'
    const dhw: LiveViewDHW = { hwPlan, hasCylinder }

    // INSTRUCTION-117E Task 6b: read source-portable power + performance
    // from the WS status.heat_source block. `cop` is populated only on HP
    // installs; on boilers the performance value is η and semantically
    // not a COP — the 3D view's legacy field is left at 0 so nothing
    // downstream renders a misleading COP figure.
    const hs = live.status?.heat_source
    const isHp = hs?.type === 'heat_pump'
    return {
      rooms,
      hp: {
        power_kw: hs?.input_power_kw ?? 0,
        capacity_kw: live.status?.hp_capacity_kw ?? 8.0,
        cop: isHp ? hs?.performance.value ?? 0 : 0,
        flow_temp: hs?.flow_temp ?? 0,
        return_temp: hs?.return_temp ?? 0,
        outdoor_temp: live.status?.outdoor_temp ?? 0,
      },
      state,
      source,
      dhw,
    }
  }, [live, sysid, hwPlan])

  return { data, isConnected }
}
