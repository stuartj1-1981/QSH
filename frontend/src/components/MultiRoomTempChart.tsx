import { memo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { RoomHistoryData } from '../hooks/useHistory'

interface MultiRoomTempChartProps {
  roomHistory: RoomHistoryData
}

const ROOM_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7',
]

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export const MultiRoomTempChart = memo(function MultiRoomTempChart({ roomHistory }: MultiRoomTempChartProps) {
  const roomNames = Object.keys(roomHistory)
  if (roomNames.length === 0) return null

  // Merge all room data into a single timeline keyed by timestamp
  const timeMap = new Map<number, Record<string, number | null>>()
  for (const [room, points] of Object.entries(roomHistory)) {
    for (const p of points) {
      const t = p.t as number
      if (!timeMap.has(t)) timeMap.set(t, { t } as Record<string, number | null>)
      const row = timeMap.get(t)!
      row[room] = p.temp as number | null
    }
  }

  const data = Array.from(timeMap.values()).sort((a, b) => (a.t as number) - (b.t as number))

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-4">
      <h3 className="text-sm font-semibold mb-2">All Room Temperatures (24h)</h3>
      <ResponsiveContainer width="100%" height={250}>
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
            unit=" °C"
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelFormatter={(label) => formatTime(Number(label))}
            formatter={(value, name) => [
              typeof value === 'number' ? `${value.toFixed(1)}°C` : '—',
              String(name).replace(/_/g, ' '),
            ]}
          />
          {roomNames.map((room, i) => (
            <Line
              key={room}
              type="monotone"
              dataKey={room}
              stroke={ROOM_COLORS[i % ROOM_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              name={room}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-2">
        {roomNames.map((room, i) => (
          <div key={room} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length] }}
            />
            {room.replace(/_/g, ' ')}
          </div>
        ))}
      </div>
    </div>
  )
})
