import { Fragment, useMemo, useState } from 'react'
import { useLive } from '../hooks/useLive'
import { useSysid, useSysidRoom, resetSysidRoom } from '../hooks/useSysid'
import { useHistory } from '../hooks/useHistory'
import { useRawConfig } from '../hooks/useConfig'
import { TrendChart } from '../components/TrendChart'
import { HardwareTelemetry } from '../components/HardwareTelemetry'
import { HelpTip } from '../components/HelpTip'
import { cn } from '../lib/utils'
import { MIN_OBS_FOR_USE, CONFIDENCE_FULL_AT, PC_FIT_R_SQUARED_MIN } from '../lib/sysidConstants'
import { EMPTY_CADENCE, cadenceCopy, cadenceLabel } from '../lib/sensorCadence'
import type { SensorCadence, SysidRoom } from '../types/api'

export function Engineering() {
  const { data: live } = useLive()
  const { data: sysidData } = useSysid()
  const { data: config } = useRawConfig()
  const eng = live?.engineering
  const status = live?.status

  const configuredSensors = useMemo(() => {
    const sensors = config?.heat_source?.sensors
    const outdoor = config?.outdoor?.temperature
    const set = new Set<string>()
    if (sensors?.flow_temp) set.add('flow_temp')
    if (sensors?.return_temp) set.add('return_temp')
    if (sensors?.delta_t || (sensors?.flow_temp && sensors?.return_temp)) set.add('delta_t')
    if (sensors?.flow_rate) set.add('flow_rate')
    if (sensors?.power_input || sensors?.heat_output) set.add('power')
    if (sensors?.cop) set.add('cop')
    if (outdoor) set.add('outdoor_temp')
    return set.size > 0 ? set : undefined
  }, [config])

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Engineering</h1>

      {/* Pipeline State */}
      <PipelineState
        cycleNumber={live?.cycle_number}
        operatingState={status?.operating_state}
        appliedMode={status?.applied_mode}
        detFlow={eng?.det_flow}
        rlFlow={eng?.rl_flow}
        appliedFlow={status?.applied_flow}
        rlBlend={eng?.rl_blend}
        totalDemand={status?.total_demand}
        frostCapActive={eng?.frost_cap_active}
        cascadeActive={eng?.cascade_active}
      />

      {/* Hardware Telemetry — INSTRUCTION-117E: source-aware. Pull flow /
          return / delta_t / flow_rate / power from the WS status.heat_source
          block. INSTRUCTION-120C: COP comes from the legacy `hp` shim
          (live.hp.cop) because that is the field gated by 120B's
          `_resolve_snapshot_hp_cop` — null when HP off or in sensor-loss
          fallback. Reading `heat_source.performance.value` directly would
          bypass the gate and leak the 2.5 fallback baseline (Bug C). On
          non-HP installs `live.hp` is null so `hp?.cop` is undefined and
          HardwareTelemetry renders '—'. Note `live.hp` sits at the outer
          CycleMessage level, not nested under `live.status`. */}
      <HardwareTelemetry
        flowTemp={status?.heat_source?.flow_temp}
        returnTemp={status?.heat_source?.return_temp}
        deltaT={status?.heat_source?.delta_t}
        flowRate={status?.heat_source?.flow_rate}
        powerKw={status?.heat_source?.input_power_kw}
        cop={live?.hp?.cop}
        outdoorTemp={status?.outdoor_temp}
        configured={configuredSensors}
      />

      {/* SysID Overview */}
      {sysidData?.rooms && <SysidTable rooms={sysidData.rooms} />}

      {/* Signal Quality */}
      {eng?.signal_quality && Object.keys(eng.signal_quality).length > 0 && (
        <SignalQuality signals={eng.signal_quality} />
      )}

      {/* RL Training */}
      <RlTrainingSection
        reward={eng?.rl_reward}
        loss={eng?.rl_loss}
        blend={eng?.rl_blend}
      />
    </div>
  )
}

