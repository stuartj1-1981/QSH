import { memo } from 'react'
import { Zap, Wind, AlertTriangle, Flame, EyeOff, Snowflake } from 'lucide-react'
import { cn } from '../lib/utils'
import { sourceShortName } from '../lib/sourceLabels'
import { DEFAULT_TARIFF_AGGRESSION_MODE, TARIFF_LABELS } from '../lib/tariff'
import type {
  RoomState,
  DriverStatus,
  HeatSourceState,
  SourceSelectionPayload,
  QuarantineStatus,
  ApoptosisStatus,
} from '../types/api'
import type { TariffAggressionMode } from '../types/config'
import type { Page } from '../App'
import { EntityValue } from './EntityValue'
import { HeatPumpIcon } from './icons/HeatPumpIcon'
import { BoilerIcon } from './icons/BoilerIcon'
import { SOURCE_REASON_CHIP_TEXT } from '../lib/sourceReasonLabels'

const PAUSE_STRATEGIES = [
  'hw active', 'hw pre-charge', 'hw recovery',
  'defrost', 'oil recovery', 'short cycle pause',
]

// INSTRUCTION-186: active control-method diagnostic chip. Labels mirror the
// values resolved at qsh/config.py:1879-1897 plus the pending/unknown
// sentinels suppressed by HIDDEN_METHODS. Unmapped values fall back to the
// raw string at render time so a backend release introducing a new method
// does not silently render a blank chip.
const CONTROL_METHOD_LABELS: Record<string, string> = {
  octopus_api:  'Octopus API',
  ha_service:   'HA Service',
  mqtt:         'MQTT',
  entity:       'Entity',
  trvs_only:    'TRVs Only',
  monitor_only: 'Monitor',
}

