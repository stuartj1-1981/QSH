import { memo } from 'react'
import { Zap, Wind, AlertTriangle, Flame, EyeOff } from 'lucide-react'
import { cn } from '../lib/utils'
import { sourceShortName } from '../lib/sourceLabels'
import type { RoomState, DriverStatus, HeatSourceState } from '../types/api'
import type { Page } from '../App'
import { EntityValue } from './EntityValue'

const PAUSE_STRATEGIES = [
  'hw active', 'hw pre-charge', 'hw recovery',
  'defrost', 'oil recovery', 'short cycle pause',
]

// INSTRUCTION-135 V2 Finding 4: compile-time assertion that the wizard route
// id is a valid member of App.tsx's Page union. The `as const` narrows the
// literal so the onNavigate prop signature can stay tight (avoids forcing
// contravariance widening on every parent that owns a Page-typed callback);
// the dummy assignment to a Page-typed slot is the actual gate. If
// App.tsx ever renames the wizard page id, tsc fails on _PAGE_TYPECHECK.
export const SETUP_MODE_NAV_TARGET = 'wizard' as const
const _PAGE_TYPECHECK: Page = SETUP_MODE_NAV_TARGET
void _PAGE_TYPECHECK

// INSTRUCTION-150E Task 6 (V2 E-M2) audit list — sites in
// StatusBanner.tsx that hardcoded "HP" before this change:
//   1. Line 251 comment: "HP not responding..."  → updated to say "heat source"
//   2. Line 258 alarm body: "HP not responding to commanded mode (...)"
//      → replaced with `${sourceShortName(...)} not responding to commanded mode (...)`
//   3. Line 259 alarm advice: "Check Octopus API status."
//      → kept conditionally on heat_pump source; for non-HP sources we
//        say "Check the heat source's controller / driver." instead
//        (Octopus is HP-specific via the proxy/zone integration).
// Sites NOT changed (already source-aware):
//   - lucide-react Zap/Flame icon selection (heatSource.type branched)
//   - performance label (COP vs η — heatSource.type branched)
//   - thermal-output tooltip ("estimated from live COP" vs "estimated from η = …")
//   - entityMap.hp_power / hp_cop keys (these are programmatic entity-id
//     mapping keys, not user-facing labels — kept as-is)
//
// `sourceShortName` lives in lib/sourceLabels.ts so this file only exports
// React components (Vite fast-refresh constraint).

interface StatusBannerProps {
  operatingState: string
  controlEnabled: boolean
  appliedFlow: number
  appliedMode: string
  outdoorTemp: number
  // INSTRUCTION-117E Task 4: source-aware power display. The banner now
  // takes the whole HeatSourceState and branches on `type` for the icon,
  // performance label, and thermal-output prefix.
  heatSource: HeatSourceState
  optimalMode?: string
  boostActive?: boolean
  boostRoomCount?: number
  rooms?: Record<string, RoomState>
  entityMap?: {
    outdoor_temp?: string
    hp_power?: string
    hp_cop?: string
  }
  engineering?: boolean
  driverStatus?: DriverStatus
  readbackMismatchCount?: number
  readbackMismatchThreshold?: number
  lastReadbackMismatchAlarmTime?: number
  // INSTRUCTION-135: setup-mode banner. The onNavigate prop is typed to the
  // literal 'wizard' so any caller whose own onNavigate accepts a (possibly
  // narrower) Page subset can be threaded through without widening — the
  // banner only ever calls onNavigate(SETUP_MODE_NAV_TARGET).
  setupMode?: boolean
  onNavigate?: (page: typeof SETUP_MODE_NAV_TARGET) => void
}

