import { useCallback, useMemo, useState } from 'react'
import { Play, Loader2, Download } from 'lucide-react'
import { useStoreSql } from '../../hooks/useStore'

// Commitment 9 — the grid pages 200 at a time client-side; up to 10,000
// rows arrive in one response and are already in memory, so paging never
// re-queries.
const PAGE_SIZE = 200

export function SqlConsole() {
  const { running, outcome, run } = useStoreSql()
  const [sql, setSql] = useState('')
  const [page, setPage] = useState(0)

  const handleRun = useCallback(() => {
    if (!sql.trim() || running) return
    setPage(0)
    void run(sql)
  }, [sql, running, run])

  const rows = useMemo(() => (outcome?.kind === 'ok' ? outcome.response.rows : []), [outcome])
  const columns = useMemo(() => (outcome?.kind === 'ok' ? outcome.response.columns : []), [outcome])
  const total = rows.length
  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [rows, page],
  )
  const canPrev = page > 0
  const canNext = (page + 1) * PAGE_SIZE < total

  // Historian.tsx:166-171's pattern — export the whole result, not the
  // visible page.
  const handleExportCsv = useCallback(() => {
    if (outcome?.kind !== 'ok' || !rows.length) return
    const csvRows = rows.map((row) =>
      row.map((v) => (v === null || v === undefined ? '' : String(v))).join(','),
    )
    const csv = [columns.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'qsh_store_query.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [outcome, rows, columns])

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
      <h3 className="text-base font-semibold text-[var(--text)]">SQL console</h3>
      <p className="text-xs text-[var(--text-muted)]">
        One <code>SELECT</code>, one at a time, interrupted at 30s, capped at 10,000 rows.
      </p>

      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            handleRun()
          }
        }}
        rows={6}
        placeholder="SELECT * FROM qsh_system LIMIT 100"
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] font-mono"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={running || !sql.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run
        </button>
        <span className="text-xs text-[var(--text-muted)]">Cmd/Ctrl+Enter to run</span>
      </div>

      {/* Commitment 6 — each backend outcome is its own rendering. A
          generic "query failed" would erase the distinction. */}
      {outcome?.kind === 'badRequest' && (
        <p className="text-sm text-red-500">Not admitted: {outcome.message}</p>
      )}
      {outcome?.kind === 'busy' && (
        <p className="text-sm text-amber-600 dark:text-amber-400">Busy: {outcome.message}</p>
      )}
      {outcome?.kind === 'timeout' && <p className="text-sm text-red-500">Timed out: {outcome.message}</p>}
      {outcome?.kind === 'error' && <p className="text-sm text-red-500">Error: {outcome.message}</p>}

      {outcome?.kind === 'ok' && (
        <div className="space-y-2">
          {/* §0 — the response carries row_count, elapsed_ms and truncated
              besides columns/rows; an operator who cannot tell a complete
              answer from a capped one reads the capped one as complete. */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>row_count: {outcome.response.row_count}</span>
            <span>elapsed_ms: {outcome.response.elapsed_ms}</span>
            <button
              onClick={handleExportCsv}
              disabled={!rows.length}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40"
            >
              <Download size={12} />
              CSV
            </button>
          </div>

          {outcome.response.truncated && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Truncated at 10,000 rows — this is not the complete result.
            </p>
          )}

          {columns.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No rows returned.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] max-h-96 overflow-y-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="bg-[var(--bg)] text-[var(--text-muted)] text-left">
                      {columns.map((c) => (
                        <th key={c} className="px-2 sm:px-4 py-2 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {pageRows.map((row, i) => (
                      <tr key={page * PAGE_SIZE + i}>
                        {row.map((v, j) => (
                          <td key={j} className="px-2 sm:px-4 py-2 text-[var(--text)] whitespace-nowrap">
                            {v === null || v === undefined ? '--' : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
                <span>
                  showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
                  {total}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={!canPrev}
                    className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!canNext}
                    className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
