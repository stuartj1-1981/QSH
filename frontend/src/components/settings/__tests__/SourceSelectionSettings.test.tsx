/**
 * 228B Task 5 — SourceSelectionSettings tests.
 *
 *  - Multi-source vs single-source rendering paths.
 *  - Mode selector: 'Auto' + 'Lock to <name>' per configured source.
 *  - Engineering-gated controls hidden / visible per qsh-engineering flag.
 *  - Slider clamps to 0..1; daily cap clamps to 1..12 (UI guard).
 *  - Save dispatches PATCH /api/config/source_selection with the YAML wire
 *    shape: bare-name mode (no `lock:` prefix); preference 0..1 decimal;
 *    min_dwell_minutes / score_deadband_pct / max_switches_per_day at their
 *    persisted units.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

import { SourceSelectionSettings } from '../SourceSelectionSettings'
import type { SourceSelectionYaml } from '../../../types/config'

const baseConfig: SourceSelectionYaml = {
  mode: 'auto',
  preference: 0.7,
  min_dwell_minutes: 30,
  score_deadband_pct: 10.0,
  max_switches_per_day: 6,
}

const TWO_SOURCES = ['heat_pump', 'lpg_boiler']
const THREE_SOURCES = ['heat_pump', 'gas_boiler', 'lpg_boiler']

const noop = () => {}

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'source_selection' })
  // Engineering toggle defaults to OFF unless a test sets it.
  try { localStorage.removeItem('qsh-engineering') } catch { /* jsdom */ }
})

afterEach(() => {
  try { localStorage.removeItem('qsh-engineering') } catch { /* jsdom */ }
})

describe('SourceSelectionSettings — single-source explainer', () => {
  it('renders the explainer note when fewer than two sources are configured', () => {
    render(<SourceSelectionSettings sourceNames={['heat_pump']} onRefetch={noop} />)
    expect(screen.getByTestId('source-selection-explainer')).toBeDefined()
    expect(screen.queryByTestId('source-selection-panel')).toBeNull()
    expect(screen.getByText(/Hybrid source selection becomes available/)).toBeDefined()
  })

  it('renders explainer even when config is undefined and zero sources are configured', () => {
    render(<SourceSelectionSettings sourceNames={[]} onRefetch={noop} />)
    expect(screen.getByTestId('source-selection-explainer')).toBeDefined()
    expect(screen.queryByTestId('source-selection-panel')).toBeNull()
  })
})

