import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import { EngineeringBar } from '../EngineeringBar'
import { AntifrostThreshold } from '../AntifrostThreshold'

describe('StatusBanner winter colour', () => {
  it('renders blue dot for Winter state (test 33)', () => {
    const { container } = render(
      <StatusBanner
        operatingState="Winter (Heating)"
        controlEnabled={true}
        appliedFlow={35}
        appliedMode="heat"
        outdoorTemp={4}
        hpPowerKw={2.0}
        hpCop={3.5}
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
        hpPowerKw={1.5}
        hpCop={4.0}
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
    antifrostThreshold: 7.0,
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

describe('AntifrostThreshold', () => {
  it('renders current value (test 43)', () => {
    render(<AntifrostThreshold threshold={7.0} />)
    expect(screen.getByText('7.0°C')).toBeDefined()
  })

  it('renders with different threshold value', () => {
    render(<AntifrostThreshold threshold={6.5} />)
    expect(screen.getByText('6.5°C')).toBeDefined()
  })

  it('renders increment and decrement buttons', () => {
    render(<AntifrostThreshold threshold={7.0} />)
    expect(screen.getByText('−')).toBeDefined()
    expect(screen.getByText('+')).toBeDefined()
  })
})

describe('EngineeringBar passes threshold (test 46)', () => {
  it('renders AntifrostThreshold with threshold from props', () => {
    render(
      <EngineeringBar
        cycleNumber={100}
        detFlow={35.0}
        rlFlow={null}
        rlBlend={0.0}
        rlReward={0.5}
        shoulderMonitoring={false}
        summerMonitoring={false}
        antifrostOverrideActive={false}
        winterEquilibrium={false}
        antifrostThreshold={6.0}
      />
    )
    expect(screen.getByText('6.0°C')).toBeDefined()
  })
})
