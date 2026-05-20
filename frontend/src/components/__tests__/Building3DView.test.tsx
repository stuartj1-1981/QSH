import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createRef } from 'react'
import { Building3DView } from '../Building3DView'
import type { BuildingEngine } from '../../lib/buildingEngine'
import type { CycleMessage } from '../../types/api'
import { MOCK_ROOMS } from '../../hooks/__tests__/fixtures/buildingFixtures'

type EngineMock = {
  setLayout: ReturnType<typeof vi.fn>
  setData: ReturnType<typeof vi.fn>
  setView: ReturnType<typeof vi.fn>
  setDark: ReturnType<typeof vi.fn>
  onRoomSelect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function createEngineMock(): EngineMock {
  return {
    setLayout: vi.fn(),
    setData: vi.fn(),
    setView: vi.fn(),
    setDark: vi.fn(),
    onRoomSelect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }
}

const MOCK_LAYOUT = {
  rooms: {
    lounge: { x: 0, z: 0, w: 5, d: 4, floor: 0, col: 0, row: 0 },
    kitchen: { x: 5, z: 0, w: 4, d: 4, floor: 0, col: 1, row: 0 },
  },
  centroid: { x: 4.5, z: 2 },
  buildingWidth: 9,
  floorCount: 1,
  log: [],
}

const MOCK_LAYOUT_ROOMS = {
  lounge: MOCK_ROOMS.lounge && MOCK_ROOMS.lounge.envelope
    ? {
        area_m2: MOCK_ROOMS.lounge.area_m2,
        ceiling_m: MOCK_ROOMS.lounge.ceiling_m ?? 2.4,
        floor: MOCK_ROOMS.lounge.floor ?? 0,
        envelope: MOCK_ROOMS.lounge.envelope,
      }
    : undefined,
  kitchen: MOCK_ROOMS.kitchen && MOCK_ROOMS.kitchen.envelope
    ? {
        area_m2: MOCK_ROOMS.kitchen.area_m2,
        ceiling_m: MOCK_ROOMS.kitchen.ceiling_m ?? 2.4,
        floor: MOCK_ROOMS.kitchen.floor ?? 0,
        envelope: MOCK_ROOMS.kitchen.envelope,
      }
    : undefined,
}

const mockUseBuildingLayout = vi.fn()
vi.mock('../../hooks/useBuildingLayout', () => ({
  useBuildingLayout: () => mockUseBuildingLayout(),
}))

const mockUseLive = vi.fn()
vi.mock('../../hooks/useLive', () => ({
  useLive: () => mockUseLive(),
  // INSTRUCTION-250: Building3DView now subscribes to useLiveData() rather
  // than useLive(). Project mockUseLive's return shape onto the split hook
  // so existing test fixtures continue to drive the same data path.
  useLiveData: () => {
    const r = mockUseLive()
    return { data: r.data, lastUpdate: r.lastUpdate }
  },
  useLiveConnection: () => {
    const r = mockUseLive()
    return {
      isConnected: r.isConnected,
      disconnectedSince: r.disconnectedSince ?? null,
    }
  },
}))

describe('Building3DView', () => {
  beforeEach(() => {
    mockUseBuildingLayout.mockReturnValue({
      layout: MOCK_LAYOUT,
      rooms: MOCK_ROOMS,
      layoutRooms: MOCK_LAYOUT_ROOMS,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: true,
    })
    mockUseLive.mockReturnValue({ data: null, isConnected: true, lastUpdate: 0 })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders all 4 view mode buttons', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine
    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)
    expect(screen.getByRole('button', { name: '3D' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exploded' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thermal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Envelope' })).toBeInTheDocument()
  })

  it('shows summary panel with "Click a room to inspect" when no room is selected', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine
    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)
    expect(screen.getByText('Click a room to inspect')).toBeInTheDocument()
  })

  it('calls engine.setData with converted BuildingLiveData when live data arrives', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine

    const cycleMsg: CycleMessage = {
      type: 'cycle',
      timestamp: 1234567890,
      cycle_number: 42,
      status: {
        operating_state: 'winter',
        control_enabled: true,
        comfort_temp: 20,
        optimal_flow: 35,
        applied_flow: 35,
        optimal_mode: 'heating',
        applied_mode: 'heating',
        total_demand: 4.2,
        outdoor_temp: 5,
        recovery_time_hours: 2,
        capacity_pct: 50,
        hp_capacity_kw: 8,
        min_load_pct: 20,
        heat_source: {
          type: 'heat_pump',
          input_power_kw: 4.2,
          thermal_output_kw: 14.7,
          thermal_output_source: 'measured',
          performance: { value: 3.5, source: 'live' },
          flow_temp: 35,
          return_temp: 30,
          delta_t: 5,
          flow_rate: 12,
        },
        comfort_pct: 95,
      },
      hp: {
        power_kw: 4.2,
        cop: 3.5,
        flow_temp: 35,
        return_temp: 30,
        delta_t: 5,
        flow_rate: 12,
      },
      rooms: {
        lounge: {
          temp: 20.5, target: 21, valve: 60, occupancy: 'occupied',
          status: 'heating', facing: 'S', area_m2: 20, ceiling_m: 2.5,
        },
        kitchen: {
          temp: 19.0, target: 20, valve: 40, occupancy: 'occupied',
          status: 'heating', facing: 'N', area_m2: 16, ceiling_m: 2.5,
        },
      },
    }
    mockUseLive.mockReturnValue({ data: cycleMsg, isConnected: true, lastUpdate: 1 })

    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)

    expect(engine.setData).toHaveBeenCalledTimes(1)
    const arg = engine.setData.mock.calls[0][0]
    expect(arg.rooms.lounge).toEqual({
      temp: 20.5, target: 21, valve: 60, status: 'heating',
    })
    expect(arg.rooms.kitchen.temp).toBe(19.0)
    expect(arg.system.flow_temp).toBe(35)
    expect(arg.system.outdoor_temp).toBe(5)
    expect(arg.system.power_kw).toBe(4.2)
    // INSTRUCTION-232: live-HP branch of the performance provenance gate.
    expect(arg.system.cop).toBe(3.5)
    expect(arg.cycle_number).toBe(42)
  })

  // INSTRUCTION-232: performance provenance gate.
  // Mirrors the live/config/boiler tests in useLiveViewData.test.ts.
  // Pins that `cycleToBuildingLive` only surfaces system.cop when the
  // resolver marks `performance.source` as `'live'` AND the heat
  // source is a heat pump. `BuildingLiveData.system.cop` is currently
  // unread by `buildingEngine.ts`, but the field is on the type
  // contract — the producer-side gate prevents any future consumer
  // (debug overlay, new dashboard tile) from inheriting the
  // caps-baseline-as-COP defect.

  it('suppresses system.cop (= 0) when heat-pump performance.source is "config"', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine

    const cycleMsg: CycleMessage = {
      type: 'cycle',
      timestamp: 1234567890,
      cycle_number: 43,
      status: {
        operating_state: 'winter',
        control_enabled: true,
        comfort_temp: 20,
        optimal_flow: 35,
        applied_flow: 35,
        optimal_mode: 'heating',
        applied_mode: 'heating',
        total_demand: 0,
        outdoor_temp: 5,
        recovery_time_hours: 0,
        capacity_pct: 0,
        hp_capacity_kw: 8,
        min_load_pct: 20,
        heat_source: {
          type: 'heat_pump',
          input_power_kw: 0,
          thermal_output_kw: 0,
          thermal_output_source: 'measured',
          // HP off → resolver emits caps baseline (2.5) tagged 'config'.
          performance: { value: 2.5, source: 'config' },
          flow_temp: 25,
          return_temp: 25,
          delta_t: 0,
          flow_rate: 0,
        },
        comfort_pct: 95,
      },
      hp: {
        power_kw: 0,
        cop: null,
        flow_temp: 25,
        return_temp: 25,
        delta_t: 0,
        flow_rate: 0,
      },
      rooms: {
        lounge: {
          temp: 20.5, target: 21, valve: 0, occupancy: 'occupied',
          status: 'ok', facing: 'S', area_m2: 20, ceiling_m: 2.5,
        },
      },
    }
    mockUseLive.mockReturnValue({ data: cycleMsg, isConnected: true, lastUpdate: 1 })

    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)

    const arg = engine.setData.mock.calls[0][0]
    expect(arg.system.cop).toBe(0)
  })

  it('suppresses system.cop (= 0) for boiler with performance.source "config"', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine

    const cycleMsg: CycleMessage = {
      type: 'cycle',
      timestamp: 1234567890,
      cycle_number: 44,
      status: {
        operating_state: 'winter',
        control_enabled: true,
        comfort_temp: 20,
        optimal_flow: 60,
        applied_flow: 60,
        optimal_mode: 'heating',
        applied_mode: 'heating',
        total_demand: 5,
        outdoor_temp: 5,
        recovery_time_hours: 0,
        capacity_pct: 50,
        hp_capacity_kw: 8,
        min_load_pct: 20,
        heat_source: {
          type: 'gas_boiler',
          input_power_kw: 18,
          thermal_output_kw: 16.2,
          thermal_output_source: 'computed',
          // Boiler η is always config-sourced per resolver contract.
          performance: { value: 0.9, source: 'config' },
          flow_temp: 60,
          return_temp: 50,
          delta_t: 10,
          flow_rate: 0.4,
        },
        comfort_pct: 95,
      },
      hp: {
        power_kw: 0,
        cop: null,
        flow_temp: 60,
        return_temp: 50,
        delta_t: 10,
        flow_rate: 0.4,
      },
      rooms: {
        lounge: {
          temp: 20.5, target: 21, valve: 60, occupancy: 'occupied',
          status: 'heating', facing: 'S', area_m2: 20, ceiling_m: 2.5,
        },
      },
    }
    mockUseLive.mockReturnValue({ data: cycleMsg, isConnected: true, lastUpdate: 1 })

    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)

    const arg = engine.setData.mock.calls[0][0]
    expect(arg.system.cop).toBe(0)
  })

  it('calls engine.setLayout with (layout, layoutRooms) when layout resolves', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine
    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)
    expect(engine.setLayout).toHaveBeenCalledTimes(1)
    expect(engine.setLayout).toHaveBeenCalledWith(MOCK_LAYOUT, MOCK_LAYOUT_ROOMS)
  })

  it('calls engine.setView("thermal") when the Thermal button is clicked', () => {
    const engine = createEngineMock()
    const ref = createRef<BuildingEngine | null>()
    ;(ref as { current: EngineMock | null }).current = engine
    render(<Building3DView engineRef={ref as unknown as React.RefObject<BuildingEngine | null>} />)
    engine.setView.mockClear()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Thermal' }))
    })
    expect(engine.setView).toHaveBeenCalledWith('thermal')
  })
})
