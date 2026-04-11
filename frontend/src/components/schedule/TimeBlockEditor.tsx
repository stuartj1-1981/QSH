import { useState } from 'react'
import type { TimeBlock } from '../../types/schedule'
import { formatTime } from './timeUtils'

interface TimeBlockEditorProps {
  block: TimeBlock
  onSave: (updated: TimeBlock) => void
  onDelete: () => void
  onClose: () => void
}

export function TimeBlockEditor({ block, onSave, onDelete, onClose }: TimeBlockEditorProps) {
  const [from, setFrom] = useState(formatTime(block.from))
  const [to, setTo] = useState(formatTime(block.to))

  const handleSave = () => {
    onSave({ from: `${from}:00`, to: `${to}:00` })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 w-full max-w-xs shadow-xl">
        <h3 className="text-sm font-semibold mb-4">Edit Time Block</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--text-muted)]">From</label>
            <input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)]">To</label>
            <input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
          >
            Save
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-sm font-medium"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-[var(--bg)] text-[var(--text-muted)] text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
