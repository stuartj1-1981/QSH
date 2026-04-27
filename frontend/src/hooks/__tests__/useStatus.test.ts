import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStatus } from '../useStatus'

// useStatus returns { data: StatusResponse | null, error: string | null }
// (data-wrapper pattern, confirmed by inspecting useStatus.ts).

const MOCK_STATUS = {
  timestamp: 1745236800,
  cycle_number: 42,
  operating_state: 'Heating',
  control_enabled: true,
  comfort_temp: 21.0,
  optimal_flow: 38.0,
  applied_flow: 37.5,
  optimal_mode: 'heat',
  applied_mode: 'heat',
  total_demand: 4.2,
  outdoor_temp: 3.5,
  recovery_time_hours: 1.5,
  capacity_pct: 60.0,
  hp_capacity_kw: 6.0,
  min_load_pct: 30.0,
  heat_source: {
    type: 'heat_pump',
    input_power_kw: 2.1,
    thermal_output_kw: 8.0,
    thermal_output_source: 'measured',
    performance: { value: 3.8, source: 'live' },
    flow_temp: 38.0,
    return_temp: 33.0,
    delta_t: 5.0,
    flow_rate: 0.38,
  },
  hp: {
    power_kw: 2.1,
    cop: 3.8,
    flow_temp: 38.0,
    return_temp: 33.0,
    delta_t: 5.0,
    flow_rate: 0.38,
  },
  rooms_total: 0,
  rooms_below_target: 0,
  comfort_pct: 100,
  energy: { current_rate: 0.245, cost_today_pence: 0, energy_today_kwh: 0 },
  away: { active: false, days: 0 },
  engineering: {
    det_flow: 0,
    rl_flow: null,
    rl_blend: 0,
    rl_reward: 0,
    shoulder_monitoring: false,
    summer_monitoring: false,
  },
  setup_mode: true,
}

describe('useStatus — INSTRUCTION-135 setup_mode propagation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns setup_mode field when present in response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_STATUS,
    } as Response)

    const { result } = renderHook(() => useStatus())

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    expect(result.current.data?.setup_mode).toBe(true)
    expect(result.current.error).toBeNull()
  })
})
