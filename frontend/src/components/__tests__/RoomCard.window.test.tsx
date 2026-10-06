import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomCard } from '../RoomCard'
import { WINDOW } from '../../lib/helpText'
import type { RoomState } from '../../types/api'

// INSTRUCTION-569F T6 — the room card's window badge, its fault icon and the
// target tooltip. Each case renders the card with a room at 19.0 °C and a
// 14.0 °C target.
describe('RoomCard window state (INSTRUCTION-569F)', () => {
  const baseRoom: RoomState = {
    temp: 19.0,
    target: 14.0,
    valve: 0,
    occupancy: 'occupied',
    status: 'ok',
    facing: 0.5,
    area_m2: 20,
    ceiling_m: 2.4,
  }

  it('(1) no badge and no icon with the fields absent', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    expect(screen.queryByTestId('window-badge-lounge')).toBeNull()
    expect(screen.queryByTestId('window-fault-lounge')).toBeNull()
  })

  it('(2) no badge and no icon with window_source: null', () => {
    render(<RoomCard name="lounge" room={{ ...baseRoom, window_source: null }} />)
    expect(screen.queryByTestId('window-badge-lounge')).toBeNull()
    expect(screen.queryByTestId('window-fault-lounge')).toBeNull()
  })

  it('(3) contact gives the text "Window open", the title WINDOW.open and the label "window open"', () => {
    render(<RoomCard name="lounge" room={{ ...baseRoom, window_source: 'contact' }} />)
    const badge = screen.getByTestId('window-badge-lounge')
    expect(badge.textContent).toBe('Window open')
    expect(badge).toHaveAttribute('title', WINDOW.open)
    expect(screen.getByLabelText('window open')).toBe(badge)
  })

  it('(4) inferred gives "Window open?" and WINDOW.inferred', () => {
    render(<RoomCard name="lounge" room={{ ...baseRoom, window_source: 'inferred' }} />)
    const badge = screen.getByTestId('window-badge-lounge')
    expect(badge.textContent).toBe('Window open?')
    expect(badge).toHaveAttribute('title', WINDOW.inferred)
    // The inferred state is a detector's conclusion, and is announced as one.
    expect(screen.getByLabelText('window open, inferred')).toBe(badge)
  })

  it('(5) a fault gives the icon with the title WINDOW.fault and the label "window sensor not available", and no badge', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, window_source: null, window_sensor_fault: true }}
      />
    )
    const icon = screen.getByTestId('window-fault-lounge')
    expect(icon).toHaveAttribute('title', WINDOW.fault)
    // The door glyph and no text (T2's Gate 5 statement).
    expect(icon.querySelector('svg')).not.toBeNull()
    expect(icon.textContent).toBe('')
    expect(screen.getByLabelText('window sensor not available')).toBe(icon)
    expect(screen.queryByTestId('window-badge-lounge')).toBeNull()
  })

  it('(6) both set gives the badge and no icon', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, window_source: 'inferred', window_sensor_fault: true }}
      />
    )
    expect(screen.getByTestId('window-badge-lounge')).toBeInTheDocument()
    expect(screen.queryByTestId('window-fault-lounge')).toBeNull()
  })

  it('(7) contact with comfortTempActive 20 gives WINDOW.open as the title of the target', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, window_source: 'contact' }}
        comfortTempActive={20}
      />
    )
    const targetSpan = screen.getByText('/ 14.0°')
    expect(targetSpan).toHaveAttribute('title', WINDOW.open)
  })

  it('(8) with no contact, and with an inferred state, the target\'s title holds "setback"', () => {
    const { unmount } = render(
      <RoomCard name="lounge" room={baseRoom} comfortTempActive={20} />
    )
    expect(screen.getByText('/ 14.0°').getAttribute('title') ?? '').toContain('setback')
    unmount()

    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, window_source: 'inferred' }}
        comfortTempActive={20}
      />
    )
    expect(screen.getByText('/ 14.0°').getAttribute('title') ?? '').toContain('setback')
  })

  it('(9) contact with a target equal to Comfort gives "Target matches Comfort"', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, window_source: 'contact' }}
        comfortTempActive={14}
      />
    )
    expect(screen.getByText('/ 14.0°').getAttribute('title') ?? '').toContain(
      'Target matches Comfort'
    )
  })

  it('(10) each mark has role="img"', () => {
    const { unmount } = render(
      <RoomCard name="lounge" room={{ ...baseRoom, window_source: 'contact' }} />
    )
    expect(screen.getByTestId('window-badge-lounge')).toHaveAttribute('role', 'img')
    unmount()

    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, window_source: null, window_sensor_fault: true }}
      />
    )
    expect(screen.getByTestId('window-fault-lounge')).toHaveAttribute('role', 'img')
  })

  it('(11) the temperature and the target stay visible', () => {
    render(<RoomCard name="lounge" room={{ ...baseRoom, window_source: 'contact' }} />)
    expect(screen.getByText('19.0°')).toBeVisible()
    expect(screen.getByText('/ 14.0°')).toBeVisible()
  })
})
