import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, Check, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { EntityCandidate } from '../../types/config'

interface EntityPickerProps {
  slot: string
  room?: string
  value: string
  onChange: (entityId: string) => void
  candidates?: EntityCandidate[]
  required?: boolean
  label?: string
}

export function EntityPicker({
  slot,
  value,
  onChange,
  candidates = [],
  required = false,
  label,
}: EntityPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click or Escape key
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
    if (!search) return candidates
    const q = search.toLowerCase()
    return candidates.filter(
      (c) =>
        c.entity_id.toLowerCase().includes(q) ||
        c.friendly_name.toLowerCase().includes(q)
    )
  }, [candidates, search])

  const selectedName = candidates.find((c) => c.entity_id === value)?.friendly_name

  return (
    <div ref={ref} className="relative">
      {label && (
        <label className="block text-sm font-medium text-[var(--text)] mb-1">
          {label}
          {required && <span className="text-[var(--red)] ml-1">*</span>}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm text-left',
          'bg-[var(--bg)] border-[var(--border)] text-[var(--text)]',
          'hover:border-[var(--accent)]/50 transition-colors'
        )}
      >
        <span className={value ? '' : 'text-[var(--text-muted)]'}>
          {value ? (
            <span>
              <span className="font-medium">{selectedName || value}</span>
              {selectedName && (
                <span className="text-[var(--text-muted)] ml-2 text-xs">{value}</span>
              )}
            </span>
          ) : (
            `Select ${slot.replace(/_/g, ' ')}...`
          )}
        </span>
        {value && (
          <X
            size={14}
            className="text-[var(--text-muted)] hover:text-[var(--text)] shrink-0 ml-2"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
              setOpen(false)
            }}
          />
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
            <input
              type="text"
              placeholder="Search entities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none text-[var(--text)] placeholder:text-[var(--text-muted)]"
              autoFocus
            />
          </div>

          <div className="overflow-y-auto max-h-52">
            {/* None / Skip option */}
            {!required && (
              <button
                onClick={() => {
                  onChange('')
                  setOpen(false)
                  setSearch('')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg)] transition-colors"
              >
                <span className="w-4">{!value && <Check size={14} />}</span>
                None / Skip
              </button>
            )}

            {filtered.map((candidate, i) => (
              <button
                key={candidate.entity_id}
                onClick={() => {
                  onChange(candidate.entity_id)
                  setOpen(false)
                  setSearch('')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg)] transition-colors text-left"
              >
                <span className="w-4 shrink-0">
                  {value === candidate.entity_id && (
                    <Check size={14} className="text-[var(--accent)]" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--text)] truncate">
                      {candidate.friendly_name}
                    </span>
                    {i === 0 && candidates.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)] shrink-0">
                        Suggested
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span className="truncate">{candidate.entity_id}</span>
                    <span>= {candidate.state}{candidate.unit ? ` ${candidate.unit}` : ''}</span>
                  </div>
                </div>
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
                No matching entities found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
