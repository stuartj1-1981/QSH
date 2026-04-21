import { useMemo } from 'react'
import { useLive } from '../hooks/useLive'
import { useSysid } from '../hooks/useSysid'
import { useHistory } from '../hooks/useHistory'
import { useRawConfig } from '../hooks/useConfig'
import { TrendChart } from '../components/TrendChart'
import { HardwareTelemetry } from '../components/HardwareTelemetry'
import { cn } from '../lib/utils'
import type { SysidRoom } from '../types/api'

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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3">PIPELINE STATE</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
        <Stat label="Cycle" value={`#${cycleNumber ?? 0}`} />
        <Stat label="State" value={operatingState ?? '—'} />
        <Stat label="Mode" value={appliedMode ?? '—'} />
        <Stat label="Det Flow" value={detFlow != null ? `${detFlow.toFixed(1)}°C` : '—'} />
        <Stat label="RL Flow" value={rlFlow != null ? `${rlFlow.toFixed(1)}°C` : 'n/a'} />
        <Stat label="Applied Flow" value={appliedFlow != null ? `${appliedFlow.toFixed(1)}°C` : '—'} />
        <Stat label="Blend" value={rlBlend != null ? rlBlend.toFixed(3) : '—'} />
        <Stat label="Total Demand" value={totalDemand != null ? `${totalDemand.toFixed(1)} kW` : '—'} />
        <div className="flex items-center gap-2">
          {frostCapActive && <Badge label="Frost Cap" color="blue" />}
          {cascadeActive && <Badge label="Cascade" color="amber" />}
        </div>
      </div>
    </div>
  )
}

function SysidTable({ rooms }: { rooms: Record<string, SysidRoom> }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3">SYSTEM ID</h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="pb-2 pr-1 sm:pr-3">Room</th>
            <th className="pb-2 pr-1 sm:pr-3">U (kW/°C)</th>
            <th className="pb-2 pr-1 sm:pr-3">C (kWh/°C)</th>
            <th className="pb-2 pr-1 sm:pr-3">U obs</th>
            <th className="pb-2 pr-1 sm:pr-3">C obs</th>
            <th className="pb-2 pr-1 sm:pr-3">C source</th>
            <th className="pb-2 pr-1 sm:pr-3">PC fits</th>
            <th className="pb-2 pr-1 sm:pr-3">Solar</th>
            <th className="pb-2">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(rooms).map(([name, r]) => (
            <tr key={name} className="border-b border-[var(--border)]/50">
              <td className="py-1.5 pr-1 sm:pr-3 font-medium capitalize">{name.replace(/_/g, ' ')}</td>
              <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.u_kw_per_c?.toFixed(4)}</td>
              <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.c_kwh_per_c?.toFixed(4)}</td>
              <td className="py-1.5 pr-1 sm:pr-3">{r.u_observations}</td>
              <td className="py-1.5 pr-1 sm:pr-3">{r.c_observations}</td>
              <td className="py-1.5 pr-1 sm:pr-3">{r.c_source}</td>
              <td className="py-1.5 pr-1 sm:pr-3">{r.pc_fits}</td>
              <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.solar_gain?.toFixed(3)}</td>
              <td className="py-1.5">
                <ConfidenceBadge level={r.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3">SIGNAL QUALITY</h2>
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
        <h2 className="text-sm font-semibold text-[var(--accent)] mb-3">RL TRAINING</h2>
        <div className="flex gap-6 text-sm mb-4">
          <Stat label="Reward" value={reward?.toFixed(2) ?? '—'} />
          <Stat label="Loss" value={loss?.toFixed(4) ?? '—'} />
          <Stat label="Blend" value={blend?.toFixed(3) ?? '—'} />
        </div>
      </div>

      <TrendChart
        title="RL Reward (48h)"
        data={rewardData}
        lines={[{ key: 'rl_reward', label: 'Reward', color: 'var(--green)' }]}

      />
      <TrendChart
        title="RL Loss (48h)"
        data={lossData}
        lines={[{ key: 'rl_loss', label: 'Loss', color: 'var(--red, #ef4444)' }]}

      />
      <TrendChart
        title="Blend Factor (7d)"
        data={blendData}
        lines={[{ key: 'rl_blend', label: 'Blend', color: 'var(--accent)' }]}

      />
      <TrendChart
        title="Flow Comparison (48h)"
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


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
      <div className="text-[var(--text-muted)] text-xs">{label}</div>
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
