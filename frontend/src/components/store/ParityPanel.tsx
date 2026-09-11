import { useState } from 'react'
import { cn } from '../../lib/utils'
import { useParity } from '../../hooks/useStore'
import type { ParityReport } from '../../types/api'

// INSTRUCTION-510B commitment 8 — the case count and mismatch counts are
// not stored pre-computed in the report file; they are derived here from
// the two comparison populations. `edge_mismatches` is shown beside
// `mismatches` deliberately (505B V2 L8: "recorded, not judged") — showing
// one without the other invites reading full agreement where the report
// does not say that.
function summarize(report: ParityReport) {
  if (report.skipped) {
    return { state: 'skipped', cases: 0, mismatches: 0, edgeMismatches: 0 }
  }
  const comparisons = report.comparisons ?? []
  const edge = report.edge_comparisons ?? []
  return {
    state: 'ran',
    cases: comparisons.length,
    mismatches: comparisons.filter((c) => !c.match).length,
    edgeMismatches: edge.filter((c) => !c.match).length,
  }
}

type DayState = 'idle' | 'loading' | 'notFound' | 'error'

export function ParityPanel() {
  const { index, loading, error, loadDay } = useParity()
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dayState, setDayState] = useState<DayState>('idle')
  const [report, setReport] = useState<ParityReport | null>(null)
  const [dayError, setDayError] = useState<string | null>(null)

  const handleSelect = async (day: string) => {
    setSelectedDay(day)
    setDayState('loading')
    setReport(null)
    setDayError(null)
    const result = await loadDay(day)
    if (result.kind === 'ok') {
      setReport(result.report)
      setDayState('idle')
    } else if (result.kind === 'notFound') {
      setDayState('notFound')
    } else {
      setDayError(result.message)
      setDayState('error')
    }
  }

  const days = index?.days ?? []
  const summary = report ? summarize(report) : null

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
      <h3 className="text-base font-semibold text-[var(--text)]">Parity</h3>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading parity index...</p>}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {/* No-report-available: the index itself is empty. Nothing here can
          tell "never turned on" apart from "on and not yet run" — that
          distinction lives on the config key the Settings page shows
          (510C's business, per M6). */}
      {!loading && !error && days.length === 0 && (
        <div className="space-y-1">
          <p className="text-sm text-[var(--text-muted)]">No report available.</p>
          <p className="text-xs text-[var(--text-muted)]">
            Whether the reporter is enabled is shown on the Settings page.
          </p>
        </div>
      )}

      {!loading && !error && days.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {days.map((day) => (
            <button
              key={day}
              onClick={() => handleSelect(day)}
              className={cn(
                'px-2 py-1 text-xs rounded border',
                selectedDay === day
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text)]',
              )}
            >
              {day}
            </button>
          ))}
        </div>
      )}

      {selectedDay && dayState === 'loading' && (
        <p className="text-sm text-[var(--text-muted)]">Loading {selectedDay}...</p>
      )}

      {/* No-report-for-that-day: distinct from the index being empty. */}
      {selectedDay && dayState === 'notFound' && (
        <p className="text-sm text-[var(--text-muted)]">No report for {selectedDay}.</p>
      )}

      {selectedDay && dayState === 'error' && (
        <p className="text-sm text-red-500">Error: {dayError}</p>
      )}

      {selectedDay && dayState === 'idle' && report && summary && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="text-[var(--text-muted)]">Run state</div>
            <div className="text-[var(--text)]">{summary.state}</div>
            <div className="text-[var(--text-muted)]">Cases</div>
            <div className="text-[var(--text)]">{summary.cases}</div>
            <div className="text-[var(--text-muted)]">Mismatches</div>
            <div className={cn(summary.mismatches > 0 ? 'text-red-500' : 'text-[var(--text)]')}>
              {summary.mismatches}
            </div>
            <div className="text-[var(--text-muted)]">Edge mismatches</div>
            <div
              className={cn(summary.edgeMismatches > 0 ? 'text-amber-500' : 'text-[var(--text)]')}
            >
              {summary.edgeMismatches}
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--accent)]">Raw report</summary>
            <pre className="mt-2 p-2 rounded bg-[var(--bg)] border border-[var(--border)] overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
