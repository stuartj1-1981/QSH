import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import { useLive } from '../hooks/useLive'
import { useStatus } from '../hooks/useStatus'
import { useHistory } from '../hooks/useHistory'
import { useRawConfig } from '../hooks/useConfig'
import type { RoomState } from '../types/api'
import { StatusBanner } from '../components/StatusBanner'
import { SourceSelector } from '../components/SourceSelector'
import { useSourceSelection } from '../hooks/useSourceSelection'
import { RoomCard } from '../components/RoomCard'
import { TodaySummary } from '../components/TodaySummary'
import { EngineeringBar } from '../components/EngineeringBar'
import { ComfortControl } from '../components/ComfortControl'
import { FlowLimits } from '../components/FlowLimits'
import { TrendChart } from '../components/TrendChart'
import { OperatingStateTimeline } from '../components/OperatingStateTimeline'
import { SystemHealth } from '../components/SystemHealth'
import { Wifi, WifiOff, Plane, Home as HomeIcon, Info } from 'lucide-react'
import { useAwayState, useSetAway } from '../hooks/useAway'
import { apiUrl } from '../lib/api'
import { buildEntityMap } from '../hooks/entityMap'

type Page = 'home' | 'rooms' | 'settings' | 'wizard' | 'schedule' | 'away' | 'engineering' | 'historian'

// Module-level constants — stable references for React.memo
const FLOW_LINES = [
  { key: 'applied_flow', label: 'Applied', color: 'var(--accent)' },
  { key: 'optimal_flow', label: 'Optimal', color: 'var(--blue)' },
]

const DEMAND_LINES = [
  { key: 'total_demand', label: 'Demand', color: 'var(--amber)' },
]

interface HomeProps {
  engineering: boolean
  onNavigate?: (page: Page) => void
}

