/**
 * INSTRUCTION-646B — on a boiler, the η label shows while the input power is
 * at or above the server's resolved off-power threshold; with no value from
 * the server it keeps the constant of 0.5 kW.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import type { HeatSourceState } from '../../types/api'

const baseProps = {
  operatingState: 'Heating',
  controlEnabled: true,
  appliedFlow: 55,
  appliedMode: 'heat',
  outdoorTemp: 2,
}

function boiler(input_power_kw: number, off_power_threshold_kw?: number | null): HeatSourceState {
  return {
    type: 'gas_boiler',
    input_power_kw,
    thermal_output_kw: 0.5,
    thermal_output_source: 'computed',
    performance: { value: 0.89, source: 'config' },
    flow_temp: 55,
    return_temp: 40,
    delta_t: 15,
    flow_rate: 10,
    off_power_threshold_kw,
  }
}

describe('StatusBanner — resolved off-power threshold (INSTRUCTION-646B)', () => {
  it('a boiler at 0.8 kW with a threshold of 1.0 shows no η label', () => {
    render(<StatusBanner {...baseProps} heatSource={boiler(0.8, 1.0)} />)
    expect(screen.queryByText(/η 0\.89/)).toBeNull()
  })

  it('a boiler at 0.3 kW with a threshold of 0.2 shows the η label', () => {
    render(<StatusBanner {...baseProps} heatSource={boiler(0.3, 0.2)} />)
    expect(screen.getByText(/η 0\.89/)).toBeDefined()
  })

  it('with no value from the server it keeps 0.5 kW', () => {
    render(<StatusBanner {...baseProps} heatSource={boiler(0.3, null)} />)
    expect(screen.queryByText(/η 0\.89/)).toBeNull()
  })
})
