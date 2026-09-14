import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Away } from '../Away'

function mockFetchForAway(rooms: Record<string, unknown> = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('api/away')) {
      return {
        ok: true,
        json: async () => ({
          whole_house: { active: false, days: 1 },
          per_zone: {
            living_room: {
              active: false,
              is_persistent: false,
              days: 1,
              computed_depth_c: 2,
            },
          },
          recovery: { active: false, rooms: {} },
        }),
      } as Response
    }
    if (url.includes('api/status/rooms')) {
      return { ok: true, json: async () => ({ timestamp: 0, rooms }) } as Response
    }
    if (url.includes('api/history')) {
      return { ok: true, json: async () => ({ rooms: {} }) } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  })
}

describe('Away page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the zone cell without the capitalize class when the room has a display_name', async () => {
    mockFetchForAway({ living_room: { display_name: 'Snug' } })

    render(<Away />)

    // "Snug" also renders in the Per-Zone Controls list below the table
    // (ZoneSelector) — scope to the Zone Status table's cell specifically.
    const cell = await screen.findByText('Snug', { selector: 'td' })
    expect(cell.className).not.toContain('capitalize')
  })

  it('renders the zone cell with the capitalize class when the room has no display_name', async () => {
    mockFetchForAway({ living_room: {} })

    render(<Away />)

    const cell = await screen.findByText('living room', { selector: 'td' })
    expect(cell.className).toContain('capitalize')
  })
})
