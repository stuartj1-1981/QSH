import { useState, useMemo, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { cn } from '../lib/utils'
import { useStatistics } from '../hooks/useStatistics'

const TIME_PRESETS: { label: string; from: string; interval: string }[] = [
  { label: 'Last 24h', from: '-24h', interval: '1h' },
  { label: 'Last 7d', from: '-7d', interval: '6h' },
  { label: 'Last 30d', from: '-30d', interval: '1d' },
]

function formatTime(epoch: number, rangeFrom: string): string {
  const d = new Date(epoch * 1000)
  if (rangeFrom === '-24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (rangeFrom.includes('T')) {
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const INTERVAL_OPTIONS = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '1d', value: '1d' },
]

export function Statistics() {
  const [timeFrom, setTimeFrom] = useState('-24h')
  const [timeTo, setTimeTo] = useState('now()')
  const [interval, setInterval_] = useState('1h')
  const [useCustomRange, setUseCustomRange] = useState(false)
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return toLocalDatetime(d)
  })
  const [customTo, setCustomTo] = useState(() => toLocalDatetime(new Date()))

  const { available, loading, error, kpis, trendData } = useStatistics(timeFrom, timeTo, interval)

  const handlePreset = useCallback((preset: typeof TIME_PRESETS[number]) => {
    setUseCustomRange(false)
    setTimeFrom(preset.from)
    setTimeTo('now()')
    setInterval_(preset.interval)
  }, [])

  const handleApplyCustomRange = useCallback(() => {
    const fromDate = new Date(customFrom)
    const toDate = new Date(customTo)
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return
    if (fromDate >= toDate) return
    setTimeFrom(fromDate.toISOString())
    setTimeTo(toDate.toISOString())
    const diffMs = toDate.getTime() - fromDate.getTime()
    const diffH = diffMs / (1000 * 60 * 60)
    if (diffH <= 6) setInterval_('1m')
    else if (diffH <= 48) setInterval_('5m')
    else if (diffH <= 168) setInterval_('1h')
    else setInterval_('6h')
  }, [customFrom, customTo])

  const costRateData = useMemo(() => {
    if (!trendData.length) return []
    return trendData.map((p) => {
      // INSTRUCTION-117E Task 5c: read source-portable input power. Fall
      // back to legacy `hp_power_kw` so historical HP data still charts on
      // the cost-rate overlay.
      const power = p.active_source_input_kw ?? p.hp_power_kw
      const tariff = p.tariff_rate
      const cost_rate =
        typeof power === 'number' && power !== null &&
        typeof tariff === 'number' && tariff !== null
          ? power * tariff * 100
          : null
      return { t: p.t, cost_rate }
    })
  }, [trendData])

  // Not-configured state
  if (!loading && !available) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-xl font-bold mb-4">Statistics</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
          <p className="text-[var(--text-muted)] mb-2">
            InfluxDB historian is not configured.
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Enable it in your <code className="bg-[var(--bg)] px-1.5 py-0.5 rounded text-xs">qsh.yaml</code> historian section to access historical data.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <h2 className="text-xl font-bold">Statistics</h2>

      {/* Time range controls */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Range:</span>
          {TIME_PRESETS.map((preset) => (
            <button
              key={preset.from}
              onClick={() => handlePreset(preset)}
              className={cn(
                'px-3 py-2.5 sm:py-1.5 rounded-lg text-xs font-medium transition-colors',
                !useCustomRange && timeFrom === preset.from
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustomRange(true)}
            className={cn(
              'px-3 py-2.5 sm:py-1.5 rounded-lg text-xs font-medium transition-colors',
              useCustomRange
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            Custom
          </button>
        </div>

        {useCustomRange && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-end gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">From</label>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">To</label>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Interval</label>
              <select
                value={interval}
                onChange={(e) => setInterval_(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleApplyCustomRange}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {/* KPI summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Energy" value={kpis?.totalEnergy_kWh} format={(v) => v.toFixed(1)} unit="kWh" loading={loading} />
        <KpiCard label="Cost" value={kpis?.totalCost_pence} format={(v) => v.toFixed(0)} unit="p" loading={loading} />
        <KpiCard label="Avg COP" value={kpis?.avgCop} format={(v) => v.toFixed(2)} unit="" loading={loading} />
        <KpiCard label="Peak Power" value={kpis?.peakPower_kW} format={(v) => v.toFixed(2)} unit="kW" loading={loading} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && trendData.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-sm text-[var(--text-muted)]">
          No data for selected time range.
        </div>
      )}

      {/* COP trend chart */}
      {trendData.length > 0 && (
        <ChartCard title="COP" loading={loading}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="t"
                tickFormatter={(ts) => formatTime(Number(ts), timeFrom)}
                stroke="var(--text-muted)"
                fontSize={10}
                minTickGap={40}
              />
              <YAxis stroke="var(--text-muted)" fontSize={10} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => new Date(Number(label) * 1000).toLocaleString()}
                formatter={(value) => [typeof value === 'number' ? value.toFixed(2) : String(value), 'COP']}
              />
              <Line type="monotone" dataKey="cop" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Power trend chart */}
      {trendData.length > 0 && (
        <ChartCard title="Power" loading={loading}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="t"
                tickFormatter={(ts) => formatTime(Number(ts), timeFrom)}
                stroke="var(--text-muted)"
                fontSize={10}
                minTickGap={40}
              />
              <YAxis stroke="var(--text-muted)" fontSize={10} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => new Date(Number(label) * 1000).toLocaleString()}
                formatter={(value) => [typeof value === 'number' ? value.toFixed(2) : String(value), 'kW']}
              />
              <Line type="monotone" dataKey="active_source_input_kw" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Cost rate chart */}
      {costRateData.length > 0 && trendData.length > 0 && (
        <ChartCard title="Cost Rate (p/h)" loading={loading}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={costRateData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="t"
                tickFormatter={(ts) => formatTime(Number(ts), timeFrom)}
                stroke="var(--text-muted)"
                fontSize={10}
                minTickGap={40}
              />
              <YAxis stroke="var(--text-muted)" fontSize={10} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => new Date(Number(label) * 1000).toLocaleString()}
                formatter={(value) => [typeof value === 'number' ? value.toFixed(2) : String(value), 'p/h']}
              />
              <Line type="monotone" dataKey="cost_rate" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  format,
  unit,
  loading,
}: {
  label: string
  value: number | null | undefined
  format: (v: number) => string
  unit: string
  loading: boolean
}) {
  const display = loading
    ? '--'
    : value != null
      ? format(value)
      : '--'

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="text-2xl font-bold mt-1">{display}</p>
      {unit && <p className="text-xs text-[var(--text-muted)]">{unit}</p>}
    </div>
  )
}

function ChartCard({
  title,
  loading,
  children,
}: {
  title: string
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">{title}</h3>
      {loading ? (
        <div className="flex items-center justify-center h-[240px] text-sm text-[var(--text-muted)]">
          Loading...
        </div>
      ) : (
        children
      )}
    </div>
  )
}
