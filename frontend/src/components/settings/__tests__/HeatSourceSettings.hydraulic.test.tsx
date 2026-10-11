/**
 * INSTRUCTION-575H — Settings → Heat Sources carries the hydraulic
 * protection fields on the primary source card (index 0) only, and the
 * values reach the heat_sources PATCH payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { HeatSourceYaml, QshConfigYaml } from '../../../types/config'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

vi.mock('../../../hooks/useStatus', () => ({
  useStatus: () => ({ data: null, loading: false, error: null }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const rootConfig: QshConfigYaml = {
  rooms: {
    lounge: { area_m2: 20 },
    bedroom: { area_m2: 12 },
  },
}

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'ok' })
})

function renderSettings(heatSources: HeatSourceYaml[]) {
  render(
    <HeatSourceSettings
      heatSource={heatSources[0]}
      heatSources={heatSources}
      rootConfig={rootConfig}
      driver="ha"
      onRefetch={() => {}}
    />,
  )
}

describe('HeatSourceSettings — hydraulic protection', () => {
  it('requires the minimum flow rate on a primary source with a flow-rate sensor', () => {
    renderSettings([
      { type: 'heat_pump', name: 'hp', sensors: { flow_rate: 'sensor.hp_flow_rate' } },
    ])
    const input = screen.getByLabelText(/Minimum flow rate/) as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('does not show the minimum flow rate without a flow-rate sensor', () => {
    renderSettings([{ type: 'heat_pump', name: 'hp' }])
    expect(screen.getByText(/Hydraulic protection/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Minimum flow rate/)).toBeNull()
  })

  it('sends the three values in the heat_sources PATCH payload', async () => {
    renderSettings([
      { type: 'heat_pump', name: 'hp', sensors: { flow_rate: 'sensor.hp_flow_rate' } },
    ])
    fireEvent.change(screen.getByLabelText(/Minimum flow rate/), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText(/Bypass room setpoint/), { target: { value: '26' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'lounge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))

    await waitFor(() => {
      expect(patch.mock.calls.find((c) => c[0] === 'heat_sources')).toBeDefined()
    })
    const sources = patch.mock.calls.find((c) => c[0] === 'heat_sources')![1] as HeatSourceYaml[]
    expect(sources[0].min_flow_rate).toBe(12)
    expect(sources[0].bypass_setpoint).toBe(26)
    expect(sources[0].bypass_rooms).toEqual(['lounge'])
  })

  it('shows the fields on the primary card only', () => {
    renderSettings([
      { type: 'heat_pump', name: 'hp' },
      { type: 'gas_boiler', name: 'boiler' },
    ])
    expect(screen.getAllByText(/Hydraulic protection/)).toHaveLength(1)
    // Collapse the primary card and expand the second: no fields there.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse source 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand source 2' }))
    expect(screen.queryByText(/Hydraulic protection/)).toBeNull()
  })
})
