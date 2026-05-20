import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { OperatingStateTimeline } from '../OperatingStateTimeline'

describe('OperatingStateTimeline', () => {
  it('renders an empty placeholder when data is empty', () => {
    const { container } = render(<OperatingStateTimeline data={[]} hours={24} />)
    expect(container.textContent ?? '').toMatch(/No history data/i)
  })

  it('renders one segment per operating state run', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 10, 30, 0) / 1000
    const t2 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const data = [
      { t: t0, operating_state: 'winter equilibrium' },
      { t: t1, operating_state: 'shoulder monitoring' },
      { t: t2, operating_state: 'shoulder monitoring' },
    ]
    const { container } = render(<OperatingStateTimeline data={data} hours={24} />)
    // Two distinct segments — winter equilibrium then shoulder monitoring.
    const segs = container.querySelectorAll('.h-7 > div')
    expect(segs.length).toBe(2)
  })

  it('portals a tooltip with the state name on mouseEnter and removes it on mouseLeave', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const data = [
      { t: t0, operating_state: 'winter equilibrium' },
      { t: t1, operating_state: 'winter equilibrium' },
    ]
    const { container } = render(<OperatingStateTimeline data={data} hours={24} />)
    const seg = container.querySelector('.h-7 > div') as HTMLElement
    expect(seg).not.toBeNull()

    fireEvent.mouseEnter(seg)
    const tip = document.body.querySelector('[role="tooltip"]')
    expect(tip).not.toBeNull()
    expect(tip?.textContent ?? '').toContain('winter equilibrium')

    fireEvent.mouseLeave(seg)
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('portal escape: tooltip is not a descendant of the render container', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const data = [
      { t: t0, operating_state: 'shoulder heating' },
      { t: t1, operating_state: 'shoulder heating' },
    ]
    const { container } = render(<OperatingStateTimeline data={data} hours={24} />)
    const seg = container.querySelector('.h-7 > div') as HTMLElement
    fireEvent.mouseEnter(seg)
    const tip = document.body.querySelector('[role="tooltip"]')
    expect(tip).not.toBeNull()
    expect(container.contains(tip)).toBe(false)
  })
})
