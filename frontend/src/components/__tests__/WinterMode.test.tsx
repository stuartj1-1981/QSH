import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import { EngineeringBar } from '../EngineeringBar'

describe('StatusBanner winter colour', () => {
  it('renders blue dot for Winter state (test 33)', () => {
    const { container } = render(
      <StatusBanner
        operatingState="Winter (Heating)"
        controlEnabled={true}
        appliedFlow={35}
        appliedMode="heat"
        outdoorTemp={4}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 2.0,
          thermal_output_kw: 7.0,
          thermal_output_source: 'measured',
          performance: { value: 3.5, source: 'live' },
          flow_temp: 35,
          return_temp: 30,
          delta_t: 5,
          flow_rate: 0.3,
        }}
      />
    )
    const dot = container.querySelector('.bg-\\[var\\(--blue\\)\\]')
    expect(dot).toBeDefined()
    expect(dot).not.toBeNull()
  })

  it('renders blue dot for Winter (Equilibrium) state (test 34)', () => {
    const { container } = render(
      <StatusBanner
        operatingState="Winter (Equilibrium)"
        controlEnabled={true}
        appliedFlow={33}
        appliedMode="heat"
        outdoorTemp={4}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 1.5,
          thermal_output_kw: 6.0,
          thermal_output_source: 'measured',
          performance: { value: 4.0, source: 'live' },
          flow_temp: 33,
          return_temp: 29,
          delta_t: 4,
          flow_rate: 0.28,
        }}
      />
    )
    const dot = container.querySelector('.bg-\\[var\\(--blue\\)\\]')
    expect(dot).toBeDefined()
    expect(dot).not.toBeNull()
  })
})

describe('EngineeringBar winter badge', () => {
  const baseProps = {
    cycleNumber: 100,
    detFlow: 35.0,
    rlFlow: null,
    rlBlend: 0.0,
    rlReward: 0.5,
    shoulderMonitoring: false,
    summerMonitoring: false,
  }

  it('renders Winter badge when antifrost active (test 35)', () => {
    render(
      <EngineeringBar
        {...baseProps}
        antifrostOverrideActive={true}
        winterEquilibrium={false}
      />
    )
    expect(screen.getByText('Winter')).toBeDefined()
  })

  it('renders Winter (Eq) badge when equilibrium (test 36)', () => {
    render(
      <EngineeringBar
        {...baseProps}
        antifrostOverrideActive={true}
        winterEquilibrium={true}
      />
    )
    expect(screen.getByText('Winter (Eq)')).toBeDefined()
  })

  it('does not render winter badge when inactive (test 37)', () => {
    render(
      <EngineeringBar
        {...baseProps}
        antifrostOverrideActive={false}
        winterEquilibrium={false}
      />
    )
    expect(screen.queryByText('Winter')).toBeNull()
    expect(screen.queryByText('Winter (Eq)')).toBeNull()
  })
})

