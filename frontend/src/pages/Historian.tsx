import { useState, useMemo, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Download } from 'lucide-react'
import { cn } from '../lib/utils'
import {
  useHistorianMeasurements,
  useHistorianQuery,
  useHistorianTags,
  useHistorianFields,
} from '../hooks/useHistorian'

const LINE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b']

const TIME_PRESETS: { label: string; from: string; interval: string }[] = [
  { label: 'Last 24h', from: '-24h', interval: '5m' },
  { label: 'Last 7d', from: '-7d', interval: '1h' },
  { label: 'Last 30d', from: '-30d', interval: '6h' },
]

const INTERVAL_OPTIONS = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '1d', value: '1d' },
]

function formatTime(epoch: number, rangeFrom: string): string {
  const d = new Date(epoch * 1000)
  // For short ranges (preset -24h or custom ranges < 48h), show time only
  if (rangeFrom === '-24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  // For custom ISO ranges, show both date and time
  if (rangeFrom.includes('T')) {
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Return a local datetime string suitable for datetime-local input (YYYY-MM-DDTHH:MM). */
function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Historian() {
  const { data: measurementsData, loading: measLoading } = useHistorianMeasurements()

  const [measurement, setMeasurement] = useState('qsh_system')
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [room, setRoom] = useState<string | undefined>(undefined)
  const [timeFrom, setTimeFrom] = useState('-24h')
  const [timeTo, setTimeTo] = useState('now()')
  const [interval, setInterval_] = useState('5m')
  const [aggregation, setAggregation] = useState('mean')
  const [useCustomRange, setUseCustomRange] = useState(false)
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return toLocalDatetime(d)
  })
  const [customTo, setCustomTo] = useState(() => toLocalDatetime(new Date()))

  const { rooms } = useHistorianTags(measurement)
  const { fields: availableFields, loading: fieldsLoading } = useHistorianFields(measurement)

  const { data: queryData, loading: queryLoading, error: queryError, refetch } = useHistorianQuery(
    measurement,
    selectedFields,
    { room, timeFrom, timeTo, interval, aggregation },
  )

  const handleMeasurementChange = useCallback((m: string) => {
    setMeasurement(m)
    setSelectedFields([])
    setRoom(undefined)
  }, [])

  const handleFieldToggle = useCallback((field: string) => {
    setSelectedFields((prev) => {
      if (prev.includes(field)) return prev.filter((f) => f !== field)
      if (prev.length >= 4) return prev
      return [...prev, field]
    })
  }, [])

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
    // Auto-select a sensible interval based on range duration
    const diffMs = toDate.getTime() - fromDate.getTime()
    const diffH = diffMs / (1000 * 60 * 60)
    if (diffH <= 6) setInterval_('1m')
    else if (diffH <= 48) setInterval_('5m')
    else if (diffH <= 168) setInterval_('1h')
    else setInterval_('6h')
  }, [customFrom, customTo])

  const chartData = useMemo(() => {
    if (!queryData?.points) return []
    return queryData.points
  }, [queryData])

  const handleExportCsv = useCallback(() => {
    if (!chartData.length || !selectedFields.length) return
    const headers = ['timestamp', ...selectedFields]
    const rows = chartData.map((p) => {
      const ts = new Date(p.t * 1000).toISOString()
      const vals = selectedFields.map((f) => p[f] ?? '')
      return [ts, ...vals].join(',')
    })
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qsh_${measurement}_${timeFrom}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [chartData, selectedFields, measurement, timeFrom])

  // Historian not available
  if (!measLoading && measurementsData && !measurementsData.available) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-xl font-bold mb-4">Historian</h2>
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
      <h2 className="text-xl font-bold">Historian</h2>

      {/* Controls */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3">
        {/* Row 1: Measurement + Room */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Measurement</label>
            <select
              value={measurement}
              onChange={(e) => handleMeasurementChange(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              {measurementsData?.measurements.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              )) ?? <option value="qsh_system">qsh_system</option>}
            </select>
          </div>

          {rooms.length > 0 && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Room</label>
              <select
                value={room ?? ''}
                onChange={(e) => setRoom(e.target.value || undefined)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              >
                <option value="">All rooms</option>
                {rooms.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Aggregation</label>
            <select
              value={aggregation}
              onChange={(e) => setAggregation(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              <option value="mean">Mean</option>
              <option value="max">Max</option>
              <option value="min">Min</option>
            </select>
          </div>
        </div>

        {/* Row 2: Time range — presets + custom */}
        <div className="space-y-2">
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

        {/* Row 3: Field selection */}
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">
            Fields (max 4)
          </label>
          {fieldsLoading ? (
            <p className="text-xs text-[var(--text-muted)]">Loading fields...</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {availableFields.map((f) => (
                <button
                  key={f}
                  onClick={() => handleFieldToggle(f)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                    selectedFields.includes(f)
                      ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/30',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Row 4: Actions */}
        <div className="flex gap-2">
          <button
            onClick={refetch}
            disabled={selectedFields.length === 0 || queryLoading}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              selectedFields.length > 0
                ? 'bg-[var(--accent)] text-white hover:opacity-90'
                : 'bg-[var(--bg)] text-[var(--text-muted)] cursor-not-allowed',
            )}
          >
            {queryLoading ? 'Loading...' : 'Query'}
          </button>
          {chartData.length > 0 && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <Download size={14} />
              CSV
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      {queryError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
          {queryError}
        </div>
      )}

      {chartData.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          {/* 280px compromise: fits 375px mobile without wasting desktop space. TODO: resize-aware hook */}
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="t"
                tickFormatter={(ts) => formatTime(Number(ts), timeFrom)}
                stroke="var(--text-muted)"
                fontSize={10}
                minTickGap={40}
              />
              <YAxis stroke="var(--text-muted)" fontSize={10} width={40} />
              {selectedFields.length > 1 && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--text-muted)"
                  fontSize={10}
                  width={40}
                />
              )}
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => {
                  const d = new Date(Number(label) * 1000)
                  return d.toLocaleString()
                }}
                formatter={(value) => [
                  typeof value === 'number' ? value.toFixed(2) : String(value),
                ]}
              />
              <Legend />
              {selectedFields.map((field, i) => (
                <Line
                  key={field}
                  type="monotone"
                  dataKey={field}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  yAxisId={i >= 2 ? 'right' : undefined}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {selectedFields.length > 0 && chartData.length === 0 && !queryLoading && !queryError && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-sm text-[var(--text-muted)]">
          No data for selected fields and time range.
        </div>
      )}
    </div>
  )
}
