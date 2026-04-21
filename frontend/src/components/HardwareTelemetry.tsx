import { memo } from 'react'
import { Thermometer, Droplets, Zap, Wind } from 'lucide-react'

interface HardwareTelemetryProps {
  flowTemp?: number
  returnTemp?: number
  deltaT?: number
  flowRate?: number
  powerKw?: number
  // INSTRUCTION-120C: `number | null` — null means the backend has gated
  // the value (HP off or performance in sensor-loss fallback). `0` is a
  // legitimate value to render (e.g. genuine zero-ratio readings) and
  // must NOT be suppressed — only `null`/`undefined` map to '—'.
  cop?: number | null
  outdoorTemp?: number
  /** Set of sensor keys that are configured. When provided, only configured sensors are shown. */
  configured?: Set<string>
}

export const HardwareTelemetry = memo(function HardwareTelemetry({
  flowTemp, returnTemp, deltaT, flowRate, powerKw, cop, outdoorTemp, configured,
}: HardwareTelemetryProps) {
  const show = (key: string) => !configured || configured.has(key)

  const items: React.ReactNode[] = []

  if (show('flow_temp'))
    items.push(
      <TelemetryItem key="flow" icon={<Thermometer size={16} className="text-red-500" />}
        label="Flow" value={flowTemp != null ? `${flowTemp.toFixed(1)}°C` : '—'} />
    )
  if (show('return_temp'))
    items.push(
      <TelemetryItem key="return" icon={<Thermometer size={16} className="text-blue-500" />}
        label="Return" value={returnTemp != null ? `${returnTemp.toFixed(1)}°C` : '—'} />
    )
  if (show('delta_t'))
    items.push(
      <TelemetryItem key="delta_t" icon={<Thermometer size={16} className="text-[var(--accent)]" />}
        label="Delta T" value={deltaT != null ? `${deltaT.toFixed(1)}°C` : '—'} />
    )
  if (show('flow_rate'))
    items.push(
      <TelemetryItem key="flow_rate" icon={<Droplets size={16} className="text-[var(--blue)]" />}
        label="Flow Rate" value={flowRate != null ? `${flowRate.toFixed(2)} l/m` : '—'} />
    )
  if (show('power'))
    items.push(
      <TelemetryItem key="power" icon={<Zap size={16} className="text-[var(--amber)]" />}
        label="HP Power" value={powerKw != null ? `${powerKw.toFixed(1)} kW` : '—'} />
    )
  if (show('cop'))
    items.push(
      <TelemetryItem key="cop" icon={<Zap size={16} className="text-[var(--green)]" />}
        label="COP" value={cop != null ? cop.toFixed(1) : '—'} />
    )
  if (show('outdoor_temp'))
    items.push(
      <TelemetryItem key="outdoor" icon={<Wind size={16} className="text-[var(--blue)]" />}
        label="Outdoor" value={outdoorTemp != null ? `${outdoorTemp.toFixed(1)}°C` : '—'} />
    )

  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3">HARDWARE TELEMETRY</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items}
      </div>
    </div>
  )
})

function TelemetryItem({
  icon, label, value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-sm font-semibold font-mono">{value}</div>
    </div>
  )
}
