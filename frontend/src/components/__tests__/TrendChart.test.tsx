import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendChart } from '../TrendChart'

const DATA = [
  { t: 1000, value: 10 },
  { t: 2000, value: 12 },
]
const LINES = [{ key: 'value', label: 'Value', color: 'var(--accent)' }]

describe('TrendChart', () => {
  it('renders the title with data and no yDomain', () => {
    render(<TrendChart title="Test Trend" data={DATA} lines={LINES} />)
    expect(screen.getByText('Test Trend')).toBeInTheDocument()
  })

  it('renders with a yDomain supplied', () => {
    render(<TrendChart title="Test Trend" data={DATA} lines={LINES} yDomain={[0, 100]} />)
    expect(screen.getByText('Test Trend')).toBeInTheDocument()
  })

  it('renders the "No history data yet" branch for empty data', () => {
    render(<TrendChart title="Empty Trend" data={[]} lines={LINES} />)
    expect(screen.getByText('Empty Trend')).toBeInTheDocument()
    expect(screen.getByText(/No history data yet/)).toBeInTheDocument()
  })
})
