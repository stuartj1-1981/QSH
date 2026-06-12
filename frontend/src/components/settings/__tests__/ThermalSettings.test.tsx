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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

import { ThermalSettings } from '../ThermalSettings'

const noop = () => {}

// Co-resident keys live alongside the two surfaced fields. Declared as consts
// (not inline literals) so the extra keys clear TS excess-property checking
// against the ShoulderYaml / SummerYaml prop types.
const shoulderWithNeighbour = { forecast_horizon_hours: 12, hp_min_output_kw: 3.0 }
const summerWithNeighbour = { demand_threshold_kw: 0.3, outdoor_temp_threshold_c: 16 }

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'ok', restart_required: true, message: 'ok' })
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