function PipelineState({
  cycleNumber, operatingState, appliedMode, detFlow, rlFlow, appliedFlow, rlBlend,
  totalDemand, frostCapActive, cascadeActive,
}: {
  cycleNumber?: number
  operatingState?: string
  appliedMode?: string
  detFlow?: number
  rlFlow?: number | null
  appliedFlow?: number
  rlBlend?: number
  totalDemand?: number
  frostCapActive?: boolean
  cascadeActive?: boolean
}) {
  return (
    <div data-testid="pipeline-state" className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3 flex items-center gap-1.5">
        PIPELINE STATE
        <HelpTip text="Live snapshot of the controller pipeline. Updates each 30 s cycle." size={12} />
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
        <Stat label="Cycle" value={`#${cycleNumber ?? 0}`} help="Pipeline cycle counter — increments every 30 s." />
        <Stat label="State" value={operatingState ?? '—'} help="Current operating state machine value (e.g. heating, off, antifrost, shoulder_off, summer_off)." />
        <Stat label="Mode" value={appliedMode ?? '—'} help="HP mode actually applied this cycle (heat / off). May differ from controller intent if a guard suppressed the command." />
        <Stat label="Det Flow" value={detFlow != null ? `${detFlow.toFixed(1)}°C` : '—'} help="Flow temperature target from the deterministic controller chain — physics-only, no learning." />
        <Stat label="RL Flow" value={rlFlow != null ? `${rlFlow.toFixed(1)}°C` : 'n/a'} help="Flow temperature target proposed by the RL agent. Shown as ‘n/a’ during shadow mode or before training maturity." />
        <Stat label="Applied Flow" value={appliedFlow != null ? `${appliedFlow.toFixed(1)}°C` : '—'} help="Flow temperature actually commanded this cycle, after blend and any safety caps." />
        <Stat label="Blend" value={rlBlend != null ? rlBlend.toFixed(3) : '—'} help="RL blend factor: 0 = pure deterministic, 1 = pure RL. Ramps up only with training samples and is clamped during shadow mode." />
        <Stat label="Total Demand" value={totalDemand != null ? `${totalDemand.toFixed(1)} kW` : '—'} help="Sum of per-room thermal demand estimates this cycle." />
        <div className="flex items-center gap-2">
          {frostCapActive && <Badge label="Frost Cap" color="blue" />}
          {cascadeActive && <Badge label="Cascade" color="amber" />}
        </div>
      </div>
    </div>
  )
}

