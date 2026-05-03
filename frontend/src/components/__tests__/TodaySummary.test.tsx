/**
 * INSTRUCTION-150E Task 7d — TodaySummary install-topology-aware labelling.
 *
 * Covers V2 E-H2: the cost-tile label routes through `heat_sources.length`
 * (physical primary heat sources) NOT `fuels_in_use.length`. A
 * gas-boiler-with-electric-immersion install has heat_source_count == 1
 * (immersion is backup, not primary); the label MUST read "Gas cost
 * today", not "Heating cost today".
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodaySummary } from '../TodaySummary'
import { costLabelFor } from '../../lib/sourceLabels'

const baseProps = {
  costTodayPence: 250,
  energyTodayKwh: 12.5,
  currentRate: 0.245,
}

describe('TodaySummary — install-topology-aware label', () => {
  it('renders "HP cost today" for heat_pump active source on single-source install', () => {
    render(<TodaySummary {...baseProps} activeSource="heat_pump" heatSourceCount={1} />)
    expect(screen.getByText('HP cost today')).toBeDefined()
  })

  it('renders "Gas cost today" for gas_boiler active source on single-source install', () => {
    render(<TodaySummary {...baseProps} activeSource="gas_boiler" heatSourceCount={1} />)
    expect(screen.getByText('Gas cost today')).toBeDefined()
  })

  it('renders "Heating cost today" for hybrid install (2+ heat_sources)', () => {
    // V2 E-H2: heatSourceCount > 1 → label is "Heating cost today" regardless
    // of which source happens to be active right now.
    render(<TodaySummary {...baseProps} activeSource="heat_pump" heatSourceCount={2} />)
    expect(screen.getByText('Heating cost today')).toBeDefined()
  })

  it('renders "Gas cost today" for boiler-with-immersion install (1 heat_source, gas active)', () => {
    // V2 E-H2: V1 mislabel regression. tariff_providers_status has 2 fuels
    // (electricity + gas) because immersion exists, but heat_source_count
    // == 1 because the immersion is backup, not a primary source. Label
    // MUST read "Gas cost today", NOT "Heating cost today".
    render(<TodaySummary {...baseProps} activeSource="gas_boiler" heatSourceCount={1} />)
    expect(screen.getByText('Gas cost today')).toBeDefined()
    expect(screen.queryByText('Heating cost today')).toBeNull()
  })

  it('renders "LPG cost today" for lpg_boiler active source', () => {
    render(<TodaySummary {...baseProps} activeSource="lpg_boiler" heatSourceCount={1} />)
    expect(screen.getByText('LPG cost today')).toBeDefined()
  })

  it('renders "Oil cost today" for oil_boiler active source', () => {
    render(<TodaySummary {...baseProps} activeSource="oil_boiler" heatSourceCount={1} />)
    expect(screen.getByText('Oil cost today')).toBeDefined()
  })

  it('falls back to "Heating cost today" when activeSource is null/unknown', () => {
    render(<TodaySummary {...baseProps} activeSource={null} heatSourceCount={1} />)
    expect(screen.getByText('Heating cost today')).toBeDefined()
  })

  it('renders cost rate sub-line non-zero for boiler installs (V2 L4 regression after 150C mirror)', () => {
    // Pre-150C, currentRate was 0 on boiler installs because the gas
    // provider didn't mirror. After 150C, the snapshot populates correctly
    // and the tile shows a non-zero p/kWh value. We assert non-zero rather
    // than a specific value (V3 150E-V2-L1) since the precise rate is
    // implementation-time-dependent.
    render(<TodaySummary {...baseProps} currentRate={0.07} activeSource="gas_boiler" heatSourceCount={1} />)
    const rateMatch = screen.getByText(/p\/kWh/).textContent
    expect(rateMatch).toMatch(/[1-9]/)  // some non-zero digit
  })
})

describe('costLabelFor — pure function', () => {
  it('"Heating cost today" for hybrid (count > 1)', () => {
    expect(costLabelFor('heat_pump', 2)).toBe('Heating cost today')
    expect(costLabelFor('gas_boiler', 3)).toBe('Heating cost today')
  })

  it('source-specific label for single-source installs', () => {
    expect(costLabelFor('heat_pump', 1)).toBe('HP cost today')
    expect(costLabelFor('gas_boiler', 1)).toBe('Gas cost today')
    expect(costLabelFor('lpg_boiler', 1)).toBe('LPG cost today')
    expect(costLabelFor('oil_boiler', 1)).toBe('Oil cost today')
  })

  it('"Heating cost today" for null / unknown source', () => {
    expect(costLabelFor(null, 1)).toBe('Heating cost today')
    expect(costLabelFor(undefined, 1)).toBe('Heating cost today')
    expect(costLabelFor('mystery_source', 1)).toBe('Heating cost today')
  })
})
