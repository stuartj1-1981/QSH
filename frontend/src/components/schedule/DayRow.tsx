import { useRef, useState, useCallback } from 'react'
import type { TimeBlock, DayName } from '../../types/schedule'
import { DAY_LABELS } from '../../types/schedule'
import { TimeBlockView } from './TimeBlock'
import { timeToSlot, slotToTime } from './timeUtils'
import { TimeBlockEditor } from './TimeBlockEditor'
import { cn } from '../../lib/utils'

const TOTAL_SLOTS = 96 // 24h * 4 (15-min)

interface DayRowProps {
  day: DayName
  blocks: TimeBlock[]
  onChange: (blocks: TimeBlock[]) => void
  selected?: boolean
  onSelect?: () => void
}

export function DayRow({ day, blocks, onChange, selected, onSelect }: DayRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [dragging, setDragging] = useState<{ startSlot: number; endSlot: number } | null>(null)

  const getSlotFromX = useCallback((clientX: number): number => {
    if (!rowRef.current) return 0
    const rect = rowRef.current.getBoundingClientRect()
    const pct = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(TOTAL_SLOTS, Math.round(pct * TOTAL_SLOTS)))
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle clicks on the empty area
    if ((e.target as HTMLElement).closest('[data-block]')) return
    const slot = getSlotFromX(e.clientX)
    setDragging({ startSlot: slot, endSlot: slot })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    const slot = getSlotFromX(e.clientX)
    setDragging({ ...dragging, endSlot: slot })
  }

  const handleMouseUp = () => {
    if (!dragging) return
    const s = Math.min(dragging.startSlot, dragging.endSlot)
    const e = Math.max(dragging.startSlot, dragging.endSlot)
    if (e - s >= 1) {
      const newBlock: TimeBlock = { from: slotToTime(s), to: slotToTime(e) }
      onChange([...blocks, newBlock])
    }
    setDragging(null)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-block]')) return
    const slot = getSlotFromX(e.touches[0].clientX)
    setDragging({ startSlot: slot, endSlot: slot })
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return
    const slot = getSlotFromX(e.touches[0].clientX)
    setDragging({ ...dragging, endSlot: slot })
  }

  const handleTouchEnd = () => {
    handleMouseUp()
  }

  const handleDeleteBlock = (idx: number) => {
    onChange(blocks.filter((_, i) => i !== idx))
    setEditIdx(null)
  }

  const handleUpdateBlock = (idx: number, updated: TimeBlock) => {
    // Handle cross-midnight split
    const fromSlot = timeToSlot(updated.from)
    const toSlot = timeToSlot(updated.to)
    const newBlocks = blocks.filter((_, i) => i !== idx)

    if (toSlot <= fromSlot && toSlot > 0) {
      // Cross-midnight: split into two blocks
      newBlocks.push({ from: updated.from, to: '23:59:59' })
      newBlocks.push({ from: '00:00:00', to: updated.to })
    } else {
      newBlocks.push(updated)
    }
    onChange(newBlocks)
  }

  // Render drag preview
  const dragPreview = dragging
    ? (() => {
        const s = Math.min(dragging.startSlot, dragging.endSlot)
        const e = Math.max(dragging.startSlot, dragging.endSlot)
        const leftPct = (s / TOTAL_SLOTS) * 100
        const widthPct = ((e - s) / TOTAL_SLOTS) * 100
        return (
          <div
            className="absolute top-0.5 bottom-0.5 rounded bg-amber-500/40 border border-amber-500/60 pointer-events-none"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        )
      })()
    : null

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onSelect}
        className={cn(
          'w-10 text-xs font-medium shrink-0 rounded py-1 text-center transition-colors',
          selected
            ? 'bg-[var(--accent)]/15 text-[var(--accent)] ring-1 ring-[var(--accent)]/30'
            : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]'
        )}
      >
        {DAY_LABELS[day]}
      </button>
      <div
        ref={rowRef}
        className="relative flex-1 h-8 bg-[var(--bg)] rounded border border-[var(--border)] cursor-crosshair select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (dragging) handleMouseUp() }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {blocks.map((block, idx) => (
          <div key={idx} data-block>
            <TimeBlockView
              block={block}
              totalSlots={TOTAL_SLOTS}
              onClick={() => setEditIdx(idx)}
              onDelete={() => handleDeleteBlock(idx)}
            />
          </div>
        ))}
        {dragPreview}
      </div>

      {editIdx !== null && blocks[editIdx] && (
        <TimeBlockEditor
          block={blocks[editIdx]}
          onSave={(updated) => handleUpdateBlock(editIdx, updated)}
          onDelete={() => handleDeleteBlock(editIdx)}
          onClose={() => setEditIdx(null)}
        />
      )}
    </div>
  )
}