function SysidTable({ rooms }: { rooms: Record<string, SysidRoom> }) {
  // INSTRUCTION-415 — one room expandable at a time; the detail row hosts
  // the per-room U rejection ledger (fetched lazily from /api/sysid/{room}).
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3 flex items-center gap-1.5">
        SYSTEM ID
        <HelpTip
          text={`Per-room thermal parameters learned from passive observation. U is heat loss, C is thermal mass. Both start at a config-derived prior and migrate toward the learned value as observations accumulate. Confidence = evidence ramp (first ${MIN_OBS_FOR_USE} observations) × precision (how consistent recent observations are) — a room can hold hundreds of observations at moderate confidence if its readings scatter.`}
          size={12}
        />
      </h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                Room
                <HelpTip text="Room name as configured. Capitalisation is purely display." size={12} />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                U (kW/°C)
                <HelpTip
                  text="Effective heat-loss coefficient used by the controllers. A confidence-weighted blend of a static prior and the learned value. The prior is a top-down split of the whole-house design loss across rooms by area × facing — it is NOT a room-by-room heat-loss survey calculation, so do not expect it to match one."
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                C (kWh/°C)
                <HelpTip
                  text="Effective thermal mass. Confidence-weighted blend of prior and learned. Primary convergence path is the passive-cooling analyser (see PC fits), not per-cycle estimation, which rarely qualifies under multi-zone UK operation."
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                U obs
                <HelpTip
                  text={`Number of accepted U observations. Below ${MIN_OBS_FOR_USE} the value shown is the prior. More observations raise confidence only insofar as they agree — precision, not just count.`}
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                C obs
                <HelpTip
                  text="Number of accepted C observations across both per-cycle estimation and passive-cooling fits. Same maturity scale as U obs."
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                C source
                <HelpTip
                  text="Where C currently comes from: ‘Prior’ = config-derived prior (no observations yet), ‘Cycle’ = per-cycle heat-balance estimation, ‘PC’ = passive-cooling tau fits (the dominant path in normal multi-zone UK operation)."
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                PC fits
                <HelpTip
                  text={`Number of successful passive-cooling window fits for this room. Each fit is an extended HP-off period where the cooling curve was clean enough (R² ≥ ${PC_FIT_R_SQUARED_MIN}) to extract a time constant. The primary mechanism by which C converges in real installations.`}
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                Solar
                <HelpTip
                  text="Learned solar gain factor (kW thermal gain per kW solar irradiance). Zero until solar observations reach maturity. Stays zero on installs without a solar irradiance sensor — that is expected, not a fault."
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2 pr-1 sm:pr-3">
              <span className="inline-flex items-center gap-1">
                Confidence
                <HelpTip
                  text={`Maturity of this room's heat-loss (U) evidence: Low = fewer than ${MIN_OBS_FOR_USE} accepted observations (value shown is the prior), Medium = learned value in use, High = ${CONFIDENCE_FULL_AT}+. C maturity is shown in its own column.`}
                  size={12}
                />
              </span>
            </th>
            <th className="pb-2">
              <span className="inline-flex items-center gap-1">
                Sensor
                <HelpTip
                  text="Measured reporting behaviour of this room's temperature sensor: the step size and cadence actually observed on the wire, classified against what the estimator can admit. OK = compatible with learning; Coarse = learns at reduced rate; Blocked = cannot learn at current settings (check the device's reporting deadband, minimum-report interval, or device class); Measuring = too few updates observed yet to classify. Advisory only — never blocks anything."
                  size={12}
                />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(rooms).map(([name, r]) => (
            <Fragment key={name}>
              <tr
                data-testid={`sysid-row-${name}`}
                className="border-b border-[var(--border)]/50 cursor-pointer hover:bg-[var(--bg)]/60"
                onClick={() => setExpanded(expanded === name ? null : name)}
                aria-expanded={expanded === name}
              >
                <td className="py-1.5 pr-1 sm:pr-3 font-medium capitalize">{name.replace(/_/g, ' ')}</td>
                <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.u_kw_per_c?.toFixed(4)}</td>
                <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.c_kwh_per_c?.toFixed(4)}</td>
                <td className="py-1.5 pr-1 sm:pr-3">{r.u_observations}</td>
                <td className="py-1.5 pr-1 sm:pr-3">{r.c_observations}</td>
                <td className="py-1.5 pr-1 sm:pr-3">{r.c_source}</td>
                <td className="py-1.5 pr-1 sm:pr-3">{r.pc_fits}</td>
                <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.solar_gain?.toFixed(3)}</td>
                <td className="py-1.5 pr-1 sm:pr-3">
                  <ConfidenceBadge level={r.confidence} />
                </td>
                <td className="py-1.5">
                  <CadenceBadge cadence={r.sensor_cadence} />
                </td>
              </tr>
              {expanded === name && (
                <tr className="border-b border-[var(--border)]/50">
                  <td colSpan={10} className="py-2 pl-2">
                    <SysidRoomDetailPanel room={name} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// INSTRUCTION-415 — per-room U-candidate rejection ledger (D4). A starved
// room becomes diagnosable in one glance: the dominant rejection class names
// the mechanism. The ledger is total — the seven classes sum to the room's
// U-candidate count.
const U_LEDGER_CLASSES: { key: string; label: string }[] = [
  { key: 'room_u_qualified', label: 'qualified' },
  { key: 'room_u_flat', label: 'flat' },
  { key: 'room_u_rejected_rate', label: 'rate' },
  { key: 'room_u_rejected_sign', label: 'sign' },
  { key: 'room_u_rejected_delta_ext', label: 'Δext' },
  { key: 'room_u_rejected_no_c', label: 'no-C' },
  { key: 'room_u_rejected_outlier', label: 'outlier' },
]

const U_LEDGER_MECHANISM_COPY: Record<string, string> = {
  room_u_rejected_rate:
    'This sensor publishes in steps too large for the estimator (>0.1 °C per 30 s cycle) — check the device’s reporting deadband or minimum-report throttle.',
  room_u_rejected_no_c:
    'This room has no usable thermal-mass prior — check its area and facing in the configuration.',
}

function SysidRoomDetailPanel({ room }: { room: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, error } = useSysidRoom(room, refreshKey)
  // INSTRUCTION-422 — reset flow state: confirm-at-the-action (137/324
  // idiom) with the outcome rendered on BOTH arms (the 414 law).
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  const handleReset = async () => {
    setResetting(true)
    const res = await resetSysidRoom(room)
    setResetting(false)
    setConfirming(false)
    if (res.ok) {
      const w = res.result.was
      const n = res.result.now
      // persisted === false: the estimator's config/state-mismatch guard is
      // suppressing saves — the reset holds in memory only. Say so.
      const persistenceNote =
        res.result.persisted === false
          ? ' Warning: state persistence is currently suspended (config/state mismatch) — this reset will not survive a restart.'
          : ''
      setOutcome({
        ok: true,
        text: `Room reset to config priors — discarded ${w.u_observations} U, ${w.c_observations} C and ${w.solar_observations} solar observations (${w.pc_fits} passive-cooling fits). New priors: U ${n.u_prior.toFixed(4)} kW/°C, C ${n.c_prior.toFixed(3)} kWh/°C.${persistenceNote}`,
      })
      setRefreshKey((k) => k + 1)
    } else {
      setOutcome({ ok: false, text: `Reset failed: ${res.error}` })
    }
  }

  if (error) {
    return <div className="text-xs text-[var(--red,#ef4444)]">Failed to load room detail: {error}</div>
  }
  if (!data) {
    return <div className="text-xs text-[var(--text-muted)]">Loading room detail…</div>
  }

  const gs = data.gate_stats ?? {}
  const counts = U_LEDGER_CLASSES.map(({ key, label }) => ({
    key,
    label,
    count: gs[key] ?? 0,
  }))
  const candidates = counts.reduce((s, c) => s + c.count, 0)
  const rejections = counts.filter((c) => c.key !== 'room_u_qualified')
  const dominant = rejections.reduce(
    (best, c) => (c.count > best.count ? c : best),
    rejections[0],
  )
  // Starvation judged on the DETAIL fetch (fresh), not the list-row
  // snapshot: the dominant class is emphasised only when the room is
  // below the learned-value floor and candidates exist (INSTRUCTION-415 D4).
  const starved = data.u_observations < MIN_OBS_FOR_USE && candidates > 0
  const emphasise = starved && dominant.count > 0

  return (
    <div data-testid="u-rejection-ledger" className="space-y-1.5 text-xs">
      <div className="flex items-center gap-1 font-medium text-[var(--text-muted)]">
        U observation ledger
        <HelpTip
          text="Every 30 s cycle where this room was eligible for a heat-loss (U) observation resolved to exactly one class below. ‘qualified’ = accepted; the rest name why the cycle was discarded: ‘flat’ = no temperature change, ‘rate’ = step too large for the glitch gate, ‘sign’ = warming while the source was off, ‘Δext’ = room too close to outdoor temperature, ‘no-C’ = no usable thermal-mass prior, ‘outlier’ = implausible computed U."
          size={12}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
        {counts.map(({ key, label, count }) => (
          <span
            key={key}
            className={cn(
              emphasise && key === dominant.key
                ? 'text-[var(--red,#ef4444)] font-semibold'
                : key === 'room_u_qualified'
                  ? 'text-[var(--text)]'
                  : 'text-[var(--text-muted)]',
            )}
          >
            {label} {count}
          </span>
        ))}
      </div>
      {emphasise && U_LEDGER_MECHANISM_COPY[dominant.key] && (
        <p data-testid="u-ledger-mechanism" className="text-[var(--text-muted)] max-w-prose">
          {U_LEDGER_MECHANISM_COPY[dominant.key]}
        </p>
      )}

      {/* INSTRUCTION-422 — per-room reset: confirm states exactly what is
          discarded; the outcome renders on BOTH arms (no silent success,
          no silent failure). Learned state is evidence — reset after a
          sensor fix or geometry correction, not as routine maintenance. */}
      <div className="pt-1.5 space-y-1.5">
        {!confirming ? (
          <button
            data-testid="sysid-reset-request"
            onClick={(e) => {
              e.stopPropagation()
              setOutcome(null)
              setConfirming(true)
            }}
            className="px-2 py-1 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--red,#ef4444)] hover:border-[var(--red,#ef4444)]"
          >
            Reset room learning…
          </button>
        ) : (
          <div
            data-testid="sysid-reset-confirm"
            className="rounded border border-[var(--red,#ef4444)]/40 p-2 space-y-1.5"
          >
            <p className="max-w-prose">
              Discard this room&apos;s learned thermal state —{' '}
              {data.u_observations} U observations, {data.c_observations} C
              observations, {data.pc_fits} passive-cooling fits. This room
              only; priors are re-derived from the current configuration.
            </p>
            <div className="flex gap-2">
              <button
                data-testid="sysid-reset-confirm-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleReset()
                }}
                disabled={resetting}
                className="px-2 py-1 rounded bg-[var(--red,#ef4444)]/15 border border-[var(--red,#ef4444)]/50 text-xs font-medium text-[var(--red,#ef4444)] disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Discard & reset'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirming(false)
                }}
                disabled={resetting}
                className="px-2 py-1 rounded border border-[var(--border)] text-xs text-[var(--text-muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {outcome && (
          <p
            data-testid="sysid-reset-outcome"
            className={cn(
              'max-w-prose',
              outcome.ok
                ? 'text-[var(--green,#22c55e)]'
                : 'text-[var(--red,#ef4444)]',
            )}
          >
            {outcome.text}
          </p>
        )}
      </div>
    </div>
  )
}

