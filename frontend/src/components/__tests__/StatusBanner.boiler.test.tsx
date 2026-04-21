/**
 * INSTRUCTION-117E Task 8a — StatusBanner source-aware render regression.
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

function boilerSource(overrides: Partial<HeatSourceState> = {}): HeatSourceState {
  return {
    type: 'gas_boiler',
    input_power_kw: 12,
    thermal_output_kw: 10.68,
    thermal_output_source: 'computed',
    performance: { value: 0.89, source: 'config' },
    flow_temp: 55,
    return_temp: 40,
    delta_t: 15,
    flow_rate: 10,
    ...overrides,
  }
}

function hpSource(overrides: Partial<HeatSourceState> = {}): HeatSourceState {
  return {
    type: 'heat_pump',
    input_power_kw: 2.1,
    thermal_output_kw: 7.56,
    thermal_output_source: 'measured',
    performance: { value: 3.6, source: 'live' },
    flow_temp: 40,
    return_temp: 35,
    delta_t: 5,
    flow_rate: 0.38,
    ...overrides,
  }
}

describe('StatusBanner — boiler install', () => {
  it('renders η label and never COP on a gas boiler', () => {
    render(<StatusBanner {...baseProps} heatSource={boilerSource()} />)
    expect(screen.getByText(/η 0\.89/)).toBeDefined()
    expect(screen.queryByText(/COP/)).toBeNull()
  })

  it('renders flame icon (lucide-flame), not zap, on a boiler', () => {
    const { container } = render(
      <StatusBanner {...baseProps} heatSource={boilerSource()} />,
    )
    expect(container.querySelector('.lucide-flame')).not.toBeNull()
    expect(container.querySelector('.lucide-zap')).toBeNull()
  })

  it('prefixes computed thermal output with "≈ " and surfaces η tooltip', () => {
    const { container } = render(
      <StatusBanner {...baseProps} heatSource={boilerSource()} />,
    )
    const bannerText = container.textContent ?? ''
    expect(bannerText).toMatch(/≈ 10\.7 kW out/)

    const tooltipHost = container.querySelector('[title="estimated from η = 0.89"]')
    expect(tooltipHost).not.toBeNull()
  })

  it('drops the ≈ prefix when thermal output is measured', () => {
    const { container } = render(
      <StatusBanner
        {...baseProps}
        heatSource={boilerSource({ thermal_output_source: 'measured' })}
      />,
    )
    const bannerText = container.textContent ?? ''
    expect(bannerText).not.toMatch(/≈/)
    expect(container.querySelector('[title]')).toBeNull()
  })
})

describe('StatusBanner — heat pump install', () => {
  it('renders Zap icon and COP label on HP', () => {
    const { container } = render(
      <StatusBanner {...baseProps} heatSource={hpSource()} />,
    )
    expect(container.querySelector('.lucide-zap')).not.toBeNull()
    expect(container.querySelector('.lucide-flame')).toBeNull()
    expect(screen.getByText(/COP 3\.6/)).toBeDefined()
  })

  it('uses numeric-free tooltip when HP output is computed', () => {
    const { container } = render(
      <StatusBanner
        {...baseProps}
        heatSource={hpSource({ thermal_output_source: 'computed' })}
      />,
    )
    // Tooltip must not embed the numeric COP value — per Task 4b flicker-free.
    expect(
      container.querySelector('[title="estimated from live COP"]'),
    ).not.toBeNull()
  })

  it('suppresses COP label when HP performance source is "config" (INSTRUCTION-119)', () => {
    // Parent V5 §Source Power Resolution: after the 5-cycle hold expires
    // the HP performance source flips to "config", carrying the baseline
    // value (2.5). INSTRUCTION-119 Task 6: the Home banner suppresses the
    // COP label in that case — 2.5 is a degraded-state fallback, not a
    // live COP reading, and must not render as one. The icon and other
    // layout elements stay unchanged.
    const { container: live } = render(
      <StatusBanner {...baseProps} heatSource={hpSource()} />,
    )
    const { container: fallback } = render(
      <StatusBanner
        {...baseProps}
        heatSource={hpSource({
          performance: { value: 2.5, source: 'config' },
        })}
      />,
    )
    expect(live.querySelector('.lucide-zap')).not.toBeNull()
    expect(fallback.querySelector('.lucide-zap')).not.toBeNull()
    // Live → COP rendered; fallback → suppressed.
    expect(live.textContent).toMatch(/COP 3\.6/)
    expect(fallback.textContent).not.toMatch(/COP/)
  })
})
