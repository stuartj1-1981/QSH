import { memo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { HistoryPoint } from '../hooks/useHistory'

interface TrendLine {
  key: string
  label: string
  color: string
}

interface TrendChartProps {
  title: string
  data: HistoryPoint[]
  lines: TrendLine[]
  yUnit?: string
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export const TrendChart = memo(function TrendChart({ title, data, lines, yUnit }: TrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-4">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <div className="text-xs text-[var(--text-muted)] text-center py-8">
          No history data yet — collecting...
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="t"
            tickFormatter={formatTime}
            stroke="var(--text-muted)"
            fontSize={10}
            minTickGap={40}
          />
          <YAxis
            stroke="var(--text-muted)"
            fontSize={10}
            unit={yUnit ? ` ${yUnit}` : ''}
            width={35}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelFormatter={(label) => formatTime(Number(label))}
            formatter={(value, name) => {
              const line = lines.find(l => l.key === name)
              return [typeof value === 'number' ? value.toFixed(1) : String(value), line?.label ?? String(name)]
            }}
          />
          {lines.map(line => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.key}
              stroke={line.color}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})
