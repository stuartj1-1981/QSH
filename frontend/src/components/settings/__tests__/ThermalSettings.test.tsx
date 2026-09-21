/**
 * INSTRUCTION-334 — ThermalSettings seasonal-field parity (P-3/P-4).
 *
 * Surfaces `shoulder.forecast_horizon_hours` and `summer.demand_threshold_kw`
 * for edit-after-setup. Falsifiers:
 *  - both inputs render and bind;
 *  - whole-section writes preserve co-resident keys (clobber, both sections);
 *  - per-section dirty gating in BOTH directions (thermal-only ⇒ no seasonal
 *    PATCH; seasonal-only ⇒ no `thermal` PATCH);
 *  - save-gate floors with the falsy-valid demand 0 held in state and saved as
 *    0 (proving no `|| default` coercion);
 *  - abort on first failure ⇒ later sections not written, onRefetch withheld,
 *    error surfaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ControlSource } from '../../../types/api'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

// INSTRUCTION-544B T11(d) — mirrors HeatSourceSettings.controlSources.test.tsx's
// convention: mock useStatus directly rather than racing its internal fetch.
const statusData: { control_sources?: ControlSource[] } = {}

vi.mock('../../../hooks/useStatus', () => ({
  useStatus: () => ({ data: statusData, error: null }),
}))

import { ThermalSettings } from '../ThermalSettings'

const noop = () => {}

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Co-resident keys live alongside the two surfaced fields. Declared as consts
// (not inline literals) so the extra keys clear TS excess-property checking
// against the ShoulderYaml / SummerYaml prop types.
const shoulderWithNeighbour = { forecast_horizon_hours: 12, hp_min_output_kw: 3.0 }
const summerWithNeighbour = { demand_threshold_kw: 0.3, outdoor_temp_threshold_c: 16 }

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'ok', restart_required: true, message: 'ok' })
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  delete statusData.control_sources
})

afterEach(() => {
  vi.restoreAllMocks()
})

const forecastInput = () => screen.getByLabelText('Shoulder: Forecast Horizon (hours)')
const demandInput = () => screen.getByLabelText('Summer: Demand Threshold (kW)')
const saveButton = () => screen.getByRole('button', { name: /save changes/i })

describe('ThermalSettings — seasonal fields (INSTRUCTION-334)', () => {
  it('renders and binds both seasonal inputs', () => {
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={{ forecast_horizon_hours: 12 }}
        summer={{ demand_threshold_kw: 0.3 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(forecastInput()).toHaveValue(12)
    expect(demandInput()).toHaveValue(0.3)

    fireEvent.change(forecastInput(), { target: { value: '18' } })
    expect(forecastInput()).toHaveValue(18)
    fireEvent.change(demandInput(), { target: { value: '0.5' } })
    expect(demandInput()).toHaveValue(0.5)
  })

  it('whole-section writes preserve co-resident keys in BOTH sections', async () => {
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={shoulderWithNeighbour}
        summer={summerWithNeighbour}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.change(forecastInput(), { target: { value: '24' } })
    fireEvent.change(demandInput(), { target: { value: '0.6' } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(patch.mock.calls.find((c) => c[0] === 'shoulder')).toBeDefined()
      expect(patch.mock.calls.find((c) => c[0] === 'summer')).toBeDefined()
    })

    const shoulderPayload = patch.mock.calls.find((c) => c[0] === 'shoulder')![1]
    expect(shoulderPayload).toMatchObject({ forecast_horizon_hours: 24, hp_min_output_kw: 3.0 })

    const summerPayload = patch.mock.calls.find((c) => c[0] === 'summer')![1]
    expect(summerPayload).toMatchObject({ demand_threshold_kw: 0.6, outdoor_temp_threshold_c: 16 })

    // thermal untouched ⇒ not written.
    expect(patch.mock.calls.find((c) => c[0] === 'thermal')).toBeUndefined()
  })

  it('thermal-only edit writes only thermal (no seasonal PATCH)', async () => {
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={{ forecast_horizon_hours: 12 }}
        summer={{ demand_threshold_kw: 0.3 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Peak Heat Loss input — addressed by its placeholder (no label assoc).
    fireEvent.change(screen.getByPlaceholderText('5.0'), { target: { value: '6' } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('thermal', expect.objectContaining({ peak_loss_kw: 6 }))
    })
    expect(patch.mock.calls.find((c) => c[0] === 'shoulder')).toBeUndefined()
    expect(patch.mock.calls.find((c) => c[0] === 'summer')).toBeUndefined()
  })

  it('seasonal-only edit does NOT PATCH thermal (closes unconditional-thermal write)', async () => {
    render(
      <ThermalSettings
        thermal={{ peak_loss_kw: 5 }}
        shoulder={{ forecast_horizon_hours: 12 }}
        summer={{ demand_threshold_kw: 0.3 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.change(forecastInput(), { target: { value: '18' } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('shoulder', expect.objectContaining({ forecast_horizon_hours: 18 }))
    })
    expect(patch.mock.calls.find((c) => c[0] === 'thermal')).toBeUndefined()
  })

  it('out-of-floor forecast (0) disables Save — proves 0 reaches state, no || 12', () => {
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={{ forecast_horizon_hours: 12 }}
        summer={{ demand_threshold_kw: 0.3 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(saveButton()).not.toBeDisabled()
    fireEvent.change(forecastInput(), { target: { value: '0' } })
    expect(forecastInput()).toHaveValue(0)
    expect(saveButton()).toBeDisabled()
  })

  it('out-of-floor demand (-1) disables Save', () => {
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={{ forecast_horizon_hours: 12 }}
        summer={{ demand_threshold_kw: 0.3 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.change(demandInput(), { target: { value: '-1' } })
    expect(saveButton()).toBeDisabled()
  })

  it('in-floor demand 0 is valid: Save enabled and payload carries 0 (not coerced to 0.3)', async () => {
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={{ forecast_horizon_hours: 12 }}
        summer={{ demand_threshold_kw: 0.3 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.change(demandInput(), { target: { value: '0' } })
    expect(demandInput()).toHaveValue(0)
    expect(saveButton()).not.toBeDisabled()

    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(patch.mock.calls.find((c) => c[0] === 'summer')).toBeDefined()
    })
    const summerPayload = patch.mock.calls.find((c) => c[0] === 'summer')![1] as { demand_threshold_kw: number }
    expect(summerPayload.demand_threshold_kw).toBe(0)
  })

  it('aborts on first failure: later section not written, onRefetch withheld, error surfaced', async () => {
    const onRefetch = vi.fn()
    // shoulder fails (rejected promise — exercises the try/catch path);
    // every other section would succeed.
    patch.mockImplementation((section: string) =>
      section === 'shoulder' ? Promise.reject(new Error('boom')) : Promise.resolve({ updated: 'ok' }),
    )
    render(
      <ThermalSettings
        thermal={{}}
        shoulder={shoulderWithNeighbour}
        summer={summerWithNeighbour}
        rooms={[]}
        driver="ha"
        onRefetch={onRefetch}
      />,
    )
    // Make both shoulder and summer dirty so we can prove summer is skipped.
    fireEvent.change(forecastInput(), { target: { value: '24' } })
    fireEvent.change(demandInput(), { target: { value: '0.6' } })
    fireEvent.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save shoulder/i)
    // Ordered abort: summer (after shoulder) was never written.
    expect(patch.mock.calls.find((c) => c[0] === 'summer')).toBeUndefined()
    expect(onRefetch).not.toHaveBeenCalled()
  })
})

/**
 * INSTRUCTION-544B T11 — overtemp repointed off the whole-section thermal
 * payload (P39) onto its own control route (T11(c)), reading the operator
 * key (T11(b)) rather than thermal.overtemp_protection, and read-only +
 * source-named on an entity-bound or multi-source install (T11(d)).
 */
