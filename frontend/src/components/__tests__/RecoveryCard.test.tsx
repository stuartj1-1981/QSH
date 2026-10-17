import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecoveryCard } from '../RecoveryCard'
import type { RecoveryState } from '../../types/api'

describe('RecoveryCard', () => {
  it('shows minutes when recovering and the time is under 1h', () => {
    render(<RecoveryCard recoveryState="recovering" recoveryTimeHours={0.42} capacityPct={50} />)
    expect(screen.getByText('25 min')).toBeDefined()
  })

  it('shows hours and minutes when recovering and the time is 1h or more', () => {
    render(<RecoveryCard recoveryState="recovering" recoveryTimeHours={2.5} capacityPct={80} />)
    expect(screen.getByText('2h 30m')).toBeDefined()
  })

  it('shows "24h+" when recovering and the time is 24h or more', () => {
    render(<RecoveryCard recoveryState="recovering" recoveryTimeHours={30} capacityPct={120} />)
    expect(screen.getByText('24h+')).toBeDefined()
  })

  it('shows hours only when the minutes round to 0', () => {
    render(<RecoveryCard recoveryState="recovering" recoveryTimeHours={3.0} capacityPct={60} />)
    expect(screen.getByText('3h')).toBeDefined()
  })

  it('shows the label text', () => {
    render(<RecoveryCard recoveryState="recovering" recoveryTimeHours={1} capacityPct={50} />)
    expect(screen.getByText('Time to comfort')).toBeDefined()
  })

  it('shows "No Demand" when the state is no_demand', () => {
    render(<RecoveryCard recoveryState="no_demand" recoveryTimeHours={0} capacityPct={0} />)
    expect(screen.getByText('No Demand')).toBeDefined()
  })

  it('shows "Demand below minimum" when the state is below_minimum', () => {
    render(<RecoveryCard recoveryState="below_minimum" recoveryTimeHours={0} capacityPct={5} />)
    expect(screen.getByText('Demand below minimum')).toBeDefined()
  })

  it('shows "Insufficient capacity" when the state is insufficient_capacity', () => {
    render(<RecoveryCard recoveryState="insufficient_capacity" recoveryTimeHours={-1} capacityPct={95} />)
    expect(screen.getByText('Insufficient capacity')).toBeDefined()
  })

  it('shows "At comfort" when the state is at_comfort', () => {
    render(<RecoveryCard recoveryState="at_comfort" recoveryTimeHours={0} capacityPct={20} />)
    expect(screen.getByText('At comfort')).toBeDefined()
  })

  it('shows a dash when the state is waiting', () => {
    render(<RecoveryCard recoveryState="waiting" recoveryTimeHours={0} capacityPct={50} />)
    expect(screen.getByText('\u2014')).toBeDefined()
  })

  it('does not read the hours of the solver when the heat pump is off for low demand', () => {
    // The field report: demand 0.3 kW, heat pump off, solver time -1.
    render(<RecoveryCard recoveryState="below_minimum" recoveryTimeHours={-1} capacityPct={5} />)
    expect(screen.getByText('Demand below minimum')).toBeDefined()
  })

  it('shows the state text, not the time, when the state is not recovering', () => {
    render(<RecoveryCard recoveryState="no_demand" recoveryTimeHours={2.5} capacityPct={0} />)
    expect(screen.getByText('No Demand')).toBeDefined()
    expect(screen.queryByText('2h 30m')).toBeNull()
  })

  it('shows a dash for a state that this card does not know', () => {
    // A newer backend can send a state that this build lacks.
    render(<RecoveryCard recoveryState={'starting' as unknown as RecoveryState} recoveryTimeHours={-1} capacityPct={5} />)
    expect(screen.getByTestId('recovery-card').textContent).toBe('Time to comfort\u2014')
  })

  it('shows a value for every state of the RecoveryState type', () => {
    // The Record type makes the compiler refuse a state that this list lacks.
    const every: Record<RecoveryState, true> = {
      no_demand: true,
      below_minimum: true,
      insufficient_capacity: true,
      recovering: true,
      at_comfort: true,
      waiting: true,
    }
    for (const state of Object.keys(every) as RecoveryState[]) {
      const { unmount } = render(<RecoveryCard recoveryState={state} recoveryTimeHours={1} capacityPct={50} />)
      expect(screen.getByTestId('recovery-card').textContent).not.toBe('Time to comfort')
      unmount()
    }
  })
})
