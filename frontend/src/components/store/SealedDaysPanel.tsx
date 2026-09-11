import { useState } from 'react'
import { useSealedDays } from '../../hooks/useStore'
import { formatBytes } from '../../lib/utils'

// INSTRUCTION-510B commitment 7 — paging by page, not a virtual scroller.
// 510A caps at 2000; a page of 100 with previous/next keeps the honest
// total on screen without pulling the whole manifest at once.
const PAGE_SIZE = 100

export function SealedDaysPanel() {
  const [measurement, setMeasurement] = useState('')
  const [offset, setOffset] = useState(0)
  const { data, loading, error } = useSealedDays(measurement || undefined, PAGE_SIZE, offset)

  const rows = data?.days ?? []
  const total = data?.total ?? 0

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + rows.length, total)
  const canPrev = offset > 0
  const canNext = offset + rows.length < total

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-[var(--text)]">Sealed Days</h3>
        <input
          type="text"
          value={measurement}
          onChange={(e) => {
            setMeasurement(e.target.value)
            setOffset(0)
          }}
          placeholder="Filter by measurement"
          className="px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]"
        />
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading sealed days...</p>}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">No sealed days.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="bg-[var(--bg)] text-[var(--text-muted)] text-left">
                  <th className="px-2 sm:px-4 py-2 font-medium">Day</th>
                  <th className="px-2 sm:px-4 py-2 font-medium">Measurement</th>
                  <th className="px-2 sm:px-4 py-2 font-medium text-right">Rows</th>
                  <th className="px-2 sm:px-4 py-2 font-medium">Location</th>
                  <th className="px-2 sm:px-4 py-2 font-medium text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <tr key={`${row.measurement}-${row.day}`}>
                    <td className="px-2 sm:px-4 py-2 text-[var(--text)]">{row.day}</td>
                    <td className="px-2 sm:px-4 py-2 text-[var(--text)]">{row.measurement}</td>
                    <td className="px-2 sm:px-4 py-2 text-right text-[var(--text)]">{row.rows}</td>
                    <td className="px-2 sm:px-4 py-2 text-[var(--text)]">{row.location}</td>
                    <td className="px-2 sm:px-4 py-2 text-right text-[var(--text)]">
                      {formatBytes(row.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
            <span>
              showing {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={!canPrev}
                className="px-3 py-1 rounded border border-[var(--border)] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
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
  )
}