export const StatusBanner = memo(function StatusBanner({
  operatingState,
  controlEnabled,
  appliedFlow,
  appliedMode,
  outdoorTemp,
  heatSource,
  optimalMode,
  boostActive,
  boostRoomCount,
  rooms,
  entityMap,
  engineering,
  driverStatus,
  readbackMismatchCount = 0,
  readbackMismatchThreshold = 5,
  lastReadbackMismatchAlarmTime = 0,
  setupMode,
  onNavigate,
}: StatusBannerProps) {
  const isPaused = PAUSE_STRATEGIES.some(s => operatingState.toLowerCase().includes(s))
  const stateColor = getStateColor(operatingState)

  // Derive rooms with unavailable occupancy sensors from live WebSocket data
  const fallbackRooms = rooms
    ? Object.entries(rooms).filter(([, r]) => r.occupancy_source?.includes('unavailable'))
    : []

  // Task 4a: icon branches on source type.
  const isHeatPump = heatSource.type === 'heat_pump'
  const SourceIcon = isHeatPump ? Zap : Flame
  const sourceIconClass = isHeatPump ? 'text-[var(--amber)]' : 'text-orange-500'

  // Task 4b: Input · Output thermal-output prefix. Computed output renders
  // with a "≈ " prefix; measured output has no prefix. Tooltip is
  // flicker-free on HP (no numeric) and surfaces the η constant on boilers.
  const inputKw = heatSource.input_power_kw
  const outputKw = heatSource.thermal_output_kw
  const isComputed = heatSource.thermal_output_source === 'computed'
  const outputText = outputKw == null ? '--' : `${outputKw.toFixed(1)} kW`
  const outputPrefix = isComputed && outputKw != null ? '≈ ' : ''
  const outputTooltip = isComputed
    ? isHeatPump
      ? 'estimated from live COP'
      : `estimated from η = ${heatSource.performance.value.toFixed(2)}`
    : undefined

  // Task 4c: performance label derived from source type.
  const perfLabel = isHeatPump
    ? `COP ${heatSource.performance.value.toFixed(1)}`
    : `η ${heatSource.performance.value.toFixed(2)}`
  // INSTRUCTION-128B: performance label gate is source-type-aware.
  // HP: label is meaningful only when `performance.source === 'live'` —
  //   post-INSTRUCTION-128A backend fix, the resolver correctly emits
  //   "config" for HP-off and sensor-loss-fallback states, and the
  //   frontend trusts that provenance.
  // Boiler: η is always `'config'`-sourced per the resolver contract
  //   (it's a config constant, not measured). The useful gate is
  //   "boiler is actually running" — input_power above the off
  //   threshold (0.5 kW per source_capabilities.ts / caps registry).
  //   Without this gate the label renders continuously including when
  //   the boiler is idle, which is semantically wrong and identical in
  //   spirit to the HP bug closed by 128A Finding 1.
  // Canonical home for this threshold is
  // qsh/pipeline/source_capabilities.py::SOURCE_CAPABILITIES["gas_boiler"]
  // .off_power_threshold_kw (and the three other boiler source types,
  // all 0.5). Duplicated here because the frontend has no shared-consts
  // module with the backend. Also duplicated at qsh/historian.py (per
  // INSTRUCTION-128A Task 3). If this value ever changes, grep for
  // "off_power_threshold_kw" and update all three sites.
  const BOILER_OFF_THRESHOLD_KW = 0.5
  const showPerfLabel = isHeatPump
    ? heatSource.performance.source === 'live'
    : heatSource.performance.value > 0
      && heatSource.input_power_kw >= BOILER_OFF_THRESHOLD_KW

  return (
    <>
      {/* INSTRUCTION-135 setup-mode banner — non-dismissible, re-rendered on
          every load while setup_mode === true. Disappears when the next
          status poll returns setup_mode: false (post-wizard restart). Copy
          locked to docs/install.md step 5. */}
      {setupMode === true && (
        <div
          role="alert"
          data-testid="setup-mode-banner"
          className="rounded-xl border p-3 mb-2 bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-start gap-3 text-sm"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong>Setup mode</strong> — complete the Setup Wizard to begin heating control.
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate(SETUP_MODE_NAV_TARGET)}
                className="ml-2 font-medium underline hover:no-underline"
              >
                Open wizard
              </button>
            )}
          </div>
        </div>
      )}

      {/* Driver error banner — degraded mode (MQTT connection failure etc.) */}
      {driverStatus?.status === 'error' && (
        <div className="rounded-xl border p-4 mb-2 bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 flex items-start gap-3 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">MQTT broker connection failed</div>
            <div className="mt-1 text-xs opacity-80">{driverStatus.error}</div>
            <div className="mt-2 text-xs">
              Check Settings &rarr; Heat Source to verify broker address, port, and credentials.
            </div>
          </div>
        </div>
      )}

      {/* Pause warning strip */}
      {isPaused && (
        <div className="rounded-xl border p-3 mb-2 bg-amber-500/15 border-amber-500/30 text-amber-700 flex items-center gap-2 text-sm font-medium">
          <AlertTriangle size={16} />
          Pipeline Paused: {operatingState}
        </div>
      )}

      <div className={cn(
        'rounded-xl border p-4 mb-4',
        'bg-[var(--bg-card)] border-[var(--border)]'
      )}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Operating state */}
          <div className="flex items-center gap-3">
            <div className={cn('w-3 h-3 rounded-full', stateColor)} />
            <div>
              <div className="font-semibold text-lg">{operatingState}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {controlEnabled ? 'Active control' : 'Shadow mode'}
                {appliedMode !== 'off' && ` · ${appliedFlow.toFixed(0)}°C flow`}
              </div>
              {/* Shadow mode recommendation */}
              {!controlEnabled && optimalMode && (
                <div className="text-xs text-[var(--blue)] mt-0.5">
                  QSH recommends: {optimalMode}
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-3 sm:gap-6 text-xs sm:text-sm">
            {boostActive && (
              <div className="flex items-center gap-1.5 text-orange-500">
                <Flame size={16} />
                <span className="font-medium">Boost ({boostRoomCount})</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Wind size={16} className="text-[var(--blue)]" />
              <EntityValue entityId={entityMap?.outdoor_temp} engineering={engineering}>
                <span>{outdoorTemp.toFixed(1)}°C</span>
              </EntityValue>
            </div>
            <div className="flex items-center gap-1.5">
              <SourceIcon size={16} className={sourceIconClass} />
              <EntityValue entityId={entityMap?.hp_power} engineering={engineering}>
                <span>
                  {inputKw.toFixed(1)} kW in
                  {' · '}
                  <span title={outputTooltip}>
                    {outputPrefix}{outputText} out
                  </span>
                </span>
              </EntityValue>
              {showPerfLabel && (
                <EntityValue entityId={entityMap?.hp_cop} engineering={engineering}>
                  <span className="text-[var(--text-muted)]">{perfLabel}</span>
                </EntityValue>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sensor fallback warning */}
      {fallbackRooms.length > 0 && (
        <div className="rounded-xl border p-3 mb-4 bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-center gap-2 text-sm">
          <EyeOff size={16} className="shrink-0" />
          <span>
            Occupancy sensor unavailable for{' '}
            <strong>{fallbackRooms.map(([name]) => name.replace(/_/g, ' ')).join(', ')}</strong>
            {' '}&mdash; using schedule fallback
          </span>
        </div>
      )}

      {/* Readback mismatch alarm — heat source not responding to commanded
          mode for N cycles. INSTRUCTION-150E Task 6: source-aware label. */}
      {readbackMismatchCount >= readbackMismatchThreshold && (
        <div
          role="alert"
          data-testid="readback-mismatch-alarm"
          className="rounded-xl border p-3 mt-1 bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm font-medium"
        >
          {sourceShortName(heatSource.type)} not responding to commanded mode ({readbackMismatchCount} cycles).
          {' '}
          {heatSource.type === 'heat_pump'
            ? 'Check Octopus API status.'
            : 'Check the heat source controller / driver.'}
          {lastReadbackMismatchAlarmTime > 0 && (
            <span className="ml-1 opacity-75">
              First alarmed at {new Date(lastReadbackMismatchAlarmTime * 1000).toLocaleTimeString()}.
            </span>
          )}
        </div>
      )}
    </>
  )
})

function getStateColor(state: string): string {
  if (PAUSE_STRATEGIES.some(s => state.toLowerCase().includes(s))) return 'bg-red-500'
  const s = state.toLowerCase()
  if (s.includes('winter')) return 'bg-[var(--blue)]'
  if (s.includes('heat')) return 'bg-[var(--accent)]'
  if (s.includes('idle') || s.includes('off')) return 'bg-[var(--green)]'
  if (s.includes('away')) return 'bg-[var(--blue)]'
  if (s.includes('shoulder') || s.includes('summer')) return 'bg-[var(--amber)]'
  return 'bg-[var(--text-muted)]'
}
