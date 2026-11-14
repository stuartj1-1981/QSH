import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts'
import { HelpTip } from './HelpTip'
import { cn } from '../lib/utils'
import type {
  EfficiencyEnvelopeResponse,
  EnvelopeInstallClass,
  EnvelopeS2Bin,
} from '../types/api'

// INSTRUCTION-620B — the heat source efficiency envelope that
// INSTRUCTION-620A learns. All values come from /api/envelope; this
// component calculates only the count of mature S1 bins, the outdoor band
// shown first, the sort and the axis ticks. It commands no plant.

interface EfficiencyEnvelopeCardProps {
  data: EfficiencyEnvelopeResponse | null
  error: string | null
  loading: boolean
  /** The live outdoor temperature; chooses the outdoor band shown first. */
  outdoorTemp?: number | null
  /** Discards the learned envelope (`POST /api/envelope/reset`) and reads it
   *  again. No reset control is shown without it. */
  onReset?: () => Promise<ResetOutcome>
}

/** The outcome of a reset, rendered on both arms (the 414 law). */
export type ResetOutcome = { ok: true } | { ok: false; error: string }

const CARD_HELP =
  'QSH learns where this heat pump is most efficient, from steady heating only: ' +
  'not the first minutes after a start, not hot water, not a defrost. It does not ' +
  'change the control. The floor is the lowest input power at which the efficiency ' +
  '(the fraction of Carnot) has not fallen. The ceiling is the flow temperature ' +
  'above which the COP falls, for each outdoor band. A bin is learned when it has ' +
  'enough samples; until then its value can move a lot. The power source is the ' +
  'entity configured as the heat pump input power. A meter that reads apparent ' +
  'power makes the efficiency at low power wrong.'

const CLASS_LABEL: Record<EnvelopeInstallClass, string> = {
  metered: 'Measured heat',
  reported: 'Reported COP',
  none: 'None',
}

const CLASS_HELP: Record<EnvelopeInstallClass, string> = {
  metered: 'COP = heat output ÷ input power, from the configured heat output entity.',
  reported: 'COP = the live COP that QSH conditions. Heat = COP × input power.',
  none: 'No heat output or COP entity is configured.',
}

const REFUSAL_LABEL: Record<string, string> = {
  not_heat_pump: 'Another heat source',
  not_in_heat: 'Not heating',
  hot_water: 'Hot water',
  settling: 'Settling after a start',
  defrost: 'Defrost',
  defrost_recovery: 'Recovery after a defrost',
  input_not_measured: 'Input power not measured',
  no_live_flow_or_outdoor: 'No live flow or outdoor temperature',
  no_heat_measure: 'No heat measure',
  no_lift: 'Flow not above outdoor',
}

