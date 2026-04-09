import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapacityBar } from '../CapacityBar'

describe('CapacityBar', () => {
  it('shows green when capacity < 80%', () => {
    const { container } = render(
      <CapacityBar capacityPct={60} minLoadPct={33} />
    )
    expect(screen.getByText('60%')).toBeDefined()
    const fill = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(fill.style.backgroundColor).toBe('var(--green)')
    expect(fill.style.width).toBe('60%')
  })

  it('shows amber when capacity 80-100%', () => {
    const { container } = render(
      <CapacityBar capacityPct={90} minLoadPct={33} />
    )
    expect(screen.getByText('90%')).toBeDefined()
    const fill = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(fill.style.backgroundColor).toBe('var(--amber)')
  })

  it('shows red when capacity > 100%', () => {
    const { container } = render(
      <CapacityBar capacityPct={125} minLoadPct={33} />
    )
    expect(screen.getByText('125%')).toBeDefined()
    const fill = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(fill.style.backgroundColor).toBe('var(--red)')
  })

  it('caps bar width at 100% even when overloaded', () => {
    const { container } = render(
      <CapacityBar capacityPct={150} minLoadPct={33} />
    )
    const fill = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('shows Home Heat Demand label', () => {
    render(<CapacityBar capacityPct={50} minLoadPct={33} />)
    expect(screen.getByText('Home Heat Demand')).toBeDefined()
  })

  it('shows correct percentage', () => {
    render(<CapacityBar capacityPct={42} minLoadPct={33} />)
    expect(screen.getByText('42%')).toBeDefined()
  })

  it('shows "All rooms at target" when capacityPct < 1', () => {
    render(<CapacityBar capacityPct={0} minLoadPct={33} />)
    expect(screen.getByText('All rooms at target')).toBeDefined()
  })

  it('shows "Below start threshold" when capacityPct > 0 and < minLoadPct', () => {
    render(<CapacityBar capacityPct={20} minLoadPct={33} />)
    expect(screen.getByText('Below start threshold')).toBeDefined()
  })

  it('shows "System heating" when capacityPct >= minLoadPct and < 80', () => {
    render(<CapacityBar capacityPct={50} minLoadPct={33} />)
    expect(screen.getByText('System heating')).toBeDefined()
  })

  it('shows "High demand" when capacityPct >= 80', () => {
    render(<CapacityBar capacityPct={85} minLoadPct={33} />)
    expect(screen.getByText('High demand')).toBeDefined()
  })

  it('positions threshold marker at correct percentage', () => {
    const { container } = render(
      <CapacityBar capacityPct={50} minLoadPct={33} />
    )
    const marker = container.querySelector('.w-1.rounded-full') as HTMLElement
    expect(marker).toBeDefined()
    expect(marker.style.left).toBe('33%')
  })

  it('threshold marker has correct title attribute', () => {
    render(<CapacityBar capacityPct={50} minLoadPct={33} />)
    const marker = screen.getByTitle('System starts at 33%')
    expect(marker).toBeDefined()
  })

  it('shows "Minimum HP demand" label above threshold marker', () => {
    render(<CapacityBar capacityPct={50} minLoadPct={33} />)
    expect(screen.getByText('Minimum HP demand')).toBeDefined()
  })

  it('hides threshold marker and label when minLoadPct is 0', () => {
    const { container } = render(
      <CapacityBar capacityPct={50} minLoadPct={0} />
    )
    const marker = container.querySelector('.w-1.rounded-full')
    expect(marker).toBeNull()
    expect(screen.queryByText('Minimum HP demand')).toBeNull()
  })
})
