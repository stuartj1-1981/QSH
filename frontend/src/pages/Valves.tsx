import { useMemo, useState } from 'react'
import { useManual } from '../hooks/useManual'
import { useLive } from '../hooks/useLive'
import { cn } from '../lib/utils'
import type { ManualEntry } from '../types/api'

function formatHardware(hw: string): string {
  switch (hw) {
    case 'direct_type1': return 'Type 1'
    case 'direct_type2': return 'Type 2'
    case 'generic': return 'Generic'
    default: return hw
  }
}

interface ValveCardProps {
  entry: ManualEntry
  livePosition: number | null
  onSetManual: (room: string, pct: number) => Promise<void>
  onSetAuto: (room: string) => Promise<void>
}

function ValveCard({ entry, livePosition, onSetManual, onSetAuto }: ValveCardProps) {
  // Local slider state — defaults to the live position at AUTO->MAN toggle
  // (bumpless transfer per parent §6) or the current MANUAL position.
  const initial = entry.mode === 'MANUAL' && entry.position_pct !== null
    ? entry.position_pct
    : livePosition !== null
      ? Math.round(livePosition)
      : 50
  const [pending, setPending] = useState<number>(initial)

  // The slider is seeded once (above) and tracks user edits thereafter. A
  // successful PUT updates entry.position_pct to match `pending`, so the
  // two stay in sync via the normal mutation path. We deliberately do not
  // resync on external entry changes — multiple concurrent operators on
  // the same room is pathological, and the engineering Valves page is
  // single-operator by intent.

  const isManual = entry.mode === 'MANUAL'

  const borderCls = isManual
    ? 'border-amber-500/50'
    : 'border-green-500/40'

  const handleToggleManual = () => {
    // AUTO -> MAN: seed slider with live (already initialised above), commit pending value.
    void onSetManual(entry.room, pending)
  }

  const handleToggleAuto = () => {
    void onSetAuto(entry.room)
  }

  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-[var(--bg-card)] p-4 space-y-3',
        borderCls,
      )}
      data-testid={`valve-card-${entry.room}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--text)] capitalize">
          {entry.room.replace(/_/g, ' ')}
        </h3>
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
          {formatHardware(entry.hardware_type)}
        </span>
      </div>

      <div className="text-sm text-[var(--text-muted)]">
        Live: <span className="font-medium text-[var(--text)]">
          {livePosition !== null ? `${Math.round(livePosition)} %` : '— %'}
        </span>
      </div>

      <div className="flex gap-2" role="group" aria-label="Mode">
        <button
          type="button"
          onClick={handleToggleAuto}
          aria-pressed={!isManual}
          disabled={!isManual}
          className={cn(
            'flex-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
            !isManual
              ? 'bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/40'
              : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:bg-green-500/10',
          )}
        >
          AUTO
        </button>
        <button
          type="button"
          onClick={handleToggleManual}
          aria-pressed={isManual}
          disabled={isManual}
          className={cn(
            'flex-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
            isManual
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40'
              : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:bg-amber-500/10',
          )}
        >
          MAN
        </button>
      </div>

      {isManual && (
        <div className="space-y-2 pt-1" data-testid={`valve-card-${entry.room}-manual-controls`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pending}
              onChange={(e) => setPending(Number(e.target.value))}
              aria-label="Manual position percent"
              className="flex-1"
            />
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={pending}
              onChange={(e) => setPending(Math.max(0, Math.min(100, Number(e.target.value))))}
              aria-label="Manual position percent (numeric)"
              className="w-16 px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { void onSetManual(entry.room, pending) }}
              className="flex-1 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 text-sm font-medium hover:bg-amber-500/25"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleToggleAuto}
              className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] text-sm font-medium hover:bg-green-500/10"
            >
              Return AUTO
            </button>
          </div>
          <div className="text-xs text-[var(--text-muted)] space-x-3">
            <span>Set by: <span className="font-mono">{entry.set_by}</span></span>
            {entry.set_at > 0 && (
              <span>Set at: <span className="font-mono">{new Date(entry.set_at * 1000).toLocaleTimeString()}</span></span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Valves() {
  const { entries, loading, error, setManual, setAuto } = useManual()
  const { data } = useLive()

  const livePositions: Record<string, number | null> = useMemo(() => {
    const out: Record<string, number | null> = {}
    if (data?.rooms) {
      for (const [room, state] of Object.entries(data.rooms)) {
        out[room] = typeof state.valve === 'number' ? state.valve : null
      }
    }
    return out
  }, [data])

  const controlEnabled = data?.status?.control_enabled ?? true
  const manualCount = entries.filter((e) => e.mode === 'MANUAL').length
  const bannerAmber = !controlEnabled && manualCount > 0

  if (loading) {
    return <p className="text-[var(--text-muted)] p-4">Loading valve state...</p>
  }

  if (error && entries.length === 0) {
    return <p className="text-red-500 p-4">Error loading valves: {error}</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)]">Valves</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Per-room operator AUTO/MANUAL override for direct-control TRVs.
        </p>
      </div>

      <div
        className={cn(
          'rounded-lg px-4 py-3 text-sm',
          bannerAmber
            ? 'bg-amber-500/15 text-amber-900 dark:text-amber-100 border border-amber-500/40'
            : 'bg-[var(--bg-card)] text-[var(--text)] border border-[var(--border)]',
        )}
        data-testid="valves-banner"
      >
        <span className="font-medium">Shadow mode: {controlEnabled ? 'OFF' : 'ON'}</span>
        <span className="px-3">·</span>
        <span className="font-medium">Manual rooms: {manualCount}</span>
        {bannerAmber && (
          <div className="mt-1">
            Shadow mode is ON but Manual overrides will still write. Return rooms to AUTO before relying on shadow.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg px-4 py-2 text-sm bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)]">
          No direct TRVs configured. The Valve engineering page applies to rooms with
          <code className="px-1">room_valve_hardware</code> set to
          <code className="px-1">direct_type1</code>,
          <code className="px-1">direct_type2</code>, or
          <code className="px-1">generic</code>.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <ValveCard
              key={entry.room}
              entry={entry}
              livePosition={livePositions[entry.room] ?? null}
              onSetManual={setManual}
              onSetAuto={setAuto}
            />
          ))}
        </div>
      )}
    </div>
  )
}
