import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomCard } from '../RoomCard'

describe('RoomCard occupancy source icon', () => {
  const baseRoom = {
    temp: 20.0,
    target: 21.0,
    valve: 50,
    occupancy: 'occupied',
    status: 'heating',
    facing: 0.5,
    area_m2: 20,
    ceiling_m: 2.4,
  }

  it('renders occupancy text correctly', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders with sensor source', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'sensor' }}
      />
    )
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders with schedule source (default)', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'schedule' }}
      />
    )
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders with unavailable source', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' }}
      />
    )
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders without occupancy_source (undefined)', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    expect(screen.getByText('occupied')).toBeDefined()
  })
})

describe('RoomCard target tooltip', () => {
  const baseRoom = {
    temp: 20.0,
    target: 21.0,
    valve: 50,
    occupancy: 'occupied',
    status: 'heating',
    facing: 0.5,
    area_m2: 20,
    ceiling_m: 2.4,
  }

  it('uses generic fallback wording when comfortTempActive is omitted', () => {
    render(<RoomCard name="lounge" room={{ ...baseRoom, target: 20.0 }} />)
    const targetSpan = screen.getByText(/\/ 20\.0°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toMatch(/Comfort/)
    expect(title).toMatch(/unoccupied/)
  })

  it('renders setback wording with correct delta', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 20.0 }}
        comfortTempActive={21.5}
      />
    )
    const targetSpan = screen.getByText(/\/ 20\.0°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toContain('21.5')
    expect(title).toContain('20.0')
    expect(title).toContain('1.5')
    expect(title).toMatch(/setback/)
  })

  it('renders matches-Comfort wording when values are equal', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 21.5 }}
        comfortTempActive={21.5}
      />
    )
    const targetSpan = screen.getByText(/\/ 21\.5°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toMatch(/matches Comfort/)
  })

  it('treats sub-resolution differences as equal at display precision', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 21.46 }}
        comfortTempActive={21.5}
      />
    )
    const targetSpan = screen.getByText(/\/ 21\.5°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toMatch(/matches Comfort/)
  })

  it('classifies 0.1° rounded deltas as setback', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 21.44 }}
        comfortTempActive={21.5}
      />
    )
    const targetSpan = screen.getByText(/\/ 21\.4°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toMatch(/setback/)
    expect(title).toContain('0.1')
  })

  it('renders override wording when target exceeds Comfort', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 21.5 }}
        comfortTempActive={20.0}
      />
    )
    const targetSpan = screen.getByText(/\/ 21\.5°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toMatch(/above Comfort/)
    expect(title).not.toMatch(/boost/)
  })

  it('omits the target span entirely when target is null', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: null }}
        comfortTempActive={21.5}
      />
    )
    expect(screen.queryByText(/\/\s/)).toBeNull()
    expect(screen.queryByText(/setback/)).toBeNull()
    expect(screen.queryByText(/above Comfort/)).toBeNull()
    expect(screen.queryByText(/matches Comfort/)).toBeNull()
  })

  it('routes NaN comfortTempActive to the generic fallback', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 20.0 }}
        comfortTempActive={Number.NaN}
      />
    )
    const targetSpan = screen.getByText(/\/ 20\.0°/)
    const title = targetSpan.getAttribute('title') ?? ''
    expect(title).toMatch(/unoccupied|Active control target/)
    expect(title).not.toContain('NaN')
  })

  it('does not attach classification wording when the card is in boost branch', () => {
    const { container } = render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, target: 20.0 }}
        boost={{ target: 24.0, remaining_s: 1800, original_target: 21.0 }}
        comfortTempActive={21.5}
      />
    )
    const titledNodes = container.querySelectorAll('[title]')
    titledNodes.forEach((node) => {
      const title = node.getAttribute('title') ?? ''
      expect(title).not.toMatch(/setback/)
      expect(title).not.toMatch(/above Comfort/)
      expect(title).not.toMatch(/matches Comfort/)
    })
  })
})

describe('RoomCard heating-gate (hpActive)', () => {
  const baseRoom = {
    temp: 20.0,
    target: 21.0,
    valve: 50,
    occupancy: 'occupied',
    status: 'heating',
    facing: 0.5,
    area_m2: 20,
    ceiling_m: 2.4,
  }

  it('shows the heating badge and amber tint when hpActive=true', () => {
    render(<RoomCard name="lounge" room={baseRoom} hpActive={true} />)
    const badge = screen.getByText('heating')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('text-[var(--amber)]')
    const card = screen.getByRole('button')
    expect(card.className).toContain('bg-amber-500/10')
    expect(card.className).toContain('border-amber-500/20')
  })

  it('suppresses the heating badge and amber tint when hpActive=false', () => {
    render(<RoomCard name="lounge" room={baseRoom} hpActive={false} />)
    const card = screen.getByRole('button')
    expect(screen.queryByText('heating')).toBeNull()
    expect(card.className).not.toMatch(/bg-amber-/)
    expect(card.className).not.toMatch(/border-amber-/)
    expect(card.className).not.toMatch(/bg-orange-/)
    expect(card.className).toContain('border-[var(--border)]')
  })

  it('preserves the cold badge and red tint when hpActive=false', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, status: 'cold' }}
        hpActive={false}
      />
    )
    const badge = screen.getByText('cold')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('text-[var(--red)]')
    const card = screen.getByRole('button')
    expect(card.className).toContain('bg-red-500/10')
    expect(card.className).toContain('border-red-500/20')
  })

  it('renders the heating badge and amber tint when hpActive prop is omitted (default true)', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    const badge = screen.getByText('heating')
    expect(badge).toBeDefined()
    const card = screen.getByRole('button')
    expect(card.className).toContain('bg-amber-500/10')
  })
})
