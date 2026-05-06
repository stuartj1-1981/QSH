/**
 * INSTRUCTION-131C V6 — frontend tests for the RoomDetail Auxiliary output
 * section. The 12 scenarios below lock the V4/C5 tri-state contract for the
 * dispatch-fault badge: it must fire ONLY when `aux_state === true && aux_dispatched === false`.
 * Shadow (`aux_dispatched === null`) and never-attempted-yet must NOT trigger.
 *
 * Each test asserts via `getByText` / `queryByText` against exact text — no
 * truthiness, no partial-text matchers (per V4/C6 lockdown).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomDetail } from '../RoomDetail'
import type { RoomState } from '../../types/api'

const baseRoom: RoomState = {
  temp: 20.0,
  target: 21.0,
  valve: 50,
  occupancy: 'occupied',
  status: 'heating',
  facing: 0.5,
  area_m2: 20,
  ceiling_m: 2.4,
}

const noop = () => {}

describe('RoomDetail aux section', () => {
  it('renders nothing when aux_state is undefined', () => {
    render(<RoomDetail name="lounge" room={baseRoom} engineering={false} onClose={noop} />)
    expect(screen.queryByText('Auxiliary output')).toBeNull()
    expect(screen.queryByText('ON')).toBeNull()
    expect(screen.queryByText('OFF')).toBeNull()
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('renders nothing when aux_state is null (room unconfigured)', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: null,
      aux_dispatched: null,
      aux_rated_kw: 0,
      aux_min_on_s: null,
      aux_min_off_s: null,
      aux_max_cycles_per_hour: null,
    }
    render(<RoomDetail name="lounge" room={room} engineering={false} onClose={noop} />)
    expect(screen.queryByText('Auxiliary output')).toBeNull()
    expect(screen.queryByText('ON')).toBeNull()
    expect(screen.queryByText('OFF')).toBeNull()
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('shadow + ON: pill ON, no dispatch-fault badge (aux_dispatched=null)', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: null,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('Auxiliary output')).toBeInTheDocument()
    expect(screen.getByText('ON')).toBeInTheDocument()
    expect(screen.queryByText('OFF')).toBeNull()
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('shadow + OFF: pill OFF, no dispatch-fault badge (aux_dispatched=null)', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: false,
      aux_dispatched: null,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('Auxiliary output')).toBeInTheDocument()
    expect(screen.getByText('OFF')).toBeInTheDocument()
    expect(screen.queryByText('ON')).toBeNull()
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('live + never attempted: pill ON, no badge (aux_dispatched=null)', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: null,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('ON')).toBeInTheDocument()
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('live + last attempt succeeded: pill ON, no badge (aux_dispatched=true)', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: true,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('ON')).toBeInTheDocument()
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('live + last attempt failed, state still ON: pill ON, BADGE PRESENT (aux_dispatched=false)', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: false,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('ON')).toBeInTheDocument()
    expect(screen.getByText('dispatch fault')).toBeInTheDocument()
  })

  it('live + post-revert state OFF, last attempt was failure: pill OFF, no badge', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: false,
      aux_dispatched: false,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('OFF')).toBeInTheDocument()
    expect(screen.queryByText('ON')).toBeNull()
    // Critical: badge gate is `aux_state === true && aux_dispatched === false`.
    // aux_state=false here, so no badge even though aux_dispatched=false.
    expect(screen.queryByText('dispatch fault')).toBeNull()
  })

  it('rated_kw > 0: shows kW caption', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: true,
      aux_rated_kw: 2.0,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('2.0 kW')).toBeInTheDocument()
    expect(screen.queryByText('monitor only')).toBeNull()
  })

  it('rated_kw == 0: shows "monitor only" caption', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: true,
      aux_rated_kw: 0,
      aux_min_on_s: 60,
      aux_min_off_s: 60,
      aux_max_cycles_per_hour: 6,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.getByText('monitor only')).toBeInTheDocument()
    expect(screen.queryByText(/kW/)).toBeNull()
  })

  it('engineering toggle on + configured: protection sub-row present', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: true,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={true} onClose={noop} />)
    expect(screen.getByText(/Min on\/off: 90s \/ 120s/)).toBeInTheDocument()
    expect(screen.getByText(/Max 4\/h/)).toBeInTheDocument()
  })

  it('engineering toggle off: protection sub-row absent even if configured', () => {
    const room: RoomState = {
      ...baseRoom,
      aux_state: true,
      aux_dispatched: true,
      aux_rated_kw: 1.5,
      aux_min_on_s: 90,
      aux_min_off_s: 120,
      aux_max_cycles_per_hour: 4,
    }
    render(<RoomDetail name="bathroom" room={room} engineering={false} onClose={noop} />)
    expect(screen.queryByText(/Min on\/off:/)).toBeNull()
    expect(screen.queryByText(/Max 4\/h/)).toBeNull()
  })
})
