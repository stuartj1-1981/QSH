import { useState } from 'react'
import { Copy } from 'lucide-react'
import type { PresetName, DayName } from '../../types/schedule'
import { DAY_LABELS, ALL_DAYS } from '../../types/schedule'
import { cn } from '../../lib/utils'
import { PresetSelector } from './PresetSelector'

interface ScheduleToolbarProps {
  rooms: string[]
  selectedRoom: string
  onRoomChange: (room: string) => void
  onPreset?: (preset: PresetName) => void
  onCopy?: (targetRooms: string[]) => void
  sourceDay: DayName
  onApplyToWeekdays?: () => void
  onApplyToWeekend?: () => void
  onApplyToAll?: () => void
  onCopyToDay?: (day: DayName) => void
  enabled: boolean
  onToggleEnabled?: (enabled: boolean) => void
  presetLoading?: boolean
  copyLoading?: boolean
  /** When true, all controls except the room selector are disabled */
  disabled?: boolean
}

export function ScheduleToolbar({
  rooms,
  selectedRoom,
  onRoomChange,
  onPreset,
  onCopy,
  sourceDay,
  onApplyToWeekdays,
  onApplyToWeekend,
  onApplyToAll,
  onCopyToDay,
  enabled,
  onToggleEnabled,
  presetLoading,
  copyLoading,
  disabled,
}: ScheduleToolbarProps) {
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyTargets, setCopyTargets] = useState<string[]>([])

  const otherRooms = rooms.filter((r) => r !== selectedRoom)

  const displayName = (name: string) =>
    name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center gap-3 mb-4">
        {/* Room selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--text-muted)]">Room:</label>
          <select
            value={selectedRoom}
            onChange={(e) => onRoomChange(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm font-medium"
          >
            {rooms.map((r) => (
              <option key={r} value={r}>
                {displayName(r)}
              </option>
            ))}
          </select>
        </div>

        {/* Preset */}
        {!disabled && onPreset && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Preset:</label>
            <PresetSelector onSelect={onPreset} loading={presetLoading} />
          </div>
        )}

        {/* Copy */}
        {!disabled && onCopy && otherRooms.length > 0 && (
          <button
            onClick={() => setShowCopyModal(true)}
            disabled={copyLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm hover:bg-[var(--bg-card)]"
          >
            <Copy size={14} />
            Copy to...
          </button>
        )}

        {/* Copy current day */}
        {!disabled && (
          <div className="flex flex-wrap items-center gap-1 sm:col-span-2 lg:col-span-1">
            <span className="text-xs text-[var(--text-muted)] shrink-0">
              Copy {DAY_LABELS[sourceDay]}:
            </span>
            <button
              onClick={onApplyToWeekdays}
              className="px-2.5 py-2.5 sm:py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs hover:bg-[var(--bg-card)]"
            >
              → Weekdays
            </button>
            <button
              onClick={onApplyToWeekend}
              className="px-2.5 py-2.5 sm:py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs hover:bg-[var(--bg-card)]"
            >
              → Weekend
            </button>
            <button
              onClick={onApplyToAll}
              className="px-2.5 py-2.5 sm:py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs hover:bg-[var(--bg-card)]"
            >
              → All 7
            </button>
            {/* Individual day targets */}
            <span className="text-xs text-[var(--border)] mx-0.5 select-none">|</span>
            {ALL_DAYS.map((day) => (
              <button
                key={day}
                onClick={() => onCopyToDay?.(day)}
                disabled={day === sourceDay}
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium transition-colors',
                  day === sourceDay
                    ? 'opacity-30 cursor-not-allowed bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]'
                    : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)]'
                )}
              >
                → {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Enable toggle */}
      {!disabled && onToggleEnabled && (
        <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="rounded"
          />
          Occupancy scheduling enabled for this room
        </label>
      )}

      {/* Copy modal */}
      {showCopyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCopyModal(false)} />
          <div className="relative bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 sm:p-5 w-full max-w-xs shadow-xl">
            <h3 className="text-sm font-semibold mb-3">Copy schedule to:</h3>
            <div className="space-y-2 mb-4">
              {otherRooms.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyTargets.includes(r)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCopyTargets([...copyTargets, r])
                      } else {
                        setCopyTargets(copyTargets.filter((t) => t !== r))
                      }
                    }}
                    className="rounded"
                  />
                  {displayName(r)}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onCopy?.(copyTargets)
                  setShowCopyModal(false)
                  setCopyTargets([])
                }}
                disabled={copyTargets.length === 0}
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
              >
                Copy
              </button>
              <button
                onClick={() => { setShowCopyModal(false); setCopyTargets([]) }}
                className="px-3 py-2 rounded-lg bg-[var(--bg)] text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
