/**
 * INSTRUCTION-265 — Home page schedule diagnostic sub-line tests.
 *
 * The sub-line under the comfort-temp control is always rendered. The label
 * varies across four states:
 *   1. Schedule active + divergence:    "Schedule: X° · Effective Y° (N of M rooms overridden)"
 *   2. Schedule active + convergence:   "Schedule: X° — all rooms at target"
 *   3. No schedule + divergence:        "No schedule active — Comfort X° · Effective Y° (N of M rooms overridden)"
 *   4. No schedule + convergence:       "No schedule active — Comfort X°"
 *
 * A `title` attribute carrying the override-origin tooltip is set only when
 * divergence is present (states 1 and 3). Legacy snapshots lacking
 * comfort_temp_effective collapse into the no-divergence branch (test 5).
 *
 * Supersedes Home.divergence.test.tsx (INSTRUCTION-257), which targeted the
 * old divergence-only render gate that was dropped per INSTRUCTION-265 §1.3
 * (the comfortTempActive hydration chain terminates at literal 21.0, so the
 * divergence-only gate was permanently true).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from '../Home'
import type { CycleMessage } from '../../types/api'
import type { QshConfigYaml } from '../../types/config'

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
  useConfig: () => ({ data: null, refetch: vi.fn() }),
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
  comfortTempEffective: number | null
  roomsOverriddenCount: number
  roomCount: number
  targetTempFallbackActive?: boolean
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
      target_temp_fallback_active: opts.targetTempFallbackActive ?? false,
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
    rooms,
  } as unknown as CycleMessage
}


describe('Home schedule diagnostic sub-line (INSTRUCTION-265)', () => {
  afterEach(() => {
    mockStatusData = null
    mockLiveData = null
    mockRawConfigData = null
  })

  it('renders schedule active with divergence — shows commanded and effective', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 25,
      comfortTempEffective: 19.8,
      roomsOverriddenCount: 14,
      roomCount: 14,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('Schedule:')
    expect(line.textContent).toContain('25.0°')
    expect(line.textContent).toContain('Effective')
    expect(line.textContent).toContain('19.8°')
    expect(line.textContent).toContain('14 of 14 rooms overridden')
    expect(line.getAttribute('title')).toContain('Per-room overrides')
  })

  it('renders schedule active with convergence — shows all-rooms-at-target', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 21,
      comfortTempEffective: 21,
      roomsOverriddenCount: 0,
      roomCount: 14,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('Schedule:')
    expect(line.textContent).toContain('21.0°')
    expect(line.textContent).toContain('all rooms at target')
    expect(line.textContent).not.toContain('Effective')
    expect(line.getAttribute('title')).toBeNull()
  })

  it('renders no schedule active with divergence — shows static comfort and effective', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: false,
      comfortTempActive: 20,
      comfortTempEffective: 19.8,
      roomsOverriddenCount: 5,
      roomCount: 14,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('No schedule active')
    expect(line.textContent).toContain('Comfort')
    expect(line.textContent).toContain('20.0°')
    expect(line.textContent).toContain('Effective')
    expect(line.textContent).toContain('19.8°')
    expect(line.textContent).toContain('5 of 14 rooms overridden')
    expect(line.getAttribute('title')).toContain('Per-room overrides')
  })

  it('renders no schedule active without divergence — shows static comfort only', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: false,
      comfortTempActive: 20,
      comfortTempEffective: null,
      roomsOverriddenCount: 0,
      roomCount: 14,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('No schedule active')
    expect(line.textContent).toContain('Comfort')
    expect(line.textContent).toContain('20.0°')
    expect(line.textContent).not.toContain('Effective')
    expect(line.textContent).not.toContain('overridden')
    expect(line.getAttribute('title')).toBeNull()
  })

  it('renders schedule active with legacy snapshot (comfortTempEffective null) — collapses to all-rooms-at-target', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 22,
      comfortTempEffective: null,
      roomsOverriddenCount: 0,
      roomCount: 14,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line).toBeInTheDocument()
    expect(line.textContent).toContain('Schedule:')
    expect(line.textContent).toContain('22.0°')
    expect(line.textContent).toContain('all rooms at target')
    expect(line.textContent).not.toContain('Effective')
    expect(line.getAttribute('title')).toBeNull()
  })

  it('renders fallback-active branch — shows "No comfort temperature set" regardless of schedule state', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 20,
      comfortTempEffective: null,
      roomsOverriddenCount: 0,
      roomCount: 1,
      targetTempFallbackActive: true,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line.textContent).toContain('No comfort temperature set — using default 20.0°')
    expect(line.textContent).toContain('Set it via the Comfort stepper')
    expect(line.getAttribute('title')).toContain('upstream driver path')
  })

  it('fallback-active overrides divergence — divergence sub-line never appears when fallback active', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: false,
      comfortTempActive: 20,
      comfortTempEffective: 18,
      roomsOverriddenCount: 3,
      roomCount: 5,
      targetTempFallbackActive: true,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    expect(line.textContent).not.toContain('Effective')
    expect(line.textContent).toContain('No comfort temperature set')
  })

  it('tooltip cause list — divergence tooltip names all seven override classes', () => {
    mockLiveData = makeLiveData({
      comfortScheduleActive: true,
      comfortTempActive: 25,
      comfortTempEffective: 19.8,
      roomsOverriddenCount: 14,
      roomCount: 14,
      targetTempFallbackActive: false,
    })
    render(<Home engineering={false} />)

    const line = screen.getByTestId('comfort-status-line')
    const title = line.getAttribute('title')
    expect(title).toContain('Cached MQTT')
    expect(title).toContain('Persistent-zone')
    expect(title).toContain('Away mode')
    expect(title).toContain('Occupancy-schedule setback')
    expect(title).toContain('Away-exit recovery ramp')
    expect(title).toContain('fixed_setpoints')
    expect(title).toContain('Sensor-driven setback')
  })
})
