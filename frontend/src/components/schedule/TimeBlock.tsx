import type { TimeBlock as TimeBlockType } from '../../types/schedule'
import { timeToSlot, formatTime } from './timeUtils'

interface TimeBlockProps {
  block: TimeBlockType
  totalSlots: number
  onClick: () => void
  onDelete: () => void
}

export function TimeBlockView({ block, totalSlots, onClick, onDelete }: TimeBlockProps) {
  const startSlot = timeToSlot(block.from)
  const endSlot = timeToSlot(block.to)
  const width = Math.max(endSlot - startSlot, 1)
  const leftPct = (startSlot / totalSlots) * 100
  const widthPct = (width / totalSlots) * 100

  return (
    <div
      className="absolute top-0.5 bottom-0.5 rounded cursor-pointer bg-amber-500/80 hover:bg-amber-500 border border-amber-600/30 flex items-center justify-center group transition-colors"
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {widthPct > 8 && (
        <span className="text-[10px] text-white font-medium truncate px-1">
          {formatTime(block.from)}–{formatTime(block.to)}
        </span>
      )}
      <button
        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none hidden group-hover:flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        x
      </button>
    </div>
  )
}
