import { useEffect, useState } from 'react'
import type { WeekSchedule, DayName, TimeBlock } from '../../types/schedule'
import { ALL_DAYS } from '../../types/schedule'
import { DayRow } from './DayRow'

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21]

interface WeeklyGridProps {
  schedule: WeekSchedule
  onChange: (schedule: WeekSchedule) => void
  selectedDay?: DayName
  onSelectDay?: (day: DayName) => void
}

export function WeeklyGrid({ schedule, onChange, selectedDay, onSelectDay }: WeeklyGridProps) {
  // Current time marker position (percentage)
  const [nowPct, setNowPct] = useState(0)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const minuteOfDay = now.getHours() * 60 + now.getMinutes()
      setNowPct((minuteOfDay / 1440) * 100)
    }
    update()
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [])

  const handleDayChange = (day: DayName, blocks: TimeBlock[]) => {
    onChange({ ...schedule, [day]: blocks })
  }

  return (
    <div className="space-y-1">
      {/* Hour labels */}
      <div className="flex items-center gap-2">
        <div className="w-10 shrink-0" />
        <div className="flex-1 relative">
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] px-0">
            {HOUR_LABELS.map((h) => (
              <span key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)' }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
            <span style={{ position: 'absolute', right: 0 }}>24</span>
          </div>
          <div className="h-3" />
        </div>
      </div>

      {/* Day rows with current time marker */}
      <div className="relative">
        {ALL_DAYS.map((day) => (
          <div key={day} className="mb-1">
            <DayRow
              day={day}
              blocks={schedule[day] || []}
              onChange={(blocks) => handleDayChange(day, blocks)}
              selected={day === selectedDay}
              onSelect={() => onSelectDay?.(day)}
            />
          </div>
        ))}

        {/* Current time vertical line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
          style={{ left: `calc(2.5rem + 0.5rem + ${nowPct}% * (100% - 2.5rem - 0.5rem) / 100%)` }}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] mt-2 pt-2 border-t border-[var(--border)]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-500/80" />
          <span>Occupied (comfort target)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[var(--bg)] border border-[var(--border)]" />
          <span>Unoccupied (auto setback)</span>
        </div>
      </div>
    </div>
  )
}