// INSTRUCTION-420 — the Sensor column badge. Label/copy helpers live in
// lib/sensorCadence.ts (shared with the wizard review advisory).
function CadenceBadge({ cadence }: { cadence?: SensorCadence | null }) {
  const colors: Record<string, string> = {
    ok: 'bg-green-500/20 text-green-600',
    coarse: 'bg-amber-500/20 text-amber-600',
    blocked: 'bg-red-500/20 text-red-600',
    insufficient: 'bg-gray-500/20 text-gray-500',
  }
  const cls = cadence?.class ?? 'insufficient'
  return (
    // stopPropagation: this badge (and its HelpTip) sits inside the
    // clickable SysID row — opening the tooltip must not also toggle the
    // row expansion (which would fire the detail fetch as a side effect).
    <span
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        data-testid="cadence-badge"
        className={cn(
          'px-2 py-0.5 rounded-full text-xs font-medium',
          colors[cls] ?? colors.insufficient,
        )}
      >
        {cadenceLabel(cls)}
      </span>
      <HelpTip text={cadenceCopy(cadence ?? EMPTY_CADENCE)} size={12} />
    </span>
  )
}

function ConfidenceBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    high: 'bg-green-500/20 text-green-600',
    medium: 'bg-amber-500/20 text-amber-600',
    low: 'bg-red-500/20 text-red-600',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', colors[level] ?? colors.low)}>
      {level}
    </span>
  )
}

