import { useState } from 'react'
import { ArrowRightCircle } from 'lucide-react'
import { useCutover } from '../../hooks/useStore'
import type { StoreStats } from '../../types/api'

interface CutoverPanelProps {
  stats: StoreStats | null
  // Refreshes the page's stats poll after a successful cutover.
  onCutover?: () => void
}

// 505D's transition table admits shadow→cutover and backfill→cutover as
// well as reconciled→cutover — the control is offered in every one of
// these and the backend's own refusal (409) is what gates the act, not a
// client-side narrowing of the same boundary (M10, commitment 5).
const PRE_CUTOVER_STATES = new Set(['shadow', 'backfill', 'reconciled'])

export function CutoverPanel({ stats, onCutover }: CutoverPanelProps) {
  const { requesting, result, request } = useCutover()
  const [confirming, setConfirming] = useState(false)

  const state = stats?.migration_state ?? null
  const canOffer = state !== null && PRE_CUTOVER_STATES.has(state)

  // The UI does not offer `force` (commitment 1) — this is the only call
  // site of request(), and request() itself never accepts one (OB-1).
  const handleClick = () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    void request().then((outcome) => {
      if (outcome.kind === 'ok') onCutover?.()
    })
  }

  if (!canOffer && state !== 'cutover') {
    return (
      <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-2">
        <h3 className="text-base font-semibold text-[var(--text)]">Cutover</h3>
        <p className="text-sm text-[var(--text-muted)]">No migration in progress.</p>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
      <h3 className="text-base font-semibold text-[var(--text)]">Cutover</h3>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="text-[var(--text-muted)]">Effective backend</div>
        <div className="text-[var(--text)]">{stats?.backend_effective ?? '--'}</div>
        <div className="text-[var(--text-muted)]">Migration state</div>
        <div className="text-[var(--text)]">{state ?? '--'}</div>
        <div className="text-[var(--text-muted)]">Unreconciled days</div>
        <div className="text-[var(--text)]">{stats?.unreconciled_days ?? '--'}</div>
      </div>

      {state === 'cutover' && <p className="text-sm text-[var(--text-muted)]">Already cut over.</p>}

      {canOffer && !confirming && (
        <button
          onClick={handleClick}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <ArrowRightCircle size={14} />
          Cut over
        </button>
      )}

      {canOffer && confirming && (
        <div className="p-3 rounded-lg border border-amber-500 bg-amber-50 dark:bg-amber-900/20 space-y-2">
          {/* Commitment 2 — the confirmation carries the facts; that is
              what prevents the mis-click, not a typed-phrase ceremony. */}
          <p className="text-sm text-[var(--text)]">
            This cuts over from <strong>{stats?.backend_effective ?? '--'}</strong> to{' '}
            <strong>qsdb</strong>, with <strong>{stats?.unreconciled_days ?? '--'}</strong>{' '}
            unreconciled day(s) as last read.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleClick}
              disabled={requesting}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              Confirm cutover
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result?.kind === 'ok' && (
        <div className="p-3 rounded-lg border border-[var(--green)] bg-green-50 dark:bg-green-900/20 text-sm space-y-1">
          <div className="text-[var(--text)]">state: {result.state}</div>
          <div className="text-[var(--text)]">gap_days: {String(result.gap_days)}</div>
          <div className="text-[var(--text)]">forced: {String(result.forced)}</div>
        </div>
      )}

      {result?.kind === 'refused' && (
        <div className="p-3 rounded-lg border border-red-500 bg-red-50 dark:bg-red-900/20 text-sm space-y-1">
          <p className="font-medium text-red-600 dark:text-red-400">Refused</p>
          <div className="text-[var(--text)]">unreconciled_days: {String(result.unreconciled_days)}</div>
          {result.source_last_error && (
            <div className="text-[var(--text)]">source_last_error: {result.source_last_error}</div>
          )}
          {/* The `force` flag is deliberately not offered (commitment 1). */}
          <p className="text-xs text-[var(--text-muted)]">
            Forcing past this is a command-line act, not offered here.
          </p>
        </div>
      )}

      {result?.kind === 'error' && <p className="text-sm text-red-500">Error: {result.message}</p>}
    </div>
  )
}
