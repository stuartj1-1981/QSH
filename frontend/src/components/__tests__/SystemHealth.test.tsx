import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SystemHealth } from '../SystemHealth'

describe('SystemHealth', () => {
  it('renders both RecoveryCard and CapacityBar', () => {
    render(
      <SystemHealth
        recoveryState="recovering"
        recoveryTimeHours={1.5}
        capacityPct={60}
        minLoadPct={33}
      />
    )
    expect(screen.getByText('Time to comfort')).toBeDefined()
    expect(screen.getByText('Home Heat Demand')).toBeDefined()
    expect(screen.getByText('1h 30m')).toBeDefined()
    expect(screen.getByText('60%')).toBeDefined()
  })

  it('handles zero/null data gracefully', () => {
    render(
      <SystemHealth
        recoveryState="at_comfort"
        recoveryTimeHours={0}
        capacityPct={0}
        minLoadPct={33}
      />
    )
    expect(screen.getByText('At comfort')).toBeDefined()
    expect(screen.getByText('0%')).toBeDefined()
  })

  it('passes the recovery state to the card', () => {
    render(
      <SystemHealth
        recoveryState="below_minimum"
        recoveryTimeHours={-1}
        capacityPct={5}
        minLoadPct={33}
      />
    )
    expect(screen.getByText('Demand below minimum')).toBeDefined()
  })
})
