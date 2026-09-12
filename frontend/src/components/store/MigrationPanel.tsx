import { cn } from '../../lib/utils'
import type { StoreStats } from '../../types/api'

interface MigrationPanelProps {
  stats: StoreStats | null
}

const STATE_LABELS: Record<string, string> = {
  none: 'None',
  shadow: 'Shadow',
  backfill: 'Backfill',
  reconciled: 'Reconciled',
  cutover: 'Cutover',
}

const PRE_CUTOVER_STATES = new Set(['shadow', 'backfill', 'reconciled'])

function stateBadge(state: string | null | undefined) {
  const label = state ? (STATE_LABELS[state] ?? state) : '--'
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]">
      {label}
    </span>
  )
}

function parkedBadge() {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
      PARKED
    </span>
  )
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '--' : String(v)
}

export function MigrationPanel({ stats }: MigrationPanelProps) {
  const state = stats?.migration_state ?? null
  const backfillState = stats?.backfill_state ?? null

  // INSTRUCTION-510B M9 — a pre-cutover state with no backfill_state is the
  // PARKED signature (505F V3's sixth install class): `historian.store.shadow`
  // is holding the install here on purpose, not a migration stuck mid-run.
  const isParked = state !== null && PRE_CUTOVER_STATES.has(state) && backfillState === null

  const populationDays = stats?.population_days ?? null
  const reconciledDays = stats?.reconciled_days ?? null
  const showProgress = typeof populationDays === 'number' && populationDays > 0
  const progressPct = showProgress
    ? Math.min(100, Math.round(((reconciledDays ?? 0) / populationDays) * 100))
    : 0

  const sourceOk = stats?.source_ok

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
      <h3 className="text-base font-semibold text-[var(--text)]">Migration</h3>

      <div className="flex flex-wrap items-center gap-2">
        {isParked ? parkedBadge() : stateBadge(state)}
        {!isParked && (
          <span className="text-xs text-[var(--text-muted)]">
            backfill state: {backfillState ?? '--'}
          </span>
        )}
      </div>

      {isParked && (
        <p className="text-xs text-[var(--text-muted)]">
          This migration is parked, not stuck: <code>historian.store.shadow</code> is holding
          it here. Set it to <code>true</code> to resume it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="text-[var(--text-muted)]">Configured backend</div>
        <div className="text-[var(--text)]">{stats?.backend_config ?? '--'}</div>
        <div className="text-[var(--text-muted)]">Effective backend</div>
        <div className="text-[var(--text)]">{stats?.backend_effective ?? '--'}</div>
        <div className="text-[var(--text-muted)]">Source</div>
        <div className={cn(sourceOk === false ? 'text-red-500' : 'text-[var(--text)]')}>
          {sourceOk === null || sourceOk === undefined ? '--' : sourceOk ? 'OK' : 'Failed'}
        </div>
        {sourceOk === false && stats?.source_last_error && (
          <>
            <div className="text-[var(--text-muted)]">Source last error</div>
            <div className="text-red-500 break-words">{stats.source_last_error}</div>
          </>
        )}
        <div className="text-[var(--text-muted)]">Population days</div>
        <div className="text-[var(--text)]">{fmt(populationDays)}</div>
        <div className="text-[var(--text-muted)]">Reconciled days</div>
        <div className="text-[var(--text)]">{fmt(reconciledDays)}</div>
        <div className="text-[var(--text-muted)]">Unreconciled days</div>
        <div className="text-[var(--text)]">{fmt(stats?.unreconciled_days)}</div>
        <div className="text-[var(--text-muted)]">Last pulled day</div>
        <div className="text-[var(--text)]">{stats?.last_pulled_day ?? '--'}</div>
      </div>

      {showProgress && (
        <div>
          <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
            <span>Reconciled progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg)] border border-[var(--border)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
