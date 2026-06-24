import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import { useLive } from '../hooks/useLive'
import { useStatus } from '../hooks/useStatus'
import { useHistory } from '../hooks/useHistory'
import { useRawConfig } from '../hooks/useConfig'
import { useVersion } from '../hooks/useVersion'
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
import { useQuarantine } from '../hooks/useQuarantine'
import { useApoptosis } from '../hooks/useApoptosis'
import { apiUrl } from '../lib/api'
import { buildEntityMap } from '../hooks/entityMap'
import { formatTemp } from '../lib/utils'

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
  const { version } = useVersion()
  const { data: awayData, refetch: refetchAway } = useAwayState()
  const { setAway } = useSetAway()
  const { data: quarantine } = useQuarantine()
  const { data: apoptosis } = useApoptosis()
  // Optimistic away-off state — true after "I'm Home" click, clears on server confirm.
  const [optimisticAwayOff, setOptimisticAwayOff] = useState(false)
  // Optimistic Live/Shadow toggle — holds the user's intended value while the
  // next 30 s pipeline cycle catches up. Reconciled against the snapshot in the
  // useEffect below. null = no pending toggle; boolean = pending value.
  const [optimisticControlEnabled, setOptimisticControlEnabled] = useState<boolean | null>(null)

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
    if (optimisticAwayOff && awayData?.whole_house?.active === false) {
      if (homePollRef.current) { clearInterval(homePollRef.current); homePollRef.current = null }
      setOptimisticAwayOff(false)
    }
  }, [awayData?.whole_house?.active, optimisticAwayOff])

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
  const snapshotControlEnabled = status?.control_enabled ?? initial?.control_enabled ?? false
  // Optimistic overlay — show the pending value until the snapshot agrees,
  // then clear the overlay so genuine server-side disagreements (external
  // automation flipping the HA helper) surface to the user.
  const controlEnabled = optimisticControlEnabled ?? snapshotControlEnabled

  // Reconcile optimistic control flag against snapshot. Clear when the
  // snapshot catches up to the user's intended value.
  useEffect(() => {
    if (optimisticControlEnabled !== null && snapshotControlEnabled === optimisticControlEnabled) {
      setOptimisticControlEnabled(null)
    }
  }, [snapshotControlEnabled, optimisticControlEnabled])

  // Failsafe: clear stale optimistic flag after 90 s (3 cycles) so a
  // broken pipeline does not permanently mask the real control_enabled
  // value in the UI.
  useEffect(() => {
    if (optimisticControlEnabled === null) return
    const timer = setTimeout(() => setOptimisticControlEnabled(null), 90_000)
    return () => clearTimeout(timer)
  }, [optimisticControlEnabled])

  const [writebackUnverifiedCycles, setWritebackUnverifiedCycles] = useState(0)

  const comfortTemp = status?.comfort_temp ?? initial?.comfort_temp ?? 21.0
  const appliedFlow = status?.applied_flow ?? initial?.applied_flow ?? 0
  const appliedMode = status?.applied_mode ?? initial?.applied_mode ?? 'off'
  const readbackMismatchCount = status?.readback_mismatch_count ?? initial?.readback_mismatch_count ?? 0
  const readbackMismatchThreshold = status?.readback_mismatch_threshold ?? initial?.readback_mismatch_threshold ?? 5
  const lastReadbackMismatchAlarmTime = status?.last_readback_mismatch_alarm_time ?? initial?.last_readback_mismatch_alarm_time ?? 0
  const outdoorTemp = status?.outdoor_temp ?? initial?.outdoor_temp ?? 0
  // INSTRUCTION-117E: source-aware heat source state. WebSocket status
  // block and REST endpoint both carry `heat_source` now — read from
  // whichever is populated. Fall back to a safe placeholder shape so the
  // banner renders during the initial handshake before either has arrived.
  const heatSource = status?.heat_source ?? initial?.heat_source ?? {
    type: 'heat_pump' as const,
    input_power_kw: 0,
    thermal_output_kw: null,
    thermal_output_source: 'unknown' as const,
    performance: { value: 0, source: 'config' as const },
    flow_temp: 0,
    return_temp: 0,
    delta_t: 0,
    flow_rate: 0,
  }

  const recoveryTimeHours = status?.recovery_time_hours ?? initial?.recovery_time_hours ?? 0
  const capacityPct = status?.capacity_pct ?? initial?.capacity_pct ?? 0
  const minLoadPct = status?.min_load_pct ?? initial?.min_load_pct ?? 0
  const comfortScheduleActive = status?.comfort_schedule_active ?? initial?.comfort_schedule_active ?? false
  const comfortTempActive = status?.comfort_temp_active ?? initial?.comfort_temp_active ?? comfortTemp
  // INSTRUCTION-265 — schedule diagnostic sub-line state. Effective field is
  // optional on legacy snapshots; null collapses to the "all rooms at target"
  // branch. Tooltip surfaces only when divergence is present.
  const comfortTempEffective = status?.comfort_temp_effective ?? initial?.comfort_temp_effective ?? null
  const roomsOverriddenCount = status?.rooms_overridden_count ?? initial?.rooms_overridden_count ?? 0
  const targetTempFallbackActive = status?.target_temp_fallback_active ?? initial?.target_temp_fallback_active ?? false
  const comfortTempWritebackUnverified = status?.comfort_temp_writeback_unverified ?? initial?.comfort_temp_writeback_unverified ?? false

  useEffect(() => {
    if (comfortTempWritebackUnverified) {
      setWritebackUnverifiedCycles(c => c + 1)
    } else {
      setWritebackUnverifiedCycles(0)
    }
  }, [comfortTempWritebackUnverified, cycleNumber])

  // Prefer the live rooms dict (canonical when WebSocket is connected); fall
  // back to the REST snapshot's rooms_total count when only the initial
  // fetch has populated.
  const totalRoomsCount = rooms ? Object.keys(rooms).length : (initial?.rooms_total ?? 0)
  const hasComfortDivergence = comfortTempEffective != null && roomsOverriddenCount > 0
  // INSTRUCTION-267 — when the fallback fires, comfortTempActive carries the
  // config `comfort_temp` value (typically 20.0) rather than an operator-commanded
  // value. The display string treats it as "the default the system is currently
  // using", which is the semantically correct framing for the fallback case even
  // though the variable name still reads as "active commanded value". This is
  // the V1 LOW-1 disposition: accept the field-name semantic stretch and
  // document it here rather than introducing a parallel `configComfortTemp` hydration.
  const comfortStatusLabel = targetTempFallbackActive
    ? `No comfort temperature set — using default ${formatTemp(comfortTempActive)}. Set it via the Comfort stepper above.`
    : comfortScheduleActive
      ? (hasComfortDivergence
        ? `Schedule: ${formatTemp(comfortTempActive)} · Effective ${formatTemp(comfortTempEffective)} (${roomsOverriddenCount} of ${totalRoomsCount} rooms overridden)`
        : `Schedule: ${formatTemp(comfortTempActive)} — all rooms at target`)
      : (hasComfortDivergence
        ? `No schedule active — Comfort ${formatTemp(comfortTempActive)} · Effective ${formatTemp(comfortTempEffective)} (${roomsOverriddenCount} of ${totalRoomsCount} rooms overridden)`
        : `No schedule active — Comfort ${formatTemp(comfortTempActive)}`)
  const comfortStatusTitle = targetTempFallbackActive
    ? 'No comfort temperature is currently set on this install. The upstream driver path (HA input_number, MQTT control/comfort_temp topic, or equivalent) is not delivering a value, so the pipeline is using its configured default. Set a comfort temperature using the Comfort stepper above to clear this state.'
    : hasComfortDivergence
      ? 'Per-room overrides are pulling some rooms away from the schedule-commanded value. Possible sources:\n\n' +
        '  • Cached MQTT comfort messages on retained topics (control/<room>/comfort_temp)\n' +
        '  • Persistent-zone TRV setpoints (zones listed in persistent_zones config)\n' +
        '  • Away mode (whole-house or per-zone)\n' +
        '  • Occupancy-schedule setback — rooms flagged unoccupied by the schedule are lowered by SetbackCalculator (qsh/occupancy/setback.py)\n' +
        '  • Away-exit recovery ramp — rooms transitioning from unoccupied to occupied are gradually raised by RecoveryScheduler (qsh/occupancy/recovery.py)\n' +
        '  • Per-room zone offsets — fixed_setpoints config (room offsets baked into compute_base_target)\n' +
        '  • Sensor-driven setback — when occupancy sensors disagree with the schedule, the sensor merge re-applies setback per-room\n\n' +
        'The schedule is firing — the rooms are not following it. Threshold for counting a room as "overridden" is 0.3 °C deviation from the schedule-commanded value.'
      : undefined
  const hpActive = live?.status?.applied_mode === 'heat'
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
    // Optimistic flip — user intent is visible instantly. Reconciled via
    // useEffect when the next snapshot arrives (typically within 30 s).
    setOptimisticControlEnabled(enabled)
    try {
      const resp = await fetch(apiUrl('api/control/mode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!resp.ok) {
        // Server rejected the toggle — roll back the optimistic flag so the
        // UI returns to the snapshot truth rather than showing a lie.
        setOptimisticControlEnabled(null)
      }
    } catch {
      setOptimisticControlEnabled(null)
    }
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
        heatSource={heatSource}
        optimalMode={optimalMode}
        boostActive={live?.boost?.active}
        boostRoomCount={live?.boost?.rooms ? Object.keys(live.boost.rooms).length : 0}
        rooms={rooms}
        entityMap={entityMap ?? undefined}
        engineering={engineering}
        driverStatus={initial?.driver}
        readbackMismatchCount={readbackMismatchCount}
        readbackMismatchThreshold={readbackMismatchThreshold}
        lastReadbackMismatchAlarmTime={lastReadbackMismatchAlarmTime}
        setupMode={initial?.setup_mode}
        onNavigate={onNavigate}
        tariffMode={configData?.energy?.tariff_aggression_mode}
        summerMonitoring={Boolean(eng?.summer_monitoring)}
        coolingActive={Boolean(eng?.cooling_active)}
        controlMethod={initial?.control_method}
        sourceSelection={sourceSelection ?? undefined}
        heatSourceCount={configData?.heat_sources?.length}
        quarantine={quarantine ?? undefined}
        apoptosis={apoptosis ?? undefined}
      />

      {/* Comfort temperature & shadow/live toggle */}
      <ComfortControl
        comfortTemp={comfortTemp}
        controlEnabled={controlEnabled}
        saving={saving}
        awayActive={awayData?.whole_house?.active && !optimisticAwayOff}
        awayDays={awayData?.whole_house?.days_remaining ?? awayData?.whole_house?.days}
        comfortScheduleActive={comfortScheduleActive}
        comfortTempActive={comfortTempActive}
        writebackUnverified={comfortTempWritebackUnverified}
        writebackUnverifiedCycles={writebackUnverifiedCycles}
        engineering={engineering}
        onComfortTempChange={handleComfortTempChange}
        onControlModeChange={handleControlModeChange}
      />

      {/* INSTRUCTION-265 — schedule diagnostic sub-line. Always rendered to
          make schedule-active vs schedule-inactive state explicit and to
          surface per-room divergence when per-room overrides clobber the
          schedule. */}
      <div
        data-testid="comfort-status-line"
        className="-mt-2 mb-4 ml-4 text-xs text-[var(--text-muted)]"
        title={comfortStatusTitle}
      >
        {comfortStatusLabel}
      </div>

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
        />
      )}

      {/* Away quick actions */}
      <div className="flex gap-2 mb-4">
        {awayData?.whole_house?.active && !optimisticAwayOff ? (
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
          {Object.entries(displayRooms).map(([name, room]) => {
            const manualMap = live?.manual_state?.[name]
            const manualEntry = manualMap ? { room: name, ...manualMap } : undefined
            return (
              <RoomCard key={name} name={name} room={room} boost={live?.boost?.rooms?.[name]} entityIds={entityMap?.rooms[name]} engineering={engineering} comfortTempActive={comfortTempActive} hpActive={hpActive} manualEntry={manualEntry} />
            )
          })}
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
        activeSource={sourceSelection?.active_source ?? heatSource.type}
        heatSourceCount={configData?.heat_sources?.length ?? (configData?.heat_source ? 1 : 1)}
      />

      {/* Operating state timeline — visible to all users */}
      <HomeStateTimeline />

      {/* Engineering trend charts */}
      {engineering && <HomeTrends />}

      {/* Addon version footer — always visible. Renders 'unknown' literally
          when config.json is missing or unreadable so a deployment
          misconfiguration surfaces to the owner instead of being masked. */}
      <div className="mt-8 pt-4 border-t border-[var(--border)] text-center text-xs text-[var(--text-muted)]">
        QSH v{version ?? '\u2026'}
      </div>
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
