import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { cn, formatScop, formatKwh } from '../lib/utils'
import { useScop } from '../hooks/useScop'
import { useHistorianQuery } from '../hooks/useHistorian'
import type { ScopWindow, ScopMode, ScopResponse } from '../types/api'

const WINDOW_OPTIONS: Array<{ value: ScopWindow; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'season', label: 'Season' },
]

const MODE_TITLES: Record<ScopMode, string> = {
  combined: 'Combined',
  ch: 'CH',
  hw: 'HW',
}

const MODE_DESCRIPTIONS: Record<ScopMode, string> = {
  combined: 'Total heat output / total electrical input',
  ch: 'Space heating only (Combined − HW)',
  hw: 'Domestic hot water only',
}

function windowToHistorianRange(window: ScopWindow): {
  from: string
  interval: string
} {
  switch (window) {
    case 'today':
      return { from: '-24h', interval: '15m' }
    case '7d':
      return { from: '-7d', interval: '1h' }
    case '30d':
      return { from: '-30d', interval: '6h' }
    case '90d':
      return { from: '-90d', interval: '1d' }
    case 'season':
      return { from: '-180d', interval: '1d' }
  }
}

export function Scop() {
  const [window, setWindow] = useState<ScopWindow>(() => {
    const saved = localStorage.getItem('qsh-scop-window') as ScopWindow | null
    return saved && WINDOW_OPTIONS.some((o) => o.value === saved) ? saved : '30d'
  })

  useEffect(() => {
    localStorage.setItem('qsh-scop-window', window)
  }, [window])

  const combined = useScop(window, 'combined')
  const ch = useScop(window, 'ch')
  const hw = useScop(window, 'hw')

  const allUnavailable =
    combined.data?.available === false &&
    ch.data?.available === false &&
    hw.data?.available === false

  const deployBannerVisible = Boolean(
    combined.data?.data_quality?.deploy_date_in_window ||
      ch.data?.data_quality?.deploy_date_in_window ||
      hw.data?.data_quality?.deploy_date_in_window,
  )

  if (allUnavailable) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <PageHeader />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
          <p className="text-[var(--text-muted)]">
            {combined.data?.message ??
              'SCOP reporting is heat-pump-specific. Active source is not a heat pump.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <PageHeader />

      <WindowPicker selected={window} onSelect={setWindow} />

      {deployBannerVisible && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-400">
          Window spans the 191A deploy date — CH SCOP may be biased downward by
          pre-deploy DHW cycles.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ScopCard
          mode="combined"
          window={window}
          state={combined}
        />
        <ScopCard
          mode="ch"
          window={window}
          state={ch}
        />
        <ScopCard
          mode="hw"
          window={window}
          state={hw}
        />
      </div>
    </div>
  )
}

function PageHeader() {
  return (
    <div>
      <h2 className="text-xl font-bold">
        SCOP — Seasonal Coefficient of Performance
      </h2>
      <p className="text-sm text-[var(--text-muted)] mt-1">
        Σ thermal kWh / Σ electrical kWh, attributed by mode at sample time.
      </p>
    </div>
  )
}

function WindowPicker({
  selected,
  onSelect,
}: {
  selected: ScopWindow
  onSelect: (w: ScopWindow) => void
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-2 inline-flex flex-wrap gap-1">
      {WINDOW_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            selected === opt.value
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

interface ScopCardState {
  data: ScopResponse | null
  loading: boolean
  error: string | null
}

function ScopCard({
  mode,
  window,
  state,
}: {
  mode: ScopMode
  window: ScopWindow
  state: ScopCardState
}) {
  const { data, loading, error } = state
  const title = MODE_TITLES[mode]
  const description = MODE_DESCRIPTIONS[mode]

  const unavailable = data?.available === false

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col">
      <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
        {title}
      </p>
      <p className="text-3xl font-bold mt-1">
        {loading
          ? '—'
          : unavailable
            ? '—'
            : formatScop(data?.scop)}
      </p>
      <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>

      {!unavailable && !loading && data && (
        <p className="text-xs text-[var(--text-muted)] mt-2">
          {formatKwh(data.thermal_kwh)} thermal /{' '}
          {formatKwh(data.electrical_kwh)} electrical
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}

      <div className="mt-3 h-[80px]">
        <CardSparkline mode={mode} window={window} disabled={unavailable} />
      </div>
    </div>
  )
}

function CardSparkline({
  mode,
  window,
  disabled,
}: {
  mode: ScopMode
  window: ScopWindow
  disabled: boolean
}) {
  if (mode === 'ch') {
    /* CH sparkline — deferred per INSTRUCTION-191D Task 3 point 4 (V2 LOW-5).
       Derivation approach when revisited:
         1. Fetch qsh_system.cop and qsh_dhw.cop over the same window/interval.
         2. Time-align both series on the InfluxDB GROUP BY time bucket.
         3. For each bucket: if qsh_dhw has a sample at that timestamp, the
            bucket is HW-dominated → exclude from CH trace; else render the
            qsh_system.cop value.
         4. Edge case: bucket interval > cycle period — multiple cycles per
            bucket, mixed mode possible. Either tighten interval to the
            cycle period (heavy on UI) or display CH as energy-weighted
            per-bucket rather than instantaneous CoP (matches the SCOP
            arithmetic but diverges from the sparkline framing of the other
            two cards). Decision deferred to follow-up instruction.
       The Combined and HW sparklines render natively from their measurements
       and do not need this treatment. */
    // TODO(191D-followup): see comment above for the derivation approach.
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-[var(--text-muted)]">
        sparkline pending
      </div>
    )
  }

  return (
    <ScopSparkline
      measurement={mode === 'combined' ? 'qsh_system' : 'qsh_dhw'}
      window={window}
      disabled={disabled}
    />
  )
}

function ScopSparkline({
  measurement,
  window,
  disabled,
}: {
  measurement: 'qsh_system' | 'qsh_dhw'
  window: ScopWindow
  disabled: boolean
}) {
  const range = windowToHistorianRange(window)
  const { data, loading, error } = useHistorianQuery(
    disabled ? '' : measurement,
    disabled ? [] : ['cop'],
    { timeFrom: range.from, timeTo: 'now()', interval: range.interval },
  )

  if (disabled) {
    return null
  }
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-[var(--text-muted)]">
        loading…
      </div>
    )
  }
  if (error || !data?.points || data.points.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-[var(--text-muted)]">
        no data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data.points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <XAxis dataKey="t" hide />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontSize: '11px',
          }}
          labelFormatter={(label) =>
            new Date(Number(label) * 1000).toLocaleString()
          }
          formatter={(value) => [
            typeof value === 'number' ? value.toFixed(2) : String(value),
            'CoP',
          ]}
        />
        <Line
          type="monotone"
          dataKey="cop"
          stroke="var(--accent)"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
