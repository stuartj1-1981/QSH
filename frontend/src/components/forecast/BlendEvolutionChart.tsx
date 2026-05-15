import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Activity } from 'lucide-react'

interface BlendEvolutionChartProps {
  historianData: { points: Array<Record<string, unknown>> } | null
  loading: boolean
  error: string | null
}

export function BlendEvolutionChart({
  historianData, loading, error,
}: BlendEvolutionChartProps) {
  if (loading) {
    return (
      <div className="p-4 bg-[var(--bg-card)] rounded-lg text-[var(--text-muted)]">
        Loading blend-factor evolution...
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4 bg-[var(--bg-card)] rounded-lg text-red-500" role="alert">
        Error: {error}
      </div>
    )
  }
  const points = historianData?.points ?? []
  if (points.length === 0) {
    return (
      <div className="p-4 bg-[var(--bg-card)] rounded-lg text-[var(--text-muted)]">
        Forecast is still learning. The chart will populate once enough comparison data has been collected against real outcomes — typically a few days of operation.
      </div>
    )
  }
  const chartData = points.map((p) => ({
    time: typeof p['time'] === 'number' ? p['time'] * 1000 : 0,
    blend_factor: typeof p['blend_factor'] === 'number' ? p['blend_factor'] : null,
    step_c: typeof p['step_c'] === 'number' ? p['step_c'] : null,
  }))
  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Activity size={18} /> RL Blend-Factor Evolution
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="time"
            tickFormatter={(t) => new Date(t).toLocaleDateString()}
            stroke="var(--text-muted)"
          />
          <YAxis domain={[0, 1]} stroke="var(--text-muted)" />
          <Tooltip
            labelFormatter={(t) => new Date(t).toLocaleString()}
            formatter={(value, name) => [
              value,
              name === 'blend_factor' ? 'Forecast influence' : name,
            ]}
          />
          <Line
            type="monotone"
            dataKey="blend_factor"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