export function Home({ engineering, onNavigate }: HomeProps) {
  const { data: live, isConnected } = useLive()
  const { data: initial } = useStatus()
  const { data: awayData, refetch: refetchAway } = useAwayState()
  const { setAway } = useSetAway()
  // Optimistic away-off state — true after "I'm Home" click, clears on server confirm.
  const [optimisticAwayOff, setOptimisticAwayOff] = useState(false)

  // Polling ref — typed for setInterval return. Null = no active poll.
  const homePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup polling on unmount — prevents stale refetch/setState on navigation.
  useEffect(() => {
    return () => { if (homePollRef.current) clearInterval(homePollRef.current) }
  }, [])

  // Clear poll and reset optimistic flag once server confirms away is off.
  // Without the reset, re-activating away in the same session would be suppressed
  // because the gate (awayData.active && !optimisticAwayOff) would stay false.
  // Predicate: optimisticAwayOff is true AND server awayData.whole_house.active === false.
  useEffect(() => {
    if (optimisticAwayOff && awayData?.whole_house.active === false) {
      if (homePollRef.current) { clearInterval(homePollRef.current); homePollRef.current = null }
      setOptimisticAwayOff(false)
    }
  }, [awayData?.whole_house.active, optimisticAwayOff])

  const [saving, setSaving] = useState(false)
  const { data: sourceSelection, setMode: setSourceMode, setPreference: setSourcePreference } = useSourceSelection(
    live?.source_selection ?? undefined
  )

  const handleImHome = async () => {
    setOptimisticAwayOff(true)
    await setAway({ active: false })
    // Poll every 5s for up to 60s until pipeline confirms away is off
    if (homePollRef.current) clearInterval(homePollRef.current)
    let attempts = 0
    homePollRef.current = setInterval(() => {
      attempts++
      refetchAway()
      if (attempts >= 12) {
        if (homePollRef.current) { clearInterval(homePollRef.current); homePollRef.current = null }
        setOptimisticAwayOff(false)  // Failsafe: restore button so user can retry
      }
    }, 5000)
  }

  // Use WebSocket data when available, fall back to REST
  const status = live?.status
  const rooms = live?.rooms
  const energy = live?.energy
  const eng = live?.engineering
  const cycleNumber = live?.cycle_number ?? initial?.cycle_number ?? 0

  // Derive values for display
  const operatingState = status?.operating_state ?? initial?.operating_state ?? 'Connecting...'
  const controlEnabled = status?.control_enabled ?? initial?.control_enabled ?? false
  const comfortTemp = status?.comfort_temp ?? initial?.comfort_temp ?? 21.0
  const appliedFlow = status?.applied_flow ?? initial?.applied_flow ?? 0
  const appliedMode = status?.applied_mode ?? initial?.applied_mode ?? 'off'
  const outdoorTemp = status?.outdoor_temp ?? initial?.outdoor_temp ?? 0
  const hpPowerKw = status?.hp_power_kw ?? initial?.hp?.power_kw ?? 0
  const hpCop = status?.hp_cop ?? initial?.hp?.cop ?? 0

  const recoveryTimeHours = status?.recovery_time_hours ?? initial?.recovery_time_hours ?? 0
  const capacityPct = status?.capacity_pct ?? initial?.capacity_pct ?? 0
  const minLoadPct = status?.min_load_pct ?? initial?.min_load_pct ?? 0
  const comfortScheduleActive = status?.comfort_schedule_active ?? initial?.comfort_schedule_active ?? false
  const comfortTempActive = status?.comfort_temp_active ?? initial?.comfort_temp_active ?? comfortTemp
  const optimalMode = status?.optimal_mode ?? initial?.optimal_mode

  const costToday = energy?.cost_today_pence ?? initial?.energy?.cost_today_pence ?? 0
  const costYesterday = energy?.cost_yesterday_pence
  const energyToday = energy?.energy_today_kwh ?? initial?.energy?.energy_today_kwh ?? 0
  const currentRate = energy?.current_rate ?? initial?.energy?.current_rate ?? 0
  const predictedSaving = energy?.predicted_saving ?? initial?.energy?.predicted_saving
  const predictedEnergySaving = energy?.predicted_energy_saving

  const displayRooms: Record<string, RoomState> | undefined = rooms

  const handleComfortTempChange = useCallback(async (value: number) => {
    setSaving(true)
    try {
      await fetch(apiUrl('api/control/comfort-temp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    } finally {
      setSaving(false)
    }
  }, [])

  const handleControlModeChange = useCallback(async (enabled: boolean) => {
    await fetch(apiUrl('api/control/mode'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
  }, [])

  // Flow limits — sourced from config, not WebSocket
  const { data: configData, refetch: refreshConfig } = useRawConfig()
  const flowMin = configData?.flow_min_internal ?? configData?.heat_source?.flow_min ?? null
  const flowMax = configData?.flow_max_internal ?? configData?.heat_source?.flow_max ?? null
  const entityMap = useMemo(() => buildEntityMap(configData), [configData])

  const handleFlowMinChange = useCallback(async (value: number) => {
    await fetch(apiUrl('api/control/flow-min'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    refreshConfig()
  }, [refreshConfig])

  const handleFlowMaxChange = useCallback(async (value: number) => {
    await fetch(apiUrl('api/control/flow-max'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    refreshConfig()
  }, [refreshConfig])

  return (
    <div className="max-w-4xl">
      {/* Connection indicator */}
      <div className="flex items-center gap-2 mb-3 text-xs text-[var(--text-muted)]">
        {isConnected ? (
          <>
            <Wifi size={14} className="text-[var(--green)]" />
            <span>Live</span>
          </>
        ) : (
          <>
            <WifiOff size={14} className="text-[var(--red)]" />
            <span>Reconnecting...</span>
          </>
        )}
      </div>

      {/* Migration banner — existing installs missing telemetry/disclaimer */}
      {initial?.migration_pending && (
        <div className="mb-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                New in this version: Fleet data sharing and beta disclaimer
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Please review the new data sharing options in Settings. QSH continues to
                operate normally — no data is shared until you opt in.
              </p>
              <button
                onClick={() => onNavigate?.('settings')}
                className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Go to Settings →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status banner */}
      <StatusBanner
        operatingState={operatingState}
        controlEnabled={controlEnabled}
        appliedFlow={appliedFlow}
        appliedMode={appliedMode}
        outdoorTemp={outdoorTemp}
        hpPowerKw={hpPowerKw}
        hpCop={hpCop}
        optimalMode={optimalMode}
        boostActive={live?.boost?.active}
        boostRoomCount={live?.boost?.rooms ? Object.keys(live.boost.rooms).length : 0}
        rooms={rooms}
        entityMap={entityMap ?? undefined}
        engineering={engineering}
        driverStatus={initial?.driver}
      />

      {/* Comfort temperature & shadow/live toggle */}
      <ComfortControl
        comfortTemp={comfortTemp}
        controlEnabled={controlEnabled}
        saving={saving}
        awayActive={awayData?.whole_house.active && !optimisticAwayOff}
        awayDays={awayData?.whole_house.days_remaining ?? awayData?.whole_house.days}
        comfortScheduleActive={comfortScheduleActive}
        comfortTempActive={comfortTempActive}
        onComfortTempChange={handleComfortTempChange}
        onControlModeChange={handleControlModeChange}
      />

      {/* Flow limits — min/max flow temperature steppers */}
      <FlowLimits
        flowMin={flowMin}
        flowMax={flowMax}
        onFlowMinChange={handleFlowMinChange}
        onFlowMaxChange={handleFlowMaxChange}
        entityIds={entityMap ? { flow_min: entityMap.flow_min, flow_max: entityMap.flow_max } : undefined}
        engineering={engineering}
      />

      {/* System health — recovery time + capacity bar */}
      <SystemHealth
        recoveryTimeHours={recoveryTimeHours}
        capacityPct={capacityPct}
        minLoadPct={minLoadPct}
        operatingState={operatingState}
      />

      {/* Source selection panel (multi-source only) */}
      {sourceSelection && sourceSelection.sources && sourceSelection.sources.length > 1 && (
        <SourceSelector
          sourceSelection={sourceSelection}
          onModeChange={setSourceMode}
          onPreferenceChange={setSourcePreference}
        />
      )}

      {/* Engineering bar */}
      {engineering && eng && (
        <EngineeringBar
          cycleNumber={cycleNumber}
          detFlow={eng.det_flow}
          rlFlow={eng.rl_flow}
          rlBlend={eng.rl_blend}
          rlReward={eng.rl_reward}
          shoulderMonitoring={eng.shoulder_monitoring}
          summerMonitoring={eng.summer_monitoring}
          antifrostOverrideActive={eng.antifrost_override_active ?? false}
          winterEquilibrium={eng.winter_equilibrium ?? false}
          antifrostThreshold={eng.antifrost_threshold ?? 7.0}
        />
      )}

      {/* Away quick actions */}
      <div className="flex gap-2 mb-4">
        {awayData?.whole_house.active && !optimisticAwayOff ? (
          <button
            onClick={handleImHome}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 text-sm font-medium hover:bg-green-500/20"
          >
            <HomeIcon size={16} />
            I'm Home
          </button>
        ) : (
          <button
            onClick={() => onNavigate?.('away')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)]"
          >
            <Plane size={16} />
            Going Away
          </button>
        )}
      </div>

      {/* Room mini-cards */}
      {displayRooms && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {Object.entries(displayRooms).map(([name, room]) => (
            <RoomCard key={name} name={name} room={room} boost={live?.boost?.rooms?.[name]} entityIds={entityMap?.rooms[name]} engineering={engineering} />
          ))}
        </div>
      )}

      {/* Today's summary */}
      <TodaySummary
        costTodayPence={costToday}
        costYesterdayPence={costYesterday}
        energyTodayKwh={energyToday}
        currentRate={currentRate}
        predictedSaving={controlEnabled ? undefined : predictedSaving}
        predictedEnergySaving={controlEnabled ? undefined : predictedEnergySaving}
      />

      {/* Operating state timeline — visible to all users */}
      <HomeStateTimeline />

      {/* Engineering trend charts */}
      {engineering && <HomeTrends />}
    </div>
  )
}

const HomeStateTimeline = memo(function HomeStateTimeline() {
  const { data: stateData } = useHistory(['operating_state'], 24)
  return <OperatingStateTimeline data={stateData} hours={24} />
})

const HomeTrends = memo(function HomeTrends() {
  const { data: flowData } = useHistory(['applied_flow', 'optimal_flow'], 24)
  const { data: demandData } = useHistory(['total_demand'], 24)

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-2">TRENDS (24h)</h3>
      <TrendChart
        title="Flow Temperature"
        data={flowData}
        lines={FLOW_LINES}
        yUnit="°C"
      />
      <TrendChart
        title="Total Demand"
        data={demandData}
        lines={DEMAND_LINES}
        yUnit="kW"
      />
    </div>
  )
})