function fmt(value: number | null | undefined, digits: number, suffix: string = ''): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`
}

function fmtUpdated(epochS: number): string {
  if (!epochS) return 'never'
  return new Date(epochS * 1000).toLocaleString([], {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** The outdoor band shown first: the highest lower edge at or below the
 *  live outdoor temperature; else the band with the most samples. */
function defaultBand(s2: EnvelopeS2Bin[], outdoorTemp: number | null | undefined): number | null {
  const bands = [...new Set(s2.map((r) => r.outdoor_c))].sort((a, b) => a - b)
  if (bands.length === 0) return null
  if (typeof outdoorTemp === 'number') {
    const below = bands.filter((b) => b <= outdoorTemp)
    if (below.length > 0) return below[below.length - 1]
  }
  let best = bands[0]
  let bestN = -1
  for (const b of bands) {
    const n = s2.filter((r) => r.outdoor_c === b).reduce((sum, r) => sum + r.n, 0)
    if (n > bestN) {
      best = b
      bestN = n
    }
  }
  return best
}

// The y-axes are not zero-based: a fall of 0.05 in the fraction of Carnot is the
// floor (620A FLOOR_TOLERANCE), and a zero-based axis shows it as a flat line.
// The ends are padded and rounded out to whole steps, and a tick is put on
// each step, so that every tick falls on a round value.
function stepAxis(values: number[], pad: number, step: number): { domain: [number, number]; ticks: number[] } {
  if (values.length === 0) return { domain: [0, step], ticks: [0, step] }
  const lo = Math.floor((Math.min(...values) - pad) / step)
  const hi = Math.ceil((Math.max(...values) + pad) / step)
  const ticks: number[] = []
  for (let i = lo; i <= hi; i++) ticks.push(Number((i * step).toFixed(6)))
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks }
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
}

export function EfficiencyEnvelopeCard({ data, error, loading, outdoorTemp, onReset }: EfficiencyEnvelopeCardProps) {
  const [chosenBand, setChosenBand] = useState<number | null>(null)

  return (
    <div
      data-testid="efficiency-envelope"
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-x-auto"
    >
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3 flex items-center gap-1.5">
        HEAT PUMP EFFICIENCY
        <HelpTip text={CARD_HELP} size={12} />
      </h2>
      {loading && !data && !error && (
        <div data-testid="env-loading" className="text-xs text-[var(--text-muted)]">Loading…</div>
      )}
      {error && (
        <div data-testid="env-error" className="text-xs text-[var(--red)] mb-2">
          {data
            ? `The last read failed: ${error}. The values below are from the last good read.`
            : `The efficiency envelope is not available: ${error}`}
        </div>
      )}
      {data && <EnvelopeBody data={data} outdoorTemp={outdoorTemp} chosenBand={chosenBand} onChooseBand={setChosenBand} />}
      {data && onReset && <EnvelopeReset data={data} onReset={onReset} />}
    </div>
  )
}

function EnvelopeBody({
  data, outdoorTemp, chosenBand, onChooseBand,
}: {
  data: EfficiencyEnvelopeResponse
  outdoorTemp: number | null | undefined
  chosenBand: number | null
  onChooseBand: (band: number) => void
}) {
  const s1Mature = data.s1.filter((r) => r.mature).length
  const bands = [...new Set(data.s2.map((r) => r.outdoor_c))].sort((a, b) => a - b)
  const band = chosenBand !== null && bands.includes(chosenBand) ? chosenBand : defaultBand(data.s2, outdoorTemp)
  const bandRows = data.s2.filter((r) => r.outdoor_c === band).sort((a, b) => a.flow_c - b.flow_c)
  const ceiling = data.ceiling.find((c) => c.outdoor_c === band) ?? null
  const refusals = Object.entries(data.refused).sort(([, a], [, b]) => b - a)
  const floor = data.floor
  const s1Axis = stepAxis(data.s1.map((r) => r.fraction_of_carnot), 0.02, 0.02)
  const s2Axis = stepAxis(bandRows.map((r) => r.cop), 0.3, 0.5)

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm mb-4">
        <Stat
          label="Heat measure"
          value={CLASS_LABEL[data.install_class] ?? data.install_class}
          testId="env-class"
          help={CLASS_HELP[data.install_class]}
        />
        <Stat
          label="Power source"
          value={data.power_entity || 'not configured'}
          testId="env-power"
          help="The entity configured as the heat pump input power. The learner reads this entity and no other."
          wrap
        />
        <Stat label="Samples" value={String(data.samples)} testId="env-samples" />
        <Stat
          label="Reference input"
          value={fmt(data.reference_input_kw, 2, ' kW')}
          testId="env-ref"
          help="An input power near the top of the samples, which the learner sets. The input fraction of the floor chart is the input power ÷ this value."
        />
        <Stat
          label="Last update"
          value={fmtUpdated(data.updated_at)}
          testId="env-updated"
          help="The time of the last sample, or of the last reset when no sample came after it."
        />
      </div>

      {data.install_class === 'none' ? (
        <div data-testid="env-none" className="text-xs text-[var(--text-muted)]">
          QSH learns nothing here: no heat output or COP entity is configured for the heat pump.
        </div>
      ) : (
        <>
          <Section title="Floor" testId="env-floor-section">
            <div data-testid="env-floor" className="text-sm mb-2">
              {floor.mature && floor.floor_kw_el !== null ? (
                <>
                  <span className="font-semibold font-mono">{fmt(floor.floor_kw_el, 2, ' kW')}</span> input
                  {' '}({fmt(floor.floor_fraction, 1)} of reference).{' '}
                  {floor.floor_penalty
                    ? 'Below this the efficiency falls.'
                    : 'No fall found: this is the lowest input learned.'}
                </>
              ) : (
                <span className="text-[var(--text-muted)]">
                  Learning: {s1Mature} bin{s1Mature === 1 ? '' : 's'} learned.
                </span>
              )}
            </div>
            {data.s1.length > 0 && (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" dataKey="input_kw" name="Input" unit=" kW" stroke="var(--text-muted)" fontSize={10} />
                    <YAxis type="number" dataKey="fraction_of_carnot" name="Fraction of Carnot" stroke="var(--text-muted)" fontSize={10} width={40} domain={s1Axis.domain} ticks={s1Axis.ticks} tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Scatter name="Learned" data={data.s1.filter((r) => r.mature)} fill="var(--accent)" />
                    <Scatter name="Learning" data={data.s1.filter((r) => !r.mature)} fill="var(--text-muted)" />
                    {floor.mature && floor.floor_kw_el !== null && (
                      <ReferenceLine x={floor.floor_kw_el} stroke="var(--blue)" strokeDasharray="4 4" />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
                <ChartKey />
                <BinTable
                  head={['Input (kW)', 'Fraction of reference', 'Fraction of Carnot']}
                  rows={data.s1.map((r) => ({
                    key: `env-s1-row-${r.x}`,
                    cells: [fmt(r.input_kw, 2), fmt(r.x, 1), fmt(r.fraction_of_carnot, 3)],
                    n: r.n,
                    mature: r.mature,
                  }))}
                />
              </>
            )}
          </Section>

          <Section title="Ceiling" testId="env-ceiling-section">
            {bands.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">No samples yet.</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1 mb-2" role="group" aria-label="Outdoor band">
                  {bands.map((b) => (
                    <button
                      key={b}
                      type="button"
                      data-testid={`env-band-${b}`}
                      onClick={() => onChooseBand(b)}
                      aria-pressed={b === band}
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs border border-[var(--border)]',
                        b === band && 'bg-[var(--accent)] text-white border-[var(--accent)]',
                      )}
                    >
                      Outdoor {fmt(b, 0, ' °C')}
                    </button>
                  ))}
                </div>
                <div data-testid="env-ceiling" className="text-sm mb-2">
                  {ceiling ? (
                    <>
                      Best COP <span className="font-semibold font-mono">{fmt(ceiling.best_cop, 2)}</span> at{' '}
                      the {fmt(ceiling.best_flow_c, 0, ' °C')} flow band. Ceiling:{' '}
                      <span className="font-semibold font-mono">
                        {ceiling.ceiling_flow_c === null ? 'not found yet' : fmt(ceiling.ceiling_flow_c, 0, ' °C flow band')}
                      </span>
                      {!ceiling.mature && <Flag label="learning" />}
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">Learning: no flow band learned in this outdoor band.</span>
                  )}
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" dataKey="flow_c" name="Flow" unit=" °C" stroke="var(--text-muted)" fontSize={10} domain={['dataMin - 1', 'dataMax + 1']} />
                    <YAxis type="number" dataKey="cop" name="COP" stroke="var(--text-muted)" fontSize={10} width={40} domain={s2Axis.domain} ticks={s2Axis.ticks} tickFormatter={(v: number) => v.toFixed(1)} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Scatter name="Learned" data={bandRows.filter((r) => r.mature)} fill="var(--accent)" />
                    <Scatter name="Learning" data={bandRows.filter((r) => !r.mature)} fill="var(--text-muted)" />
                    {ceiling && ceiling.ceiling_flow_c !== null && (
                      <ReferenceLine x={ceiling.ceiling_flow_c} stroke="var(--red)" strokeDasharray="4 4" />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
                <ChartKey />
                <BinTable
                  head={['Flow band from (°C)', 'COP']}
                  rows={bandRows.map((r) => ({
                    key: `env-s2-row-${r.flow_c}`,
                    cells: [fmt(r.flow_c, 0), fmt(r.cop, 2)],
                    n: r.n,
                    mature: r.mature,
                  }))}
                />
              </>
            )}
          </Section>

          {refusals.length > 0 && (
            <Section title="Cycles not used" testId="env-refused-section">
              <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                {refusals.map(([key, count]) => (
                  <li key={key} data-testid={`env-refused-${key}`} className="flex justify-between">
                    <span>{REFUSAL_LABEL[key] ?? key}</span>
                    <span className="font-mono">{count}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </>
  )
}

// INSTRUCTION-620B (owner ruling of 10 November 2026) — the reset: confirm at
// the action, stating what is discarded; the outcome renders on both arms.
// The INSTRUCTION-422 sysid reset is the pattern.
function EnvelopeReset({ data, onReset }: { data: EfficiencyEnvelopeResponse; onReset: () => Promise<ResetOutcome> }) {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  const handleReset = async () => {
    setResetting(true)
    const res = await onReset()
    setResetting(false)
    setConfirming(false)
    setOutcome(
      res.ok
        ? { ok: true, text: 'Envelope reset. Learning starts again from the next steady heating run, from the same power source.' }
        : { ok: false, text: `Reset failed: ${res.error}` },
    )
  }

  return (
    <div data-testid="env-reset-section" className="border-t border-[var(--border)] pt-3 mt-3 space-y-1.5 text-xs">
      {!confirming ? (
        <button
          type="button"
          data-testid="env-reset-request"
          onClick={() => {
            setOutcome(null)
            setConfirming(true)
          }}
          className="px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--red)] hover:border-[var(--red)]"
        >
          Reset efficiency learning…
        </button>
      ) : (
        <div data-testid="env-reset-confirm" className="rounded border border-[var(--red)]/40 p-2 space-y-1.5">
          <p className="max-w-prose">
            Discard the learned efficiency envelope: {data.samples} samples, {data.s1.length} floor bins,{' '}
            {data.s2.length} ceiling bins and the counts of cycles not used. The power source and the heat
            measure are kept. Do this after a change of the power meter or of the heat pump, not as routine.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="env-reset-confirm-btn"
              onClick={() => void handleReset()}
              disabled={resetting}
              className="px-2 py-1 rounded bg-[var(--red)]/15 border border-[var(--red)]/50 font-medium text-[var(--red)] disabled:opacity-50"
            >
              {resetting ? 'Resetting…' : 'Discard & reset'}
            </button>
            <button
              type="button"
              data-testid="env-reset-cancel"
              onClick={() => setConfirming(false)}
              disabled={resetting}
              className="px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {outcome && (
        <p
          data-testid="env-reset-outcome"
          className={cn('max-w-prose', outcome.ok ? 'text-[var(--green)]' : 'text-[var(--red)]')}
        >
          {outcome.text}
        </p>
      )}
    </div>
  )
}

function ChartKey() {
  return (
    <div className="flex gap-4 text-xs text-[var(--text-muted)] mt-1">
      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)]" />learned</span>
      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[var(--text-muted)]" />learning</span>
    </div>
  )
}

function Section({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="border-t border-[var(--border)] pt-3 mt-3">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">{title}</h3>
      {children}
    </div>
  )
}

function BinTable({
  head, rows,
}: {
  head: string[]
  rows: { key: string; cells: string[]; n: number; mature: boolean }[]
}) {
  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
          {head.map((h) => (
            <th key={h} className="pb-2 pr-1 sm:pr-3">{h}</th>
          ))}
          <th className="pb-2 pr-1 sm:pr-3">Samples</th>
          <th className="pb-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-testid={r.key} className="border-b border-[var(--border)]/50">
            {r.cells.map((c, i) => (
              <td key={i} className="py-1.5 pr-1 sm:pr-3 font-mono">{c}</td>
            ))}
            <td className="py-1.5 pr-1 sm:pr-3 font-mono">{r.n}</td>
            <td className="py-1.5">{r.mature ? null : <Flag label="learning" />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Stat({
  label, value, testId, help, wrap,
}: { label: string; value: string; testId: string; help?: string; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[var(--text-muted)] text-xs flex items-center gap-1">
        {label}
        {help && <HelpTip text={help} size={12} />}
      </div>
      <div data-testid={testId} className={cn('font-semibold font-mono', wrap && 'break-all text-xs')}>{value}</div>
    </div>
  )
}

function Flag({ label }: { label: string }) {
  return (
    <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-700 dark:text-amber-300">
      {label}
    </span>
  )
}
