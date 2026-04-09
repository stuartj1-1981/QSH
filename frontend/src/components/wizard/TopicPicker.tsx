import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, Check, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MqttTopicCandidate } from '../../types/config'

interface TopicPickerProps {
  value: string
  onChange: (topic: string) => void
  placeholder?: string
  scanResults?: MqttTopicCandidate[]
  label?: string
  required?: boolean
}

export function TopicPicker({
  value,
  onChange,
  placeholder,
  scanResults = [],
  label,
  required,
}: TopicPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const filtered = useMemo(() => {
    if (!search) return scanResults
    const q = search.toLowerCase()
    return scanResults.filter((t) => t.topic.toLowerCase().includes(q))
  }, [scanResults, search])

  return (
    <div ref={ref} className="relative">
      {label && (
        <label className="block text-sm font-medium text-[var(--text)] mb-1">
          {label}
          {required && <span className="text-[var(--red)] ml-1">*</span>}
        </label>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Enter MQTT topic...'}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
        />
        {scanResults.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={cn(
              'px-2 py-2 rounded-lg border transition-colors',
              open
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] hover:border-[var(--accent)]/50'
            )}
            title="Browse discovered topics"
          >
            <Search size={14} className="text-[var(--text-muted)]" />
          </button>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-2 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] transition-colors"
            title="Clear"
          >
            <X size={14} className="text-[var(--text-muted)]" />
          </button>
        )}
      </div>

      {open && scanResults.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
            <input
              type="text"
              placeholder="Filter topics..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none text-[var(--text)] placeholder:text-[var(--text-muted)]"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-52">
            {filtered.map((candidate) => (
              <button
                key={candidate.topic}
                onClick={() => {
                  onChange(candidate.topic)
                  setOpen(false)
                  setSearch('')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg)] transition-colors text-left"
              >
                <span className="w-4 shrink-0">
                  {value === candidate.topic && (
                    <Check size={14} className="text-[var(--accent)]" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--text)] truncate">
                      {candidate.topic}
                    </span>
                    {candidate.is_numeric && (
                      <span className="w-2 h-2 rounded-full bg-[var(--green)] shrink-0" title="Numeric" />
                    )}
                    {candidate.suggested_field && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)] shrink-0">
                        {candidate.suggested_field}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--text-muted)] truncate block">
                    {candidate.payload.length > 60
                      ? candidate.payload.slice(0, 60) + '...'
                      : candidate.payload}
                  </span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
                No matching topics
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