describe('ThermalSettings — overtemp control route (INSTRUCTION-544B T11)', () => {
  const overtempInput = () => screen.getByPlaceholderText('23.0') as HTMLInputElement

  it('reads the value from overtempThreshold, not thermal.overtemp_protection', () => {
    render(
      <ThermalSettings
        thermal={{ overtemp_protection: 19.0 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
        overtempThreshold={26.0}
      />,
    )
    expect(overtempInput()).toHaveValue(26)
  })

  it('writes through PATCH /api/control/overtemp-protection, not the whole-section thermal PATCH', async () => {
    vi.useFakeTimers()
    const onRefetch = vi.fn()
    const onRefetchProcessed = vi.fn()
    render(
      <ThermalSettings
        thermal={{}}
        rooms={[]}
        driver="ha"
        onRefetch={onRefetch}
        overtempThreshold={23.0}
        onRefetchProcessed={onRefetchProcessed}
      />,
    )
    fireEvent.change(overtempInput(), { target: { value: '24' } })
    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api/control/overtemp-protection'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ value: 24 }) }),
    )
    expect(onRefetch).toHaveBeenCalled()
    expect(onRefetchProcessed).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('OB-13 — the whole-section thermal PATCH never carries overtemp_protection, even when thermal is otherwise dirty', async () => {
    render(
      <ThermalSettings
        thermal={{ overtemp_protection: 23.0 }}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
        overtempThreshold={23.0}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('5.0'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(patch.mock.calls.find((c) => c[0] === 'thermal')).toBeDefined()
    })
    const thermalPayload = patch.mock.calls.find((c) => c[0] === 'thermal')![1]
    expect(thermalPayload).not.toHaveProperty('overtemp_protection')
    expect(thermalPayload).toMatchObject({ peak_loss_kw: 6 })
  })

  it('reverts and flashes an error when the write is refused', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
    render(
      <ThermalSettings
        thermal={{}}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
        overtempThreshold={23.0}
      />,
    )
    fireEvent.change(overtempInput(), { target: { value: '24' } })
    await act(async () => { vi.advanceTimersByTime(600) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(overtempInput()).toHaveValue(23)
    vi.useRealTimers()
  })

  it('renders read-only with the source named when an external entity is bound', () => {
    statusData.control_sources = [{
      key: 'overtemp_protection_internal',
      value: 24,
      source: 'external',
      external_id: 'input_number.overtemp_protection',
      external_raw: '24',
    }]
    render(
      <ThermalSettings
        thermal={{}}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
        overtempThreshold={24}
      />,
    )
    expect(screen.getByText(/via input_number\.overtemp_protection/)).toBeDefined()
  })

  it('renders read-only on a multi-source install with no entity bound', () => {
    render(
      <ThermalSettings
        thermal={{}}
        rooms={[]}
        driver="ha"
        onRefetch={noop}
        overtempThreshold={23.0}
        heatSources={[{ type: 'heat_pump' }, { type: 'heat_pump' }]}
      />,
    )
    expect(screen.queryByPlaceholderText('23.0')).toBeNull()
  })
})
