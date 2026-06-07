/**
 * INSTRUCTION-288B — StatusBanner quarantine banner render.
 * The banner appears only when quarantine.quarantined is true; absent/false
 * renders nothing quarantine-related (happy path byte-identical).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import type { HeatSourceState, QuarantineStatus } from '../../types/api'

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

const QUARANTINE_MSG = /flagged for review\. Contact support to be re-instated/i

describe('StatusBanner — quarantine', () => {
  it('renders the re-instatement banner, reason, and contact when quarantined', () => {
    const quarantine: QuarantineStatus = {
      quarantined: true,
      reason: 'flagged: anomalous fabrication pattern',
      contact: 'https://support.example.com',
    }
    render(<StatusBanner {...baseProps} quarantine={quarantine} />)
    expect(screen.getByTestId('quarantine-banner')).toBeDefined()
    expect(screen.getByText(QUARANTINE_MSG)).toBeDefined()
    expect(screen.getByText(/anomalous fabrication pattern/)).toBeDefined()
    expect(screen.getByText(/support\.example\.com/)).toBeDefined()
  })

  it('renders no quarantine banner when quarantined is false', () => {
    const quarantine: QuarantineStatus = { quarantined: false, reason: null, contact: null }
    render(<StatusBanner {...baseProps} quarantine={quarantine} />)
    expect(screen.queryByTestId('quarantine-banner')).toBeNull()
    expect(screen.queryByText(QUARANTINE_MSG)).toBeNull()
  })

  it('renders no quarantine banner when the prop is omitted', () => {
    render(<StatusBanner {...baseProps} />)
    expect(screen.queryByTestId('quarantine-banner')).toBeNull()
  })
})
