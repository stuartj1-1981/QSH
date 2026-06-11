import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Schedule } from '../Schedule'

const EMPTY_WEEK = {
  monday: [], tuesday: [], wednesday: [], thursday: [],
  friday: [], saturday: [], sunday: [],
}

const COMFORT_SCHEDULE_EMPTY = {
  enabled: false,
  periods: [],
  active_temp: null,
}

function makeMockResponse(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    rooms: {
      lounge: {
        enabled: true,
        schedule: EMPTY_WEEK,
        current_state: 'occupied',
        has_occupancy_sensor: false,
        occupancy_sensor_entity: null,
        ...overrides.lounge,
      },
    },
  }
}

function mockFetchForSchedule(
  overrides: Record<string, Record<string, unknown>> = {},
  health: Record<string, unknown> | null = null
) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('comfort-schedule')) {
      return { ok: true, json: async () => COMFORT_SCHEDULE_EMPTY } as Response
    }
    if (url.includes('api/health')) {
      // INSTRUCTION-327 — caption renders nothing when health lacks the
      // timezone fields (older backend / fetch failure).
      return { ok: true, json: async () => health ?? {} } as Response
    }
    return { ok: true, json: async () => makeMockResponse(overrides) } as Response
  })
}

describe('Schedule stale schedule warning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows warning when has_occupancy_sensor is false AND enabled is false', async () => {
    mockFetchForSchedule({ lounge: { has_occupancy_sensor: false, enabled: false } })

    render(<Schedule />)

    await waitFor(() => {
      expect(screen.getByText(/has no occupancy sensor and the schedule is currently disabled/)).toBeInTheDocument()
    })
  })

  it('does not show warning when has_occupancy_sensor is true', async () => {
    mockFetchForSchedule({ lounge: { has_occupancy_sensor: true, enabled: false } })

    render(<Schedule />)

    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument()
    })
    expect(screen.queryByText(/has no occupancy sensor and the schedule is currently disabled/)).toBeNull()
  })

  it('does not show warning when has_occupancy_sensor is false but enabled is true', async () => {
    mockFetchForSchedule({ lounge: { has_occupancy_sensor: false, enabled: true } })

    render(<Schedule />)

    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument()
    })
    expect(screen.queryByText(/has no occupancy sensor and the schedule is currently disabled/)).toBeNull()
  })

  it('shows correct room name in warning', async () => {
    mockFetchForSchedule({ lounge: { has_occupancy_sensor: false, enabled: false } })

    render(<Schedule />)

    await waitFor(() => {
      expect(screen.getByText('lounge')).toBeInTheDocument()
    })
  })
})

// INSTRUCTION-327 — backend-resolved timezone caption near the occupancy grid.
describe('Schedule timezone caption', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the resolved zone and source from /api/health', async () => {
    mockFetchForSchedule({}, {
      local_timezone: 'Europe/London',
      local_timezone_source: 'config',
    })

    render(<Schedule />)

    await waitFor(() => {
      expect(
        screen.getByText(/Schedule timezone: Europe\/London \(config\)/)
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/Schedules are evaluating in UTC/)).toBeNull()
  })

  it('shows the amber UTC-fallback hint iff source is default', async () => {
    mockFetchForSchedule({}, {
      local_timezone: 'UTC',
      local_timezone_source: 'default',
    })

    render(<Schedule />)

    await waitFor(() => {
      expect(screen.getByText(/Schedules are evaluating in UTC/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Schedule timezone: UTC \(default\)/)).toBeInTheDocument()
  })

  it('renders nothing when health lacks the timezone fields', async () => {
    mockFetchForSchedule({}, null)

    render(<Schedule />)

    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Schedule timezone:/)).toBeNull()
  })
})
