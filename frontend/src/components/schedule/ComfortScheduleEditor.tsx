import { useState, useEffect, useCallback, useReducer } from 'react'
import { Clock, Plus, Trash2, AlertCircle, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useComfortSchedule, useUpdateComfortSchedule } from '../../hooks/useComfortSchedule'
import type { ComfortPeriod } from '../../types/schedule'

// Validation constants — match backend (comfort_schedule.py)
const COMFORT_TEMP_MIN = 15.0
const COMFORT_TEMP_MAX = 25.0
const MAX_PERIODS = 8

interface PeriodRow extends ComfortPeriod {
  /** Client-side key for React list rendering */
  _key: number
}

function fromRows(rows: PeriodRow[]): ComfortPeriod[] {
  return rows.map(({ from, to, temp }) => ({ from, to, temp }))
}

let _nextKey = 0
function assignKeys(periods: ComfortPeriod[]): PeriodRow[] {
  return periods.map((p) => ({ ...p, _key: _nextKey++ }))
}

interface EditorState {
  enabled: boolean
  rows: PeriodRow[]
  dirty: boolean
  syncKey: string
}

type EditorAction =
  | { type: 'sync'; enabled: boolean; rows: PeriodRow[]; syncKey: string }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'setRows'; rows: PeriodRow[] }
  | { type: 'clearDirty' }

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'sync':
      if (action.syncKey === state.syncKey) return state
      return { enabled: action.enabled, rows: action.rows, dirty: false, syncKey: action.syncKey }
    case 'setEnabled':
      return { ...state, enabled: action.enabled }
    case 'setRows':
      return { ...state, rows: action.rows, dirty: true }
    case 'clearDirty':
      return { ...state, dirty: false }
  }
}

