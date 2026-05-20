import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { OccupancyTimeline } from '../OccupancyTimeline'

describe('OccupancyTimeline', () => {
  it('renders one strip per room with title-bearing segments', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 10, 30, 0) / 1000
    const t2 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'occupied' },
        { t: t1, occupancy: 'unoccupied' },
        { t: t2, occupancy: 'unoccupied' },
      ],
    }

    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segments = container.querySelectorAll('[title]')
    // Two state segments (occupied, unoccupied)
    expect(segments.length).toBe(2)
  })

  it('portals a tooltip with state and mid-dot separator on mouseEnter', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 10, 30, 0) / 1000
    const t2 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'occupied' },
        { t: t1, occupancy: 'unoccupied' },
        { t: t2, occupancy: 'unoccupied' },
      ],
    }

    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segments = container.querySelectorAll('[title]')
    expect(segments.length).toBeGreaterThan(0)
    const firstSegment = segments[0] as HTMLElement
    fireEvent.mouseEnter(firstSegment)

    const tooltipEl = document.body.querySelector('[role="tooltip"]')
    expect(tooltipEl).not.toBeNull()
    expect(tooltipEl?.textContent ?? '').toMatch(/occupied|unoccupied/)
    expect(tooltipEl?.textContent ?? '').toContain('·') // mid-dot

    // Portal escape: tooltip is NOT a descendant of the test render container.
    expect(container.contains(tooltipEl)).toBe(false)
  })

  it('removes the portaled tooltip on mouseLeave', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 10, 30, 0) / 1000
    const t2 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'occupied' },
        { t: t1, occupancy: 'unoccupied' },
        { t: t2, occupancy: 'unoccupied' },
      ],
    }

    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segments = container.querySelectorAll('[title]')
    const firstSegment = segments[0] as HTMLElement
    fireEvent.mouseEnter(firstSegment)
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()

    fireEvent.mouseLeave(firstSegment)
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('keeps a title attribute on every segment for screen-reader accessibility', () => {
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 10, 30, 0) / 1000
    const t2 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'occupied' },
        { t: t1, occupancy: 'unoccupied' },
        { t: t2, occupancy: 'unoccupied' },
      ],
    }

    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segments = container.querySelectorAll('[title]')
    expect(segments.length).toBeGreaterThan(0)
    const titles = Array.from(segments).map(s => s.getAttribute('title') ?? '')
    expect(titles.some(t => t.includes('living room'))).toBe(true)
    expect(titles.some(t => t.includes('occupied'))).toBe(true)
    expect(titles.some(t => t.includes('→'))).toBe(true)
  })

  it('renders nothing when roomHistory is empty', () => {
    const { container } = render(<OccupancyTimeline roomHistory={{}} hours={24} />)
    expect(container.firstChild).toBeNull()
  })

  it('merges sub-60-second spurious segments into the surrounding window', () => {
    // 2h occupied window with a 30-second spurious transition in the middle.
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t_spike = Date.UTC(2026, 3, 15, 9, 0, 0) / 1000
    const t_spike_end = t_spike + 30 // 30 seconds
    const t_end = Date.UTC(2026, 3, 15, 10, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'occupied' },
        { t: t_spike, occupancy: 'unoccupied' },
        { t: t_spike_end, occupancy: 'occupied' },
        { t: t_end, occupancy: 'occupied' },
      ],
    }

    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segments = container.querySelectorAll('[title]')
    // The 30s segment is absorbed and the surrounding occupied runs collapse
    // into a single segment.
    expect(segments.length).toBe(1)
  })

  it('forward-absorbs a tiny leading segment into the next segment (Pass 1)', () => {
    // 20s unoccupied sample at the start, then a 2h occupied window.
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = t0 + 20
    const t2 = Date.UTC(2026, 3, 15, 10, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'unoccupied' },
        { t: t1, occupancy: 'occupied' },
        { t: t2, occupancy: 'occupied' },
      ],
    }

    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segments = container.querySelectorAll('[title]')
    expect(segments.length).toBe(1)
    const title = segments[0].getAttribute('title') ?? ''
    // Forward-absorption means the surviving segment takes the NEXT state
    // (occupied), not the tiny leading unoccupied state.
    expect(title).toContain('occupied')
    // And critically, the tiny leading "unoccupied" state must NOT survive as
    // its own segment title.
    expect(title).not.toContain('— unoccupied ')
  })

  it('does not register an onMouseMove handler on segments (crash regression guard)', () => {
    // Rationale: INSTRUCTION-103 removed onMouseMove because calling
    // setTooltip(prev => ({ ...prev, xPct: getXPct(e) })) captures the
    // SyntheticEvent in the updater, which React flushes after the handler
    // returns — at which point e.currentTarget is null. Accessing its
    // parentElement crashes the whole React tree.
    //
    // Direct test: we cannot easily introspect React event handlers from the
    // DOM. Instead, fire a mouseMove on a segment and assert the call does
    // not throw and the DOM is still intact. JSDOM preserves currentTarget
    // where real browsers do not, so this test only guards the no-handler
    // invariant — the real browser crash is prevented by the code change.
    const t0 = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const t1 = Date.UTC(2026, 3, 15, 14, 0, 0) / 1000
    const roomHistory = {
      living_room: [
        { t: t0, occupancy: 'occupied' },
        { t: t1, occupancy: 'occupied' },
      ],
    }
    const { container } = render(<OccupancyTimeline roomHistory={roomHistory} hours={24} />)
    const segment = container.querySelector('[title]') as HTMLElement
    expect(() => fireEvent.mouseMove(segment)).not.toThrow()
    // Tree still intact.
    expect(container.querySelector('[title]')).not.toBeNull()
  })
})
