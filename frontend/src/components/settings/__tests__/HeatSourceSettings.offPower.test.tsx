/**
 * INSTRUCTION-646B — the per-source off-power threshold field of Settings:
 * the type value as placeholder, an inline error outside the band, and the
 * saved value in the persist payload of `heat_sources`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { HeatSourceYaml } from '../../../types/config'
import { offPowerThresholdHelp } from '../../../lib/heat-source-types'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const noop = () => {}
const baseHs = { type: 'heat_pump' as const, efficiency: 3.5 }

function field(): HTMLInputElement {
  return document.getElementById('source-0-off-power-threshold') as HTMLInputElement
}

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'ok' })
})

describe('HeatSourceSettings — off-power threshold (INSTRUCTION-646B)', () => {
  it('shows the heat-pump type value as placeholder and no value', () => {
    render(
      <HeatSourceSettings heatSource={baseHs} heatSources={[{ type: 'heat_pump', name: 'HP' }]}
        driver="ha" onRefetch={noop} />,
    )
    expect(field().placeholder).toBe('default 0.1')
    expect(field().value).toBe('')
  })

  it('shows the boiler type value as placeholder', () => {
    render(
      <HeatSourceSettings heatSource={baseHs}
        heatSources={[{ type: 'gas_boiler', name: 'Boiler' } as HeatSourceYaml]}
        driver="ha" onRefetch={noop} />,
    )
    expect(field().placeholder).toBe('default 0.5')
  })

  it('flags a value outside the band inline', () => {
    render(
      <HeatSourceSettings heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'HP', off_power_threshold_kw: 1.5 }]}
        driver="ha" onRefetch={noop} />,
    )
    expect(screen.getByText(/Must be between 0\.05 and 1 kW/)).toBeInTheDocument()
    expect(field().getAttribute('aria-invalid')).toBe('true')
  })

  it('saves an edited value in the heat_sources payload', async () => {
    render(
      <HeatSourceSettings heatSource={baseHs} heatSources={[{ type: 'heat_pump', name: 'HP' }]}
        driver="ha" onRefetch={noop} />,
    )
    fireEvent.change(field(), { target: { value: '0.2' } })
    expect(screen.queryByText(/Must be between 0\.05 and 1 kW/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      const call = patch.mock.calls.find((c) => c[0] === 'heat_sources')!
      const sources = call[1] as Array<{ off_power_threshold_kw?: number }>
      expect(sources[0].off_power_threshold_kw).toBe(0.2)
    })
  })

  it('a cleared field saves the source with no key', async () => {
    render(
      <HeatSourceSettings heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'HP', off_power_threshold_kw: 0.2 }]}
        driver="ha" onRefetch={noop} />,
    )
    fireEvent.change(field(), { target: { value: '' } })
    expect(field().value).toBe('')
    expect(field().placeholder).toBe('default 0.1')
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      const call = patch.mock.calls.find((c) => c[0] === 'heat_sources')!
      // The request body is JSON, which drops an undefined value.
      const sent = JSON.parse(JSON.stringify(call[1])) as Array<Record<string, unknown>>
      expect('off_power_threshold_kw' in sent[0]).toBe(false)
    })
  })

  it('shows the help text that the wizard shows', () => {
    render(
      <HeatSourceSettings heatSource={baseHs} heatSources={[{ type: 'heat_pump', name: 'HP' }]}
        driver="ha" onRefetch={noop} />,
    )
    expect(screen.getByText(offPowerThresholdHelp('heat_pump'))).toBeInTheDocument()
  })
})
