/**
 * INSTRUCTION-257 — Home page effective-comfort divergence sub-line tests.
 *
 * The divergence sub-line renders beneath the "At Comfort" badge ONLY when:
 *   1. The global comfort schedule is active.
 *   2. The snapshot carries a non-null comfort_temp_effective.
 *   3. rooms_overridden_count is > 0.
 *
 * Otherwise (schedule inactive, legacy snapshot without the new fields, or
 * count == 0), the sub-line is suppressed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from '../Home'
import type { CycleMessage } from '../../types/api'
import type { QshConfigYaml } from '../../types/config'

// Mock all the hooks used by Home — mirrors the pattern in Home.test.tsx.
let mockLiveData: CycleMessage | null = null
vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: mockLiveData, isConnected: false }),
}))

let mockStatusData: Record<string, unknown> | null = null
vi.mock('../../hooks/useStatus', () => ({
  useStatus: () => ({ data: mockStatusData, error: null }),
}))

vi.mock('../../hooks/useVersion', () => ({
  useVersion: () => ({ version: '1.4.4', loading: false }),
}))

vi.mock('../../hooks/useHistory', () => ({
  useHistory: () => ({ data: [] }),
}))

vi.mock('../../hooks/useAway', () => ({
  useAwayState: () => ({ data: null, refetch: vi.fn() }),
  useSetAway: () => ({ setAway: vi.fn() }),
}))

vi.mock('../../hooks/useSourceSelection', () => ({
  useSourceSelection: () => ({ data: null, setMode: vi.fn(), setPreference: vi.fn() }),
}))

let mockRawConfigData: QshConfigYaml | null = null
vi.mock('../../hooks/useConfig', () => ({
  useRawConfig: () => ({ data: mockRawConfigData, refetch: vi.fn() }),
}))

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
}))


/** Build a minimal CycleMessage with the per-cycle status block populated.
 *  Per-room state is fabricated to size `roomCount`; values are immaterial. */
function makeLiveData(opts: {
  comfortScheduleActive: boolean
  comfortTempActive: number
  comfortTempEffective: number
  roomsOverriddenCount: number
  roomCount: number
}): CycleMessage {
  const rooms: Record<string, { temp: number; target: number; valve: number; occupancy: string; status: string; facing: number }> = {}
  for (let i = 0; i < opts.roomCount; i++) {
    rooms[`room_${i}`] = {
      temp: 20.0,
      target: 20.0,
      valve: 50,
      occupancy: 'occupied',
      status: 'ok',
      facing: 0,
    }
  }
  return {
    type: 'cycle',
    cycle_number: 1,
    status: {
      operating_state: 'Heat',
      control_enabled: true,
      comfort_temp: 20.0,
      comfort_schedule_active: opts.comfortScheduleActive,
      comfort_temp_active: opts.comfortTempActive,
      comfort_temp_effective: opts.comfortTempEffective,
      rooms_overridden_count: opts.roomsOverriddenCount,
      optimal_flow: 35,
      applied_flow: 35,
      optimal_mode: 'heat',
      applied_mode: 'heat',
      total_demand: 1.0,
      outdoor_temp: 5.0,
      recovery_time_hours: 0,
      capacity_pct: 50,
      hp_capacity_kw: 6,
      min_load_pct: 30,
      // The component only reads the fields it knows about; the rest can
      // be undefined for a divergence-rendering test.
    } as unknown as CycleMessage['status'],
    rooms,
  } as unknown as CycleMessage
}


describe('Home effective-comfort divergence sub-line (INSTRUCTION-257)', () => {
  afterEach(() => {
    mockStatusData = null
    mockLiveData = null
    mockRawConfigData = null
  })

  it('renders the divergence sub-line when schedule active, count > 0, effective diverges from active', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 25.0,
      comfortTempEffective: 19.6,
      roomsOverriddenCount: 11,
      roomCount: 13,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-divergence-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('Effective')
    expect(line.textContent).toContain('19.6°')
    expect(line.textContent).toContain('11 of 13 rooms overridden')
  })

  it('suppresses the divergence sub-line when rooms_overridden_count is 0', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 25.0,
      comfortTempEffective: 24.9,
      roomsOverriddenCount: 0,
      roomCount: 13,
    })
    render(<Home engineering={false} />)

    expect(screen.queryByTestId('comfort-divergence-line')).toBeNull()
  })

  it('suppresses the divergence sub-line when the comfort schedule is not active', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: false,
      comfortTempActive: 20.0,
      comfortTempEffective: 20.0,
      roomsOverriddenCount: 0,
      roomCount: 13,
    })
    render(<Home engineering={false} />)

    expect(screen.queryByTestId('comfort-divergence-line')).toBeNull()
  })

  it('handles legacy snapshots without the new fields gracefully', () => {
    // Pre-INSTRUCTION-257 snapshot: schedule_active present, but
    // comfort_temp_effective and rooms_overridden_count omitted.
    mockLiveData = {
      type: 'cycle',
      cycle_number: 1,
      status: {
        operating_state: 'Heat',
        control_enabled: true,
        comfort_temp: 20.0,
        comfort_schedule_active: true,
        comfort_temp_active: 25.0,
        optimal_flow: 35,
        applied_flow: 35,
        optimal_mode: 'heat',
        applied_mode: 'heat',
        total_demand: 1.0,
        outdoor_temp: 5.0,
        recovery_time_hours: 0,
        capacity_pct: 50,
        hp_capacity_kw: 6,
        min_load_pct: 30,
      } as unknown as CycleMessage['status'],
      rooms: {},
    } as unknown as CycleMessage

    expect(() => render(<Home engineering={false} />)).not.toThrow()
    expect(screen.queryByTestId('comfort-divergence-line')).toBeNull()
  })

  it('renders the sub-line for a partial override (count between 0 and total)', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 25.0,
      comfortTempEffective: 22.5,
      roomsOverriddenCount: 5,
      roomCount: 10,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-divergence-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('22.5°')
    expect(line.textContent).toContain('5 of 10 rooms overridden')
  })
})
