/**
 * INSTRUCTION-577C — the band editor of the manual time-of-use tariff.
 *
 * The user sets the start and the rate of each band. The end of a band is the
 * start of the next band, so it is shown, and edited, as that start: a change
 * to one boundary moves the bands on each side of it. Each edit goes through
 * lib/touBands.ts, whose lists always cover 24 h, so the total below the table
 * is always 24 h and no state has a gap or an overlap. A change of a start can
 * re-sort the rows, so "Band n" names the row, not a fixed band. The rows are
 * keyed by index: every control is controlled, and a row holds no state, so a
 * focused select keeps its focus when its start changes; when the change
 * re-sorts the rows, the focus moves with the boundary to the select of its
 * new row, in the render that shows the moved list.
 */
import { useEffect, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { penceInputValue, poundsFromPence, rateBelowOnePenny } from '../lib/pence'
import { TARIFF } from '../lib/helpText'
import { HelpTip } from './HelpTip'
import {
  GRID_MINUTES,
  bandEnd,
  bandLengths,
  formatLength,
  moveStart,
  rateAdmitted,
  removeBand,
  setRate,
  splitBand,
  startOptions,
  totalMinutes,
} from '../lib/touBands'
import type { TouBand } from '../types/config'

interface TouBandEditorProps {
  bands: TouBand[]
  onChange: (bands: TouBand[]) => void
}

const fieldBase = 'px-2 py-1.5 rounded border bg-[var(--bg)] text-sm text-[var(--text)]'
const fieldClass = cn(fieldBase, 'border-[var(--border)]')
const iconButtonClass =
  'p-1.5 rounded border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 disabled:hover:border-[var(--border)]'

export function TouBandEditor({ bands, onChange }: TouBandEditorProps) {
  const lengths = bandLengths(bands)
  const single = bands.length === 1
  const root = useRef<HTMLDivElement>(null)
  // The select to focus after a move, and the list that the move returned: a
  // move that re-sorts the rows puts the moved boundary on another row. Only
  // the render that shows that list takes the focus.
  const focusNext = useRef<{ label: string; bands: TouBand[] } | null>(null)
  useEffect(() => {
    const pending = focusNext.current
    focusNext.current = null
    if (pending === null || pending.bands !== bands) return
    const select = root.current?.querySelector<HTMLSelectElement>(`select[aria-label="${pending.label}"]`)
    if (select && document.activeElement !== select) select.focus()
  })
  const move = (index: number, start: string, field: 'start' | 'end') => {
    const moved = moveStart(bands, index, start)
    const row = moved.findIndex((band) => band.start === start)
    if (moved !== bands && row >= 0) {
      // The end of a row is the start of the next row, so a moved end is on the row before.
      const target = field === 'start' ? row : (row - 1 + moved.length) % moved.length
      focusNext.current = { label: `Band ${target + 1} ${field}`, bands: moved }
    }
    onChange(moved)
  }
  return (
    <div className="space-y-2" data-testid="tou-band-editor" ref={root}>
      <p className="text-xs text-[var(--text-muted)]">
        Set the start time and the rate of each band, in UK clock time. A band ends where the
        next band starts; the last band runs past midnight to the first.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="font-medium pb-1 pr-2">Start</th>
              <th className="font-medium pb-1 pr-2">End</th>
              <th className="font-medium pb-1 pr-2">
                <span className="inline-flex items-center gap-1">
                  Rate (p/kWh)
                  <HelpTip text={TARIFF.ratePence} size={12} />
                </span>
              </th>
              <th className="font-medium pb-1 pr-2">Length</th>
              <th className="font-medium pb-1">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band, index) => {
              const next = (index + 1) % bands.length
              const rateOk = rateAdmitted(band.rate)
              const alertId = `tou-band-${index}-rate-alert`
              const lowRate = rateBelowOnePenny(band.rate)
              const lowId = `tou-band-${index}-rate-low-hint`
              return (
                <tr key={index} data-testid={`tou-band-${index}`}>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={`Band ${index + 1} start`}
                      value={band.start}
                      onChange={(e) => move(index, e.target.value, 'start')}
                      className={fieldClass}
                    >
                      {startOptions(bands, index).map((start) => (
                        <option key={start} value={start}>
                          {start}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={`Band ${index + 1} end`}
                      value={bandEnd(bands, index)}
                      disabled={single}
                      onChange={(e) => move(next, e.target.value, 'end')}
                      className={fieldClass}
                    >
                      {startOptions(bands, next).map((start) => (
                        <option key={start} value={start}>
                          {start}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0.1}
                      max={200}
                      aria-label={`Band ${index + 1} rate`}
                      aria-invalid={!rateOk}
                      aria-describedby={rateOk ? (lowRate ? lowId : undefined) : alertId}
                      value={penceInputValue(band.rate)}
                      onChange={(e) =>
                        onChange(
                          setRate(bands, index, poundsFromPence(parseFloat(e.target.value) || 0)),
                        )
                      }
                      className={cn(
                        'w-24',
                        fieldBase,
                        rateOk ? 'border-[var(--border)]' : 'border-[var(--red)]',
                      )}
                    />
                    {!rateOk && (
                      <p id={alertId} role="alert" className="text-xs text-[var(--red)] mt-1">
                        The rate must be above 0.
                      </p>
                    )}
                    {lowRate && (
                      <p id={lowId} className="text-xs text-[var(--amber)] mt-1">
                        {TARIFF.rateBelowOnePenny}
                      </p>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-[var(--text-muted)]">{formatLength(lengths[index])}</td>
                  <td className="py-1 whitespace-nowrap">
                    <button
                      type="button"
                      aria-label={`Split band ${index + 1}`}
                      title="Split this band in two"
                      disabled={lengths[index] < 2 * GRID_MINUTES}
                      onClick={() => onChange(splitBand(bands, index))}
                      className={iconButtonClass}
                    >
                      <Plus size={14} />
                    </button>{' '}
                    <button
                      type="button"
                      aria-label={`Remove band ${index + 1}`}
                      title="Remove this band"
                      disabled={single}
                      onClick={() => onChange(removeBand(bands, index))}
                      className={iconButtonClass}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--text)]" data-testid="tou-total">
        Total {formatLength(totalMinutes(bands))} in {bands.length}{' '}
        {bands.length === 1 ? 'band' : 'bands'}
      </p>
    </div>
  )
}