function SignalQuality({ signals }: { signals: Record<string, string> }) {
  const dotColor: Record<string, string> = {
    good: 'bg-green-500',
    ok: 'bg-amber-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500',
    stale: 'bg-red-500',
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3 flex items-center gap-1.5">
        SIGNAL QUALITY
        <HelpTip
          text="Health of each input signal group. ‘good’ = fresh, in-range, low-jitter. ‘warn/ok’ = degraded but usable. ‘bad/stale’ = the signal has been stale or out-of-range long enough to be excluded from learning and may also affect control."
          size={12}
        />
      </h2>
      <div className="flex flex-wrap gap-4">
        {Object.entries(signals).map(([group, quality]) => (
          <div key={group} className="flex items-center gap-2 text-sm">
            <div className={cn('w-2.5 h-2.5 rounded-full', dotColor[quality] ?? 'bg-gray-500')} />
            <span className="capitalize">{group.replace(/_/g, ' ')}</span>
            <span className="text-xs text-[var(--text-muted)]">{quality}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RlTrainingSection({
  reward, loss, blend,
}: {
  reward?: number
  loss?: number
  blend?: number
}) {
  const { data: rewardData } = useHistory(['rl_reward'], 48)
  const { data: lossData } = useHistory(['rl_loss'], 48)
  const { data: blendData } = useHistory(['rl_blend'], 168)
  const { data: flowData } = useHistory(['det_flow', 'rl_flow', 'applied_flow'], 48)

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--accent)] mb-3 flex items-center gap-1.5">
          RL TRAINING
          <HelpTip
            text="Reinforcement-learning policy training metrics. Each trace shows the rolling window of cycles currently held in memory — depth grows over time from startup onwards and tops out at the buffer capacity. Blend = 0 means pure deterministic control; blend = 1 means pure RL. Blend ramps up only after sufficient training samples and is clamped during shadow mode."
            size={12}
          />
        </h2>
        <div className="flex gap-6 text-sm mb-4">
          <Stat label="Reward" value={reward?.toFixed(2) ?? '—'} help="Latest RL reward sample — combines comfort tracking, energy use, and overshoot." />
          <Stat label="Loss" value={loss?.toFixed(4) ?? '—'} help="Latest RL training loss. Trends down as the policy converges." />
          <Stat label="Blend" value={blend?.toFixed(3) ?? '—'} help="Same blend factor as in PIPELINE STATE — repeated here for convenience alongside reward and loss." />
        </div>
      </div>

      <TrendChart
        title="RL Reward"
        data={rewardData}
        lines={[{ key: 'rl_reward', label: 'Reward', color: 'var(--green)' }]}

      />
      <TrendChart
        title="RL Loss"
        data={lossData}
        lines={[{ key: 'rl_loss', label: 'Loss', color: 'var(--red, #ef4444)' }]}

      />
      <TrendChart
        title="Blend Factor"
        data={blendData}
        lines={[{ key: 'rl_blend', label: 'Blend', color: 'var(--accent)' }]}

      />
      <TrendChart
        title="Flow Comparison"
        data={flowData}
        lines={[
          { key: 'det_flow', label: 'Deterministic', color: 'var(--blue)' },
          { key: 'rl_flow', label: 'RL', color: 'var(--green)' },
          { key: 'applied_flow', label: 'Applied', color: 'var(--accent)' },
        ]}

        yUnit="°C"
      />
    </div>
  )
}


function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
      <div className="text-[var(--text-muted)] text-xs flex items-center gap-1">
        {label}
        {help && <HelpTip text={help} size={12} />}
      </div>
      <div className="font-medium font-mono">{value}</div>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full bg-${color}-500/20 text-${color}-600 text-xs font-medium`}>
      {label}
    </span>
  )
}
