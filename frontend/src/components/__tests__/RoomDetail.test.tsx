import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomDetail } from '../RoomDetail'

const baseRoom = {
  temp: 20.0,
  target: 21.0,
  valve: 50,
  occupancy: 'occupied' as const,
  status: 'heating',
  facing: 0.5,
  area_m2: 20,
  ceiling_m: 2.4,
}

const noop = () => {}

describe('RoomDetail sensor unavailable explanation', () => {
  it('shows explanatory text when occupancy_source includes "unavailable"', () => {
    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByText(/Occupancy sensor is not responding/)).toBeDefined()
    expect(screen.getByText(/Using your saved schedule/)).toBeDefined()
  })

  it('does not show explanatory text when sensor is healthy', () => {
    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'sensor' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByText(/Occupancy sensor is not responding/)).toBeNull()
  })

  it('does not show explanatory text when no occupancy_source', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByText(/Occupancy sensor is not responding/)).toBeNull()
  })
})

describe('RoomDetail temperature source row', () => {
  it('renders "None — schedule only" for none_configured rooms', () => {
    render(
      <RoomDetail
        name="utility"
        room={{ ...baseRoom, temperature_source: 'none_configured' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByText('None — schedule only')).toBeInTheDocument()
  })

  it('renders "Independent sensor" for independent rooms', () => {
    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, temperature_source: 'independent' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByText('Independent sensor')).toBeInTheDocument()
  })
})


// =============================================================================
// INSTRUCTION-172 — fixed_setpoint annotation on the target line
// =============================================================================


describe('RoomDetail fixed_setpoint annotation', () => {
  const sysidBase = {
    u_kw_per_c: 0.05,
    c_kwh_per_c: 0.5,
    u_observations: 100,
    c_observations: 50,
    c_source: 'measured' as const,
    pc_fits: 5,
    solar_gain: 0.0,
    confidence: 'high' as const,
  }

  it('renders "(fixed)" annotation when sysid.fixed_setpoint is set', () => {
    render(
      <RoomDetail
        name="spare"
        room={baseRoom}
        sysid={{ ...sysidBase, fixed_setpoint: 19.0 }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByTestId('fixed-target-annotation')).toBeInTheDocument()
    expect(screen.getByText('(fixed)')).toBeInTheDocument()
  })

  it('omits "(fixed)" annotation when sysid.fixed_setpoint is null', () => {
    render(
      <RoomDetail
        name="spare"
        room={baseRoom}
        sysid={{ ...sysidBase, fixed_setpoint: null }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('fixed-target-annotation')).toBeNull()
  })

  it('omits "(fixed)" annotation when sysid is not provided', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('fixed-target-annotation')).toBeNull()
  })

  it('omits "(fixed)" annotation when sysid omits fixed_setpoint key', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        sysid={sysidBase}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('fixed-target-annotation')).toBeNull()
  })
})


// =============================================================================
// INSTRUCTION-224E — per-emitter valve block
// =============================================================================


describe('RoomDetail per-emitter valve block (INSTRUCTION-224E)', () => {
  it('renders the per-emitter block for multi-emitter rooms', () => {
    render(
      <RoomDetail
        name="open_plan"
        room={{
          ...baseRoom,
          valve: 55,
          valve_positions_per_emitter: {
            dining_trv: 90,
            sitting_room_trv: 20,
          },
        }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByTestId('per-emitter-valve-block')).toBeDefined()
    expect(screen.getByText('Per-Emitter Valve Position')).toBeDefined()
    expect(screen.getByText('dining_trv')).toBeDefined()
    expect(screen.getByText('sitting_room_trv')).toBeDefined()
    expect(screen.getByText('90%')).toBeDefined()
    expect(screen.getByText('20%')).toBeDefined()
  })

  it('does NOT render the per-emitter block for single-emitter rooms', () => {
    render(
      <RoomDetail
        name="kitchen"
        room={{
          ...baseRoom,
          valve: 60,
          valve_positions_per_emitter: { kitchen_trv: 60 },
        }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('per-emitter-valve-block')).toBeNull()
    expect(screen.queryByText('Per-Emitter Valve Position')).toBeNull()
  })

  it('does NOT render the per-emitter block when per-emitter is undefined or empty', () => {
    const { rerender } = render(
      <RoomDetail
        name="kitchen"
        room={baseRoom}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('per-emitter-valve-block')).toBeNull()
    rerender(
      <RoomDetail
        name="kitchen"
        room={{ ...baseRoom, valve_positions_per_emitter: {} }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('per-emitter-valve-block')).toBeNull()
  })

  it('still renders the aggregate Valve headline regardless of per-emitter presence', () => {
    render(
      <RoomDetail
        name="open_plan"
        room={{
          ...baseRoom,
          valve: 55,
          valve_positions_per_emitter: {
            dining_trv: 90,
            sitting_room_trv: 20,
          },
        }}
        engineering={false}
        onClose={noop}
      />
    )
    // The aggregate Valve line uses `${room.valve}%`. Tolerate the existing
    // DetailItem markup by matching the value string anywhere in the document.
    expect(screen.getByText('55%')).toBeDefined()
  })
})

describe('RoomDetail MANUAL context strip (INSTRUCTION-225D)', () => {
  it('omits the strip when room is in AUTO', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
        manualEntry={{
          room: 'lounge', mode: 'AUTO', position_pct: null,
          set_by: 'startup_default', set_at: 0, hardware_type: 'direct_type1',
        }}
      />
    )
    expect(screen.queryByTestId('manual-strip')).toBeNull()
    expect(screen.queryByText(/Manual Override/i)).toBeNull()
  })

  it('shows position, set_by, and set_at when room is in MANUAL', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
        manualEntry={{
          room: 'lounge', mode: 'MANUAL', position_pct: 65,
          set_by: 'engineering_ui',
          set_at: 1715600000,
          hardware_type: 'direct_type1',
        }}
      />
    )
    const strip = screen.getByTestId('manual-strip')
    expect(strip).toBeDefined()
    expect(strip.textContent).toContain('Manual Override')
    expect(strip.textContent).toContain('65')
    expect(strip.textContent).toContain('engineering_ui')
    // set_at formatted via toLocaleTimeString — verify the text contains
    // something time-like (digits-colon-digits). Avoids tying the test to
    // a specific locale.
    expect(strip.textContent).toMatch(/\d{1,2}[:.]\d{2}/)
  })

  it('strip does NOT include an AUTO/MAN toggle (read-only)', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
        manualEntry={{
          room: 'lounge', mode: 'MANUAL', position_pct: 65,
          set_by: 'engineering_ui', set_at: 1715600000, hardware_type: 'direct_type1',
        }}
      />
    )
    const strip = screen.getByTestId('manual-strip')
    // No <button> elements inside the strip.
    expect(strip.querySelectorAll('button').length).toBe(0)
    // And no AUTO/MAN labels rendered as controls within the strip.
    expect(strip.querySelector('[aria-pressed]')).toBeNull()
  })
})
