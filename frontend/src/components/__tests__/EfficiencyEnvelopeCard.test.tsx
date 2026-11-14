import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EfficiencyEnvelopeCard } from '../EfficiencyEnvelopeCard'
import type { ResetOutcome } from '../EfficiencyEnvelopeCard'
import type { EfficiencyEnvelopeResponse } from '../../types/api'

// INSTRUCTION-620B — the efficiency envelope card. Recharts is stubbed: the
// tests read the text and the tables, not the SVG (CLAUDE.md §"Web UX —
// Testing Rules": do not test third-party libraries).
vi.mock('recharts', () => ({
  ScatterChart: ({ children }: { children: ReactNode }) => <div data-testid="scatter-chart">{children}</div>,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  ReferenceLine: ({ x }: { x: number }) => <div data-testid="reference-line">{x}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// S2, the ceiling and the counts are the owner's /api/envelope output of
// 10 November 2026 (Cosy 6, metered). S1 is constructed: that output's S1
// was not captured.
function envelope(over: Partial<EfficiencyEnvelopeResponse> = {}): EfficiencyEnvelopeResponse {
  return {
    schema_version: 1,
    install_class: 'metered',
    power_entity: 'sensor.shellyem_channel_1_power',
    heat_entity: 'sensor.cosy_heat_output',
    cop_entity: 'sensor.live_cop_calc',
    samples: 221,
    refused: { no_live_flow_or_outdoor: 1, not_in_heat: 259, settling: 44 },
    reference_input_kw: 1.45,
    s1: [
      { x: 0.3, input_kw: 0.45, fraction_of_carnot: 0.4412, n: 81, mature: true },
      { x: 0.5, input_kw: 0.78, fraction_of_carnot: 0.4590, n: 28, mature: false },
    ],
    s1_mature: false,
    s2: [
      { flow_c: 30, outdoor_c: 6, cop: 4.714, n: 31, mature: false },
      { flow_c: 32, outdoor_c: 6, cop: 4.445, n: 32, mature: false },
      { flow_c: 34, outdoor_c: 6, cop: 4.678, n: 134, mature: true },
      { flow_c: 32, outdoor_c: 9, cop: 4.447, n: 13, mature: false },
      { flow_c: 34, outdoor_c: 9, cop: 5.303, n: 8, mature: false },
    ],
    s2_mature: false,
    floor: { mature: false, floor_fraction: null, floor_kw_el: null, floor_penalty: null },
    ceiling: [{ outdoor_c: 6, best_flow_c: 34, best_cop: 4.678, ceiling_flow_c: null, mature: false }],
    updated_at: 1794330827.27,
    ...over,
  }
}

function renderCard(
  data: EfficiencyEnvelopeResponse | null,
  extra: { error?: string | null; loading?: boolean; outdoorTemp?: number | null; onReset?: () => Promise<ResetOutcome> } = {},
) {
  return render(
    <EfficiencyEnvelopeCard
      data={data}
      error={extra.error ?? null}
      loading={extra.loading ?? false}
      outdoorTemp={extra.outdoorTemp}
      onReset={extra.onReset}
    />,
  )
}

describe('EfficiencyEnvelopeCard', () => {
  it('shows a loading line while the fetch is in flight', () => {
    renderCard(null, { loading: true })
    expect(screen.getByTestId('env-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('env-class')).toBeNull()
  })

  it('shows the error with the backend detail', () => {
    renderCard(null, { error: 'HTTP 503 — Efficiency envelope not yet initialised' })
    expect(screen.getByTestId('env-error').textContent).toContain('HTTP 503 — Efficiency envelope not yet initialised')
    expect(screen.queryByTestId('env-loading')).toBeNull()
  })

  it('shows the heat measure, the power source, the samples and the reference', () => {
    renderCard(envelope())
    expect(screen.getByTestId('env-class').textContent).toBe('Measured heat')
    expect(screen.getByTestId('env-power').textContent).toBe('sensor.shellyem_channel_1_power')
    expect(screen.getByTestId('env-samples').textContent).toBe('221')
    expect(screen.getByTestId('env-ref').textContent).toBe('1.45 kW')
  })

  it('says not configured for an empty power entity, and never for no sample', () => {
    renderCard(envelope({ power_entity: '', updated_at: 0 }))
    expect(screen.getByTestId('env-power').textContent).toBe('not configured')
    expect(screen.getByTestId('env-updated').textContent).toBe('never')
  })

  it('shows the reason and no surfaces when the install has no heat measure', () => {
    renderCard(envelope({ install_class: 'none' }))
    expect(screen.getByTestId('env-class').textContent).toBe('None')
    expect(screen.getByTestId('env-none')).toBeInTheDocument()
    expect(screen.queryByTestId('env-floor-section')).toBeNull()
    expect(screen.queryByTestId('env-ceiling-section')).toBeNull()
  })

  it('shows the count of learned S1 bins while the floor is not mature', () => {
    renderCard(envelope())
    expect(screen.getByTestId('env-floor').textContent).toContain('Learning: 1 bin learned.')
    expect(screen.queryByTestId('reference-line')).toBeNull()
  })

  it('shows a mature floor without a penalty as the lowest input learned', () => {
    renderCard(envelope({
      floor: { mature: true, floor_fraction: 0.3, floor_kw_el: 0.45, floor_penalty: false },
    }))
    const text = screen.getByTestId('env-floor').textContent ?? ''
    expect(text).toContain('0.45 kW')
    expect(text).toContain('No fall found')
    expect(screen.getByTestId('reference-line').textContent).toBe('0.45')
  })

  it('shows a mature floor with a penalty as the point below which efficiency falls', () => {
    renderCard(envelope({
      floor: { mature: true, floor_fraction: 0.5, floor_kw_el: 0.78, floor_penalty: true },
    }))
    expect(screen.getByTestId('env-floor').textContent).toContain('Below this the efficiency falls.')
  })

  it('lists each S1 bin with its samples and a learning flag only on an immature bin', () => {
    renderCard(envelope())
    const mature = screen.getByTestId('env-s1-row-0.3')
    const learning = screen.getByTestId('env-s1-row-0.5')
    expect(mature.textContent).toContain('81')
    expect(mature.textContent).not.toContain('learning')
    expect(learning.textContent).toContain('28')
    expect(learning.textContent).toContain('learning')
  })

  it('opens on the outdoor band of the live outdoor temperature', () => {
    renderCard(envelope(), { outdoorTemp: 10.2 })
    expect(screen.getByTestId('env-band-9').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('env-s2-row-34').textContent).toContain('5.30')
    expect(screen.getByTestId('env-ceiling').textContent).toContain('no flow band learned')
  })

  it('opens on the band with the most samples when there is no outdoor temperature', () => {
    renderCard(envelope())
    expect(screen.getByTestId('env-band-6').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('env-s2-row-30')).toBeInTheDocument()
  })

  it('shows the best COP and a ceiling not yet found', () => {
    renderCard(envelope(), { outdoorTemp: 7 })
    const text = screen.getByTestId('env-ceiling').textContent ?? ''
    expect(text).toContain('4.68')
    expect(text).toContain('at the 34 °C flow band.')
    expect(text).toContain('not found yet')
    expect(text).toContain('learning')
  })

  it('shows a found ceiling and marks it on the chart', () => {
    renderCard(envelope({
      ceiling: [{ outdoor_c: 6, best_flow_c: 34, best_cop: 4.678, ceiling_flow_c: 38, mature: true }],
    }), { outdoorTemp: 7 })
    const text = screen.getByTestId('env-ceiling').textContent ?? ''
    expect(text).toContain('Ceiling: 38 °C flow band')
    expect(text).not.toContain('learning')
    expect(screen.getByTestId('reference-line').textContent).toBe('38')
  })

  it('changes the outdoor band on a click', () => {
    renderCard(envelope(), { outdoorTemp: 7 })
    fireEvent.click(screen.getByTestId('env-band-9'))
    expect(screen.getByTestId('env-band-9').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('env-band-6').getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('env-s2-row-30')).toBeNull()
  })

  it('lists the refusals, most first, with a label, and an unknown class by its key', () => {
    renderCard(envelope({ refused: { settling: 44, not_in_heat: 259, a_new_class: 2 } }))
    const items = screen.getAllByTestId(/^env-refused-/).filter((el) => el.tagName === 'LI')
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual([
      'env-refused-not_in_heat', 'env-refused-settling', 'env-refused-a_new_class',
    ])
    expect(items[0].textContent).toContain('Not heating')
    expect(items[2].textContent).toContain('a_new_class')
  })

  it('shows no samples yet in the ceiling section before any S2 bin', () => {
    renderCard(envelope({ s2: [], ceiling: [], s1: [], samples: 0 }))
    expect(screen.getByTestId('env-ceiling-section').textContent).toContain('No samples yet.')
    expect(screen.queryByTestId('scatter-chart')).toBeNull()
  })

  it('keeps the last good data on a failed read and says that it is stale', () => {
    renderCard(envelope(), { error: 'HTTP 503 — Efficiency envelope not yet initialised' })
    expect(screen.getByTestId('env-error').textContent).toBe(
      'The last read failed: HTTP 503 — Efficiency envelope not yet initialised. The values below are from the last good read.',
    )
    expect(screen.getByTestId('env-samples').textContent).toBe('221')
  })

  it('shows no reset control without onReset', () => {
    renderCard(envelope())
    expect(screen.queryByTestId('env-reset-request')).toBeNull()
  })

  it('states what a reset discards before it resets, and cancel resets nothing', () => {
    const onReset = vi.fn<() => Promise<ResetOutcome>>()
    renderCard(envelope(), { onReset })
    fireEvent.click(screen.getByTestId('env-reset-request'))
    expect(screen.getByTestId('env-reset-confirm').textContent).toContain(
      'Discard the learned efficiency envelope: 221 samples, 2 floor bins, 5 ceiling bins',
    )
    fireEvent.click(screen.getByTestId('env-reset-cancel'))
    expect(screen.queryByTestId('env-reset-confirm')).toBeNull()
    expect(onReset).not.toHaveBeenCalled()
  })

  it('resets on confirm and says so', async () => {
    const onReset = vi.fn<() => Promise<ResetOutcome>>().mockResolvedValue({ ok: true })
    renderCard(envelope(), { onReset })
    fireEvent.click(screen.getByTestId('env-reset-request'))
    fireEvent.click(screen.getByTestId('env-reset-confirm-btn'))
    await waitFor(() => expect(screen.getByTestId('env-reset-outcome').textContent).toContain('Envelope reset.'))
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('env-reset-confirm')).toBeNull()
  })

  it('shows a failed reset with its error', async () => {
    const onReset = vi.fn<() => Promise<ResetOutcome>>().mockResolvedValue({ ok: false, error: 'HTTP 503 — Efficiency envelope not yet initialised' })
    renderCard(envelope(), { onReset })
    fireEvent.click(screen.getByTestId('env-reset-request'))
    fireEvent.click(screen.getByTestId('env-reset-confirm-btn'))
    await waitFor(() => expect(screen.getByTestId('env-reset-outcome').textContent).toBe(
      'Reset failed: HTTP 503 — Efficiency envelope not yet initialised',
    ))
  })
})
