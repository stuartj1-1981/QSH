import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecoveryCard } from '../RecoveryCard'

describe('RecoveryCard', () => {
  it('shows "At comfort" when recovery <= 0.05h', () => {
    render(<RecoveryCard recoveryTimeHours={0.03} capacityPct={20} />)
    expect(screen.getByText('At comfort')).toBeDefined()
  })

  it('shows "At comfort" when recovery is 0', () => {
    render(<RecoveryCard recoveryTimeHours={0} capacityPct={0} />)
    expect(screen.getByText('At comfort')).toBeDefined()
  })

  it('shows minutes when recovery < 1h', () => {
    render(<RecoveryCard recoveryTimeHours={0.42} capacityPct={50} />)
    expect(screen.getByText('25 min')).toBeDefined()
  })

  it('shows hours and minutes when recovery >= 1h', () => {
    render(<RecoveryCard recoveryTimeHours={2.5} capacityPct={80} />)
    expect(screen.getByText('2h 30m')).toBeDefined()
  })

  it('shows "24h+" when recovery >= 24h', () => {
    render(<RecoveryCard recoveryTimeHours={30} capacityPct={120} />)
    expect(screen.getByText('24h+')).toBeDefined()
  })

  it('shows hours only when minutes round to 0', () => {
    render(<RecoveryCard recoveryTimeHours={3.0} capacityPct={60} />)
    expect(screen.getByText('3h')).toBeDefined()
  })

  it('shows label text', () => {
    render(<RecoveryCard recoveryTimeHours={1} capacityPct={50} />)
    expect(screen.getByText('Time to comfort')).toBeDefined()
  })
})
