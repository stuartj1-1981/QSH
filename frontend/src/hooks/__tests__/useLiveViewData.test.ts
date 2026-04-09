import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLiveViewData } from '../useLiveViewData'
import type { CycleMessage } from '../../types/api'

// Mock dependencies
const mockUseLive = vi.fn()
const mockUseSysid = vi.fn()

vi.mock('../useLive', () => ({
  useLive: () => mockUseLive(),
}))

vi.mock('../useSysid', () => ({
  useSysid: () => mockUseSysid(),
}))

function makeCycleMessage(overrides: Partial<CycleMessage> = {}): CycleMessage {
  return {
    type: 'cycle',
    status: {
      operating_state: 'Winter (Heating)',
      control_enabled: true,
      comfort_temp: 20,
      optimal_flow: 35,
      applied_flow: 35,
      optimal_mode: 'normal',
      applied_mode: 'normal',
      total_demand: 5,
      outdoor_temp: 5,
      recovery_time_hours: 0,
      capacity_pct: 50,
      hp_capacity_kw: 8,
      min_load_pct: 10,
      hp_power_kw: 4,
      hp_cop: 3.5,
      comfort_pct: 95,
    },
    hp: {
      flow_temp: 35,
      return_temp: 30,
      delta_t: 5,
      flow_rate: 0.2,
    },
    rooms: {
      lounge: { temp: 20.5, target: 21, valve: 80, occupancy: 'home', status: 'heating', facing: 180, area_m2: 25, ceiling_m: 2.4 },
      bed1: { temp: 19, target: 20, valve: 40, occupancy: 'away', status: 'ok', facing: 0, area_m2: 14, ceiling_m: 2.4 },
      kitchen: { temp: 21, target: 21, valve: 60, occupancy: 'home', status: 'ok', facing: 90, area_m2: 18, ceiling_m: 2.4 },
    },
    ...overrides,
  }
}

describe('useLiveViewData', () => {
  beforeEach(() => {
    mockUseLive.mockReturnValue({ data: null, isConnected: false, lastUpdate: 0 })
    mockUseSysid.mockReturnValue({ data: null, error: null })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hw_plan: 'W' }),
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null data when WebSocket has no data yet', () => {
    const { result } = renderHook(() => useLiveViewData())
    expect(result.current.data).toBeNull()
  })

  it('returns isConnected false when WebSocket disconnected', () => {
    const { result } = renderHook(() => useLiveViewData())
    expect(result.current.isConnected).toBe(false)
  })

  it('maps CycleMessage rooms to LiveViewRoom array', async () => {
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })

    const { result } = renderHook(() => useLiveViewData())

    expect(result.current.data).not.toBeNull()
    expect(result.current.data!.rooms).toHaveLength(3)

    const lounge = result.current.data!.rooms.find(r => r.id === 'lounge')!
    expect(lounge.name).toBe('lounge')
    expect(lounge.temp).toBe(20.5)
    expect(lounge.target).toBe(21)
    expect(lounge.valve).toBe(80)
    expect(lounge.area).toBe(25)
    expect(lounge.status).toBe('heating')
  })

  it('merges sysid U-values into room data', () => {
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({
      data: { rooms: { lounge: { u_kw_per_c: 0.22, c_kwh_per_c: 1, u_observations: 10, c_observations: 5, c_source: 'sysid', pc_fits: 3, solar_gain: 0, confidence: 'high' } } },
      error: null,
    })

    const { result } = renderHook(() => useLiveViewData())

    const lounge = result.current.data!.rooms.find(r => r.id === 'lounge')!
    expect(lounge.u).toBe(0.22)
  })

  it('uses fallback U-value when sysid not loaded', () => {
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    const lounge = result.current.data!.rooms.find(r => r.id === 'lounge')!
    expect(lounge.u).toBe(0.15)
  })

  it('fetches hw_plan from config on mount', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hw_plan: 'S' }),
    } as Response)
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    await waitFor(() => {
      expect(result.current.data!.dhw.hwPlan).toBe('S')
    })
  })

  it('defaults hw_plan to W when config fetch fails', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'))
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    // Even after fetch fails, default remains W
    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })
    expect(result.current.data!.dhw.hwPlan).toBe('W')
  })

  it('sets hasCylinder false for Combi plan', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hw_plan: 'Combi' }),
    } as Response)
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    await waitFor(() => {
      expect(result.current.data!.dhw.hasCylinder).toBe(false)
    })
  })

  it('sets hasCylinder true for W plan', () => {
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    expect(result.current.data!.dhw.hasCylinder).toBe(true)
  })

  it('parses operating_state into LiveViewState', () => {
    mockUseLive.mockReturnValue({
      data: makeCycleMessage({
        status: {
          operating_state: 'Winter (Equilibrium)',
          control_enabled: true, comfort_temp: 20, optimal_flow: 35, applied_flow: 35,
          optimal_mode: 'normal', applied_mode: 'normal', total_demand: 5, outdoor_temp: 5,
          recovery_time_hours: 0, capacity_pct: 50, hp_capacity_kw: 8, min_load_pct: 10,
          hp_power_kw: 4, hp_cop: 3.5, comfort_pct: 95,
        },
      }),
      isConnected: true,
      lastUpdate: Date.now(),
    })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    expect(result.current.data!.state.season).toBe('winter')
    expect(result.current.data!.state.strategy).toBe('equilibrium')
  })

  it('detects multi-source from source_selection presence', () => {
    mockUseLive.mockReturnValue({
      data: makeCycleMessage({
        source_selection: {
          active_source: 'gas_boiler',
          mode: 'auto',
          preference: 0,
          sources: [
            { name: 'gas_boiler', type: 'gas_boiler', status: 'active', efficiency: 0.9, fuel_cost_per_kwh: 0.05, cost_per_kwh_thermal: 0.06, carbon_per_kwh_thermal: 0.2, score: 80, signal_quality: 'good' },
          ],
          switch_count_today: 0,
          max_switches_per_day: 4,
          failover_active: false,
          last_switch_reason: '',
        },
      }),
      isConnected: true,
      lastUpdate: Date.now(),
    })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    expect(result.current.data!.source.isMultiSource).toBe(true)
    expect(result.current.data!.source.type).toBe('gas_boiler')
    expect(result.current.data!.source.name).toBe('gas_boiler')
  })

  it('detects single-source when source_selection is absent', () => {
    mockUseLive.mockReturnValue({ data: makeCycleMessage(), isConnected: true, lastUpdate: Date.now() })
    mockUseSysid.mockReturnValue({ data: null, error: null })

    const { result } = renderHook(() => useLiveViewData())

    expect(result.current.data!.source.isMultiSource).toBe(false)
    expect(result.current.data!.source.type).toBe('heat_pump')
  })
})