describe('SourceSelectionSettings — mode selector', () => {
  it('renders mode selector with one option per heat source (two sources)', () => {
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'Lock to heat_pump' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'Lock to lpg_boiler' })).toBeDefined()
  })

  it('renders mode selector with one option per heat source (three sources)', () => {
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={THREE_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeDefined()
    for (const name of THREE_SOURCES) {
      expect(screen.getByRole('radio', { name: `Lock to ${name}` })).toBeDefined()
    }
  })

  it('checks the radio matching the YAML mode field (auto)', () => {
    render(
      <SourceSelectionSettings
        config={{ ...baseConfig, mode: 'auto' }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect((screen.getByRole('radio', { name: 'Auto' }) as HTMLInputElement).checked).toBe(true)
  })

  it('checks the radio matching the YAML mode field (lpg_boiler)', () => {
    render(
      <SourceSelectionSettings
        config={{ ...baseConfig, mode: 'lpg_boiler' }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(
      (screen.getByRole('radio', { name: 'Lock to lpg_boiler' }) as HTMLInputElement).checked,
    ).toBe(true)
  })
})

describe('SourceSelectionSettings — engineering gate', () => {
  it('engineering-gated controls hidden when qsh-engineering=false', () => {
    // localStorage absent / not 'true'
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.queryByTestId('source-selection-engineering')).toBeNull()
    expect(screen.queryByTestId('source-selection-dwell')).toBeNull()
    expect(screen.queryByTestId('source-selection-deadband')).toBeNull()
    expect(screen.queryByTestId('source-selection-daily-cap')).toBeNull()
  })

  it('engineering-gated controls visible when qsh-engineering=true', () => {
    localStorage.setItem('qsh-engineering', 'true')
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.getByTestId('source-selection-engineering')).toBeDefined()
    expect(screen.getByTestId('source-selection-dwell')).toBeDefined()
    expect(screen.getByTestId('source-selection-deadband')).toBeDefined()
    expect(screen.getByTestId('source-selection-daily-cap')).toBeDefined()
  })
})

describe('SourceSelectionSettings — preference slider', () => {
  it('preference slider clamps to 0..1 at save time even when state somehow exceeds', async () => {
    render(
      <SourceSelectionSettings
        config={{ ...baseConfig, preference: 0.5 }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    const slider = screen.getByTestId('source-selection-preference') as HTMLInputElement
    // The <input type=range> has min=0 max=100; jsdom respects these attrs.
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('100')

    // Drive a value and save. Resulting wire payload must lie in [0, 1].
    fireEvent.change(slider, { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    const body = patch.mock.calls[0][1] as SourceSelectionYaml
    expect(body.preference).toBeGreaterThanOrEqual(0)
    expect(body.preference).toBeLessThanOrEqual(1)
    expect(body.preference).toBe(1)
  })

  it('preference slider anchor text reflects extremes', () => {
    const { rerender } = render(
      <SourceSelectionSettings
        config={{ ...baseConfig, preference: 0 }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.getByTestId('source-selection-preference-anchor').textContent).toBe('Pure cost')

    rerender(
      <SourceSelectionSettings
        config={{ ...baseConfig, preference: 1 }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.getByTestId('source-selection-preference-anchor').textContent).toBe('Pure carbon')

    rerender(
      <SourceSelectionSettings
        config={{ ...baseConfig, preference: 0.5 }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    expect(screen.getByTestId('source-selection-preference-anchor').textContent).toBe('Balanced')
  })
})

describe('SourceSelectionSettings — daily-cap clamp', () => {
  beforeEach(() => {
    localStorage.setItem('qsh-engineering', 'true')
  })

  it('daily switch cap clamps to 1..12 when user types a higher value', async () => {
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    const input = screen.getByTestId('source-selection-daily-cap') as HTMLInputElement
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    const body = patch.mock.calls[0][1] as SourceSelectionYaml
    expect(body.max_switches_per_day).toBe(12)
  })

  it('daily switch cap clamps to 1 when user types a lower value', async () => {
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    const input = screen.getByTestId('source-selection-daily-cap') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    const body = patch.mock.calls[0][1] as SourceSelectionYaml
    expect(body.max_switches_per_day).toBe(1)
  })
})

describe('SourceSelectionSettings — save dispatch', () => {
  beforeEach(() => {
    localStorage.setItem('qsh-engineering', 'true')
  })

  it('save dispatches PATCH /api/config/source_selection with YAML shape', async () => {
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch).toHaveBeenCalledWith('source_selection', expect.objectContaining({
      mode: 'auto',
      preference: 0.7,
      min_dwell_minutes: 30,
      score_deadband_pct: 10.0,
      max_switches_per_day: 6,
    }))
  })

  it('lock-to-<name> mode is stripped to bare name in the wire payload', async () => {
    render(
      <SourceSelectionSettings
        config={{ ...baseConfig, mode: 'auto' }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    // Click the lpg_boiler radio (internal value `lock:lpg_boiler`)
    fireEvent.click(screen.getByRole('radio', { name: 'Lock to lpg_boiler' }))
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    const body = patch.mock.calls[0][1] as SourceSelectionYaml
    expect(body.mode).toBe('lpg_boiler')  // backend expects bare name, not `lock:lpg_boiler`
  })

  it('switching back to Auto from a lock writes mode="auto"', async () => {
    render(
      <SourceSelectionSettings
        config={{ ...baseConfig, mode: 'heat_pump' }}
        sourceNames={TWO_SOURCES}
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }))
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    const body = patch.mock.calls[0][1] as SourceSelectionYaml
    expect(body.mode).toBe('auto')
  })

  it('onRefetch invoked after a successful save', async () => {
    const onRefetch = vi.fn()
    render(
      <SourceSelectionSettings
        config={baseConfig}
        sourceNames={TWO_SOURCES}
        onRefetch={onRefetch}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
  })
})