const HIDDEN_METHODS = new Set(['', 'unknown', 'pending'])

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
  // INSTRUCTION-182: tariff strategy displayed inline in the subtitle.
  // Suppressed entirely when summerMonitoring is true (no configured tariff
  // aggression takes effect in summer monitoring).
  tariffMode?: TariffAggressionMode
  summerMonitoring?: boolean
  // INSTRUCTION-364: active-cooling indicator. When true the HP is running as
  // cooling (A/C) and SysID learning is paused (363). Informational only.
  coolingActive?: boolean
  // INSTRUCTION-186: active control routing path — read-only diagnostic
  // chip. Loose `string` type tolerates unknown future backend values
  // (forward-compat — see the unmapped-value test).
  controlMethod?: string
  // 228B Task 3: active-source provenance payload from /ws/live. The
  // badge renders when `sourceSelection` is present, the install is
  // multi-source (heatSourceCount >= 2), and `reason !== 'single_source'`.
  // heatSourceCount is read from the config / heat_sources length —
  // the payload alone does not disclose that count.
  sourceSelection?: SourceSelectionPayload
  heatSourceCount?: number
  // INSTRUCTION-288B: quarantine signal from the swarm coordinator
  // (QS-INSTRUCTION-007). When `quarantined` is true the banner renders a
  // prominent "flagged for review — contact support" alert. Absent / false →
  // nothing quarantine-related renders (happy path byte-identical).
  quarantine?: QuarantineStatus
  // INSTRUCTION-321B: apoptosis detector signal. When `suspended` is true the
  // unit has self-suspended (dropped out of cohort priors) — a prominent
  // phone-home alert. When `hormesis` is true (2-of-3) a softer "approaching
  // apoptosis criteria" warning shows. Absent / all-false → nothing renders.
  apoptosis?: ApoptosisStatus
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
  tariffMode,
  summerMonitoring,
  coolingActive,
  controlMethod,
  sourceSelection,
  heatSourceCount,
  quarantine,
  apoptosis,
}: StatusBannerProps) {
  const isPaused = PAUSE_STRATEGIES.some(s => operatingState.toLowerCase().includes(s))
  const stateColor = getStateColor(operatingState)

  // INSTRUCTION-182: tariff strategy segment in subtitle. Hidden in summer
  // monitoring (operational gate — no configured tariff aggression takes
  // effect there).
  const showTariff = !summerMonitoring
  const resolvedTariffMode = tariffMode ?? DEFAULT_TARIFF_AGGRESSION_MODE
  const tariffMeta = TARIFF_LABELS[resolvedTariffMode]

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

      {/* INSTRUCTION-288B quarantine banner — the unit has been flagged for
          review by the swarm coordinator (QS-INSTRUCTION-007). Non-terminal:
          publishing continues; this surfaces the phone-home path. Rendered
          only when quarantined === true; absent/false → nothing here. */}
      {quarantine?.quarantined && (
        <div
          role="alert"
          data-testid="quarantine-banner"
          className="rounded-xl border p-4 mb-2 bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 flex items-start gap-3 text-sm"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              This unit has been flagged for review. Contact support to be re-instated.
            </div>
            {quarantine.reason && (
              <div className="mt-1 text-xs opacity-80">{quarantine.reason}</div>
            )}
            {quarantine.contact && (
              <div className="mt-2 text-xs">
                Contact: <span className="font-medium break-all">{quarantine.contact}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* INSTRUCTION-322B dormancy banner — supervisory control has been
          RELEASED to native control (SENESCENT_DORMANT). The strongest swarm
          banner: takes precedence over self-suspension + hormesis (both
          suppressed below while dormant). Recommissioning is operator-driven. */}
      {apoptosis?.dormant && (
        <div
          role="alert"
          data-testid="dormancy-banner"
          className="rounded-xl border p-4 mb-2 bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 flex items-start gap-3 text-sm"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              Supervisory control has been released to native control — contact support to recommission.
            </div>
            <div className="mt-1 text-xs opacity-80">
              This unit went dormant after an extended suspension. Heating now runs on the
              manufacturer&apos;s native controller until a support engineer recommissions it.
            </div>
          </div>
        </div>
      )}

      {/* INSTRUCTION-322B pre-shutdown countdown — the unit is inside the 24 h
          window before supervisory control is released. Shown while
          pre_shutdown_active and not yet dormant. */}
      {apoptosis?.pre_shutdown_active && !apoptosis?.dormant && (
        <div
          role="alert"
          data-testid="pre-shutdown-banner"
          className="rounded-xl border p-4 mb-2 bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-start gap-3 text-sm"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              Pre-shutdown countdown — supervisory control will be released soon. Contact support.
            </div>
            <div className="mt-1 text-xs opacity-80">
              {apoptosis.pre_shutdown_remaining_hours != null
                ? `Approximately ${apoptosis.pre_shutdown_remaining_hours} hour${apoptosis.pre_shutdown_remaining_hours === 1 ? '' : 's'} remaining before native-control handover.`
                : 'Native-control handover is imminent.'}
            </div>
          </div>
        </div>
      )}

      {/* INSTRUCTION-321B apoptosis suspension banner — the unit has
          self-suspended (three-condition AND gate armed) and dropped out of
          cohort priors. Supervisory control is retained; this is the phone-home
          path. Suppressed while dormant (the stronger 322B banner takes over). */}
      {apoptosis?.suspended && !apoptosis?.dormant && (
        <div
          role="alert"
          data-testid="apoptosis-banner"
          className="rounded-xl border p-4 mb-2 bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 flex items-start gap-3 text-sm"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              This unit has self-suspended from the swarm. Contact support to be re-instated.
            </div>
            <div className="mt-1 text-xs opacity-80">
              Supervisory heating control is unaffected — only swarm participation is paused.
            </div>
          </div>
        </div>
      )}

      {/* INSTRUCTION-321B hormesis warning — the unit meets 2 of the 3
          apoptosis conditions (a soft early-warning; no suspension). Suppressed
          while suspended OR dormant (the stronger banner takes over). */}
      {apoptosis?.hormesis && !apoptosis?.suspended && !apoptosis?.dormant && (
        <div
          role="status"
          data-testid="hormesis-banner"
          className="rounded-xl border p-4 mb-2 bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-start gap-3 text-sm"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              This unit meets 2 of 3 apoptosis conditions — please review system health.
            </div>
            <div className="mt-1 text-xs opacity-80">
              No action has been taken. A real install with a fault gets this warning; it does not suspend.
            </div>
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

      {/* INSTRUCTION-364 active-cooling banner — informational. The HP is
          running as cooling (A/C), so SysID learning is paused (363). Renders
          only when the live flag is true; below the safety/quarantine banners. */}
      {coolingActive && (
        <div
          role="status"
          data-testid="cooling-banner"
          className="rounded-xl border p-3 mb-2 bg-cyan-500/15 border-cyan-500/30 text-cyan-700 dark:text-cyan-300 flex items-center gap-2 text-sm font-medium"
        >
          <Snowflake size={16} className="shrink-0" />
          Active cooling — SysID learning paused while the heat pump runs as cooling.
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-lg">{operatingState}</span>
                {controlMethod && !HIDDEN_METHODS.has(controlMethod) && (
                  <span
                    data-control-method={controlMethod}
                    data-testid="control-method-badge"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                    )}
                  >
                    {CONTROL_METHOD_LABELS[controlMethod] ?? controlMethod}
                  </span>
                )}
                <ActiveSourceBadge
                  sourceSelection={sourceSelection}
                  heatSourceCount={heatSourceCount}
                  heatSourceType={heatSource.type}
                />
              </div>
              <div className="text-xs text-[var(--text-muted)]" data-testid="status-banner-subtitle">
                {controlEnabled ? 'Active control' : 'Shadow mode'}
                {appliedMode !== 'off' && ` · ${appliedFlow.toFixed(0)}°C flow`}
                {showTariff && (
                  <>
                    {' · Tariff: '}
                    <span className={cn('font-medium', tariffMeta.tone)} data-testid="status-banner-tariff">
                      {tariffMeta.short}
                    </span>
                  </>
                )}
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

// 228B Task 3: Active-source provenance badge. Hidden on single-source
// installs (heatSourceCount < 2) and when reason === 'single_source'.
// Failover uses `detail` for the displaced source name (parent Decision 4);
// `blocked_switches` is only rendered when reason is not 'failover'.
interface ActiveSourceBadgeProps {
  sourceSelection?: SourceSelectionPayload
  heatSourceCount?: number
  heatSourceType: string
}

function ActiveSourceBadge({
  sourceSelection,
  heatSourceCount,
  heatSourceType,
}: ActiveSourceBadgeProps) {
  if (!sourceSelection) return null
  if ((heatSourceCount ?? 0) < 2) return null
  if (sourceSelection.reason === 'single_source') return null

  const isFailover = sourceSelection.reason === 'failover'
  const chipText = SOURCE_REASON_CHIP_TEXT[sourceSelection.reason]
  const Icon = heatSourceType === 'heat_pump' ? HeatPumpIcon : BoilerIcon

  // Tooltip body: detail line + any blocked_switches (suppressed under failover).
  const tooltipLines: string[] = []
  if (sourceSelection.detail) {
    tooltipLines.push(sourceSelection.detail)
  }
  if (!isFailover && sourceSelection.blocked_switches.length > 0) {
    for (const bs of sourceSelection.blocked_switches) {
      tooltipLines.push(`${bs.to} held back by ${bs.reason}`)
    }
  }
  const tooltip = tooltipLines.length > 0 ? tooltipLines.join('\n') : undefined

  return (
    <span
      data-testid="active-source-badge"
      data-source-reason={sourceSelection.reason}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        isFailover
          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      )}
    >
      <Icon size={12} data-testid="active-source-icon" />
      <span data-testid="active-source-name">{sourceSelection.active_source}</span>
      {chipText && (
        <span
          data-testid="active-source-reason-chip"
          className={cn(
            'rounded px-1.5 py-0 text-[10px] uppercase tracking-wide',
            isFailover
              ? 'bg-amber-500/30 text-amber-800 dark:text-amber-200'
              : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
          )}
        >
          {chipText}
        </span>
      )}
    </span>
  )
}
