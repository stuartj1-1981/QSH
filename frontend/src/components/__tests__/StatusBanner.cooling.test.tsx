/**
 * INSTRUCTION-364 — StatusBanner active-cooling banner.
 * Renders only when coolingActive is true; absent/false renders nothing
 * cooling-related (happy path byte-identical).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import type { HeatSourceState } from '../../types/api'

const heatSource: HeatSourceState = {
  type: 'heat_pump',
  input_power_kw: 2.1,
  thermal_output_kw: 7.56,
  thermal_output_source: 'measured',
  performance: { value: 3.6, source: 'live' },
  flow_temp: 40,
  return_temp: 35,
  delta_t: 5,
  flow_rate: 0.38,
}

const baseProps = {
  operatingState: 'Heating',
  controlEnabled: true,
  appliedFlow: 40,
  appliedMode: 'heat',
  outdoorTemp: 5,
  heatSource,
}

const COOLING_MSG = /Active cooling — SysID learning paused/i

describe('StatusBanner — active cooling', () => {
  it('renders the cooling banner when coolingActive is true', () => {
    render(<StatusBanner {...baseProps} coolingActive={true} />)
    expect(screen.getByTestId('cooling-banner')).toBeDefined()
    expect(screen.getByText(COOLING_MSG)).toBeDefined()
  })

  it('renders no cooling banner when coolingActive is false', () => {
    render(<StatusBanner {...baseProps} coolingActive={false} />)
    expect(screen.queryByTestId('cooling-banner')).toBeNull()
    expect(screen.queryByText(COOLING_MSG)).toBeNull()
  })

  it('renders no cooling banner when the prop is omitted', () => {
    render(<StatusBanner {...baseProps} />)
    expect(screen.queryByTestId('cooling-banner')).toBeNull()
  })
})