export function ComfortScheduleEditor() {
  const { data, loading, refetch } = useComfortSchedule()
  const { update, setEnabled: patchEnabled, loading: saving, error: saveError } = useUpdateComfortSchedule()

  const [state, dispatch] = useReducer(editorReducer, {
    enabled: false,
    rows: [],
    dirty: false,
    syncKey: '',
  })

  const { enabled, rows, dirty } = state

  // Sync from server data (render-phase sync via reducer — no effect needed)
  const syncKey = data ? JSON.stringify(data.periods) + String(data.enabled) : ''
  if (data && syncKey !== state.syncKey) {
    dispatch({ type: 'sync', enabled: data.enabled, rows: assignKeys(data.periods), syncKey })
  }

  const [saveSuccess, setSaveSuccess] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  // Clear success indicator after 2s
  useEffect(() => {
    if (!saveSuccess) return
    const t = setTimeout(() => setSaveSuccess(false), 2000)
    return () => clearTimeout(t)
  }, [saveSuccess])

  // Toggle — calls PATCH immediately
  const handleToggle = useCallback(async () => {
    const next = !enabled
    dispatch({ type: 'setEnabled', enabled: next }) // Optimistic UI
    setToggleError(null)
    try {
      await patchEnabled(next)
      refetch()
    } catch (e: unknown) {
      dispatch({ type: 'setEnabled', enabled: !next }) // Revert on failure
      const msg = e instanceof Error ? e.message : 'Toggle failed'
      setToggleError(msg)
    }
  }, [enabled, patchEnabled, refetch])

  // Add period with smart defaults
  const handleAddPeriod = () => {
    let from = '07:00'
    let to = '22:00'
    if (rows.length > 0) {
      from = '00:00'
      to = '06:00'
    }
    const newPeriod: PeriodRow = {
      from,
      to,
      temp: 20.0,
      _key: _nextKey++,
    }
    dispatch({ type: 'setRows', rows: [...rows, newPeriod] })
  }

  const handleDeletePeriod = (key: number) => {
    dispatch({ type: 'setRows', rows: rows.filter((r) => r._key !== key) })
  }

  const handlePeriodChange = (key: number, field: 'from' | 'to' | 'temp', value: string | number) => {
    dispatch({ type: 'setRows', rows: rows.map((r) => {
      if (r._key !== key) return r
      if (field === 'temp') {
        const temp = Math.round((value as number) * 2) / 2
        return { ...r, temp: Math.max(COMFORT_TEMP_MIN, Math.min(COMFORT_TEMP_MAX, temp)) }
      }
      return { ...r, [field]: value }
    })})
  }

  // Save periods
  const handleSave = async () => {
    setLocalError(null)
    try {
      await update(enabled, fromRows(rows))
      dispatch({ type: 'clearDirty' })
      setSaveSuccess(true)
      refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      setLocalError(msg)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-6">
        <div className="animate-pulse h-6 w-48 bg-[var(--bg)] rounded" />
      </div>
    )
  }

  const displayError = localError || saveError || toggleError

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-6">
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold">Comfort Schedule</h2>
          {data?.active_temp != null && enabled && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)]">
              Active: {data.active_temp.toFixed(1)}°C
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-[var(--text-muted)]">{enabled ? 'On' : 'Off'}</span>
          <div
            role="switch"
            aria-checked={enabled}
            aria-label="Enable comfort schedule"
            tabIndex={0}
            onClick={handleToggle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle() } }}
            className={cn(
              'relative w-10 h-5 rounded-full transition-colors cursor-pointer',
              enabled ? 'bg-[var(--accent)]' : 'bg-gray-400/30'
            )}
          >
            <div className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </div>
        </label>
      </div>

      {/* Description */}
      <p className="text-xs text-[var(--text-muted)] mb-4">
        Set comfort temperature targets for different times of day. When enabled, these override the default comfort temperature during their scheduled windows.
      </p>

      {/* Period list */}
      {rows.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] italic mb-3">
          No periods defined. Add one to get started.
        </p>
      )}

      <div className="space-y-2 mb-4">
        {rows.map((row) => (
          <div
            key={row._key}
            className="flex items-center gap-2 flex-wrap sm:flex-nowrap"
          >
            {/* From time */}
            <input
              type="time"
              value={row.from}
              onChange={(e) => handlePeriodChange(row._key, 'from', e.target.value)}
              aria-label="Period start time"
              className="w-24 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
            />
            <span className="text-xs text-[var(--text-muted)]">to</span>
            {/* To time */}
            <input
              type="time"
              value={row.to}
              onChange={(e) => handlePeriodChange(row._key, 'to', e.target.value)}
              aria-label="Period end time"
              className="w-24 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
            />
            {/* Temp with +/- */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePeriodChange(row._key, 'temp', row.temp - 0.5)}
                disabled={row.temp <= COMFORT_TEMP_MIN}
                className="w-7 h-7 flex items-center justify-center rounded border border-[var(--border)] text-sm hover:bg-[var(--bg)] disabled:opacity-40"
                aria-label="Decrease temperature"
              >
                −
              </button>
              <span className="w-14 text-center text-sm font-bold">
                {row.temp.toFixed(1)}°
              </span>
              <button
                onClick={() => handlePeriodChange(row._key, 'temp', row.temp + 0.5)}
                disabled={row.temp >= COMFORT_TEMP_MAX}
                className="w-7 h-7 flex items-center justify-center rounded border border-[var(--border)] text-sm hover:bg-[var(--bg)] disabled:opacity-40"
                aria-label="Increase temperature"
              >
                +
              </button>
            </div>
            {/* Delete */}
            <button
              onClick={() => handleDeletePeriod(row._key)}
              className="w-7 h-7 flex items-center justify-center rounded text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
              aria-label="Delete period"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add period button (cap at MAX_PERIODS) */}
      {rows.length < MAX_PERIODS && (
        <button
          onClick={handleAddPeriod}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] mb-4"
        >
          <Plus size={14} />
          Add period
        </button>
      )}
      {rows.length >= MAX_PERIODS && (
        <p className="text-xs text-[var(--text-muted)] italic mb-4">
          Maximum {MAX_PERIODS} periods reached.
        </p>
      )}

      {/* Error display */}
      {displayError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 mb-3 text-xs text-red-600 dark:text-red-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{displayError}</span>
        </div>
      )}

      {/* Save button — only for period changes, not toggle */}
      {dirty && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
              saving ? 'bg-[var(--accent)]/50 cursor-wait' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
            )}
          >
            {saving ? 'Saving...' : 'Save Schedule'}
          </button>
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check size={14} />
              Saved
            </span>
          )}
        </div>
      )}
    </div>
  )
}
