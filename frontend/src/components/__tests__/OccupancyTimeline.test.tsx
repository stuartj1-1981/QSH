import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { OccupancyTimeline } from '../OccupancyTimeline'

describe('OccupancyTimeline', () => {
  it('renders a tooltip containing the room name, state and the arrow separator', () => {
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

    const titles = Array.from(segments).map(s => s.getAttribute('title') ?? '')
    for (const title of titles) {
      expect(title).toContain('living room')  // underscores replaced
      expect(title).toContain('\u2192')
    }
    expect(titles.some(t => t.includes('occupied'))).toBe(true)
    expect(titles.some(t => t.includes('unoccupied'))).toBe(true)
  })

  it('renders nothing when roomHistory is empty', () => {
    const { container } = render(<OccupancyTimeline roomHistory={{}} hours={24} />)
    expect(container.firstChild).toBeNull()
  })
})
