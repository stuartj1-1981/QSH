/**
 * INSTRUCTION-597B T4 — the interface shows a ground-source heat pump (gshp)
 * as a heat pump. Cases 1-9 follow the T4 list of the instruction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, renderHook, waitFor } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import { SourceSelector } from '../SourceSelector'
import { Historian } from '../../pages/Historian'
import { useLiveViewData } from '../../hooks/useLiveViewData'
import { costLabelFor, sourceShortName } from '../../lib/sourceLabels'
import type {
  CycleMessage,
  HeatSourceState,
  SourceSelectionState,
  SourceState,
} from '../../types/api'

const mockUseLive = vi.fn()
const mockUseSysid = vi.fn()
const mockUseStatus = vi.fn()

vi.mock('../../hooks/useLive', () => ({
  useLive: () => mockUseLive(),
}))
vi.mock('../../hooks/useSysid', () => ({
  useSysid: () => mockUseSysid(),
}))
vi.mock('../../hooks/useStatus', () => ({
  useStatus: () => mockUseStatus(),
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

const baseProps = {
  operatingState: 'Winter (Heating)',
  controlEnabled: true,
  appliedFlow: 40,
  appliedMode: 'winter',
  outdoorTemp: 5,
}

function gshpSource(overrides: Partial<HeatSourceState> = {}): HeatSourceState {
  return {
    type: 'gshp',
    input_power_kw: 2.1,
    thermal_output_kw: 9.45,
    thermal_output_source: 'measured',
    performance: { value: 4.5, source: 'live' },
    flow_temp: 40,
    return_temp: 35,
    delta_t: 5,
    flow_rate: 0.4,
    ...overrides,
  }
}

function sourceState(overrides: Partial<SourceState> = {}): SourceState {
  return {
    name: 'Ground HP',
    type: 'gshp',
    status: 'active',
    efficiency: 4.5,
    fuel_cost_per_kwh: 0.245,
    cost_per_kwh_thermal: 0.054,
    carbon_per_kwh_thermal: 0.03,
    score: 0.05,
    signal_quality: 'good',
    ...overrides,
  } as SourceState
}

function selection(sources: SourceState[], active: string): SourceSelectionState {
  return {
    active_source: active,
    mode: 'auto',
    preference: 0.7,
    sources,
    switch_count_today: 0,
    max_switches_per_day: 6,
    failover_active: false,
    last_switch_reason: 'cost',
    reason: 'cost',
    detail: '',
    blocked_switches: [],
  }
}

function cycle(heatSource: HeatSourceState, sourceSelection?: SourceSelectionState): CycleMessage {
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
      heat_source: heatSource,
      comfort_pct: 95,
    },
    hp: { power_kw: 2.1, cop: 4.5, flow_temp: 40, return_temp: 35, delta_t: 5, flow_rate: 0.4 },
    rooms: {
      lounge: { temp: 20.5, target: 21, valve: 80, occupancy: 'home', status: 'heating', facing: 180, area_m2: 25, ceiling_m: 2.4 },
    },
    ...(sourceSelection ? { source_selection: sourceSelection } : {}),
  } as CycleMessage
}

describe('INSTRUCTION-597B — a gshp shows as a heat pump', () => {
  beforeEach(() => {
    mockUseLive.mockReturnValue({ data: null, isConnected: false, lastUpdate: 0 })
    mockUseSysid.mockReturnValue({ data: null, error: null })
    mockUseStatus.mockReturnValue({ data: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Case 1 — fails before T1.
  it('1. StatusBanner shows the heat-pump icon and the COP label for a gshp', () => {
    const { container } = render(<StatusBanner {...baseProps} heatSource={gshpSource()} />)
    expect(container.querySelector('.lucide-zap')).not.toBeNull()
    expect(container.querySelector('.lucide-flame')).toBeNull()
    expect(screen.getByText(/COP 4\.5/)).toBeDefined()
  })

  // Case 2 — fails before T3.
  it('2. the cost label and short name of a gshp are the heat-pump ones', () => {
    expect(costLabelFor('gshp', 1)).toBe('HP cost today')
    expect(sourceShortName('gshp')).toBe('HP')
  })

  // Case 3 — fails before T3.
  it('3. SourceSelector shows the COP chip for a gshp', () => {
    const state = selection([sourceState()], 'Ground HP')
    render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />,
    )
    expect(screen.getByText(/COP 4\.5/)).toBeDefined()
  })

  // Case 4 — fails before T2.
  it('4. useLiveViewData gives a non-zero COP for a gshp with a live performance', () => {
    mockUseLive.mockReturnValue({ data: cycle(gshpSource()), isConnected: true, lastUpdate: Date.now() })
    const { result } = renderHook(() => useLiveViewData())
    expect(result.current.data!.hp.cop).toBe(4.5)
  })

  // Case 5 — the first part fails before T2.
  it('5. the Live View source type is gshp on a multi-source install, heat_pump on a single source', () => {
    const multi = selection([sourceState()], 'Ground HP')
    mockUseLive.mockReturnValue({ data: cycle(gshpSource(), multi), isConnected: true, lastUpdate: Date.now() })
    const first = renderHook(() => useLiveViewData())
    expect(first.result.current.data!.source.type).toBe('gshp')
    expect(first.result.current.data!.source.isMultiSource).toBe(true)

    mockUseLive.mockReturnValue({ data: cycle(gshpSource()), isConnected: true, lastUpdate: Date.now() })
    const second = renderHook(() => useLiveViewData())
    expect(second.result.current.data!.source.type).toBe('heat_pump')
    expect(second.result.current.data!.source.isMultiSource).toBe(false)
  })

  // Case 6 — the first part fails before T3.
  it('6. the Historian field list keeps hp_power_kw and cop for a gshp and hides them for a gas_boiler', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString()
      let body: unknown = { available: true, measurements: [], fields: [], tags: {} }
      if (url.includes('api/historian/measurements')) {
        body = { available: true, measurements: [{ name: 'qsh_system', fields: ['outdoor_temp'] }] }
      } else if (url.includes('api/historian/fields')) {
        body = {
          available: true,
          fields: ['outdoor_temp', 'hp_power_kw', 'cop'],
          field_types: { outdoor_temp: 'numeric', hp_power_kw: 'numeric', cop: 'numeric' },
        }
      } else if (url.includes('api/historian/tags')) {
        body = { available: true, tags: {} }
      }
      return Promise.resolve({ ok: true, json: async () => body } as Response)
    })

    mockUseStatus.mockReturnValue({ data: { heat_source: { type: 'gshp' } } })
    const gshp = render(<Historian />)
    await waitFor(() => expect(screen.getByText('outdoor_temp')).toBeDefined())
    expect(screen.getByText(/hp_power_kw/)).toBeDefined()
    expect(screen.getByText(/^cop/)).toBeDefined()
    gshp.unmount()

    mockUseStatus.mockReturnValue({ data: { heat_source: { type: 'gas_boiler' } } })
    render(<Historian />)
    await waitFor(() => expect(screen.getByText('outdoor_temp')).toBeDefined())
    expect(screen.queryByText(/hp_power_kw/)).toBeNull()
    expect(screen.queryByText(/^cop/)).toBeNull()
  })

  // Case 7 — a regression pin; passes before T1.
  it('7. the readback alarm of a gshp shows the generic advice, not Octopus', () => {
    render(
      <StatusBanner
        {...baseProps}
        heatSource={gshpSource()}
        readbackMismatchCount={5}
        readbackMismatchThreshold={5}
      />,
    )
    const alarm = screen.getByTestId('readback-mismatch-alarm')
    expect(alarm.textContent).not.toMatch(/Octopus/)
    expect(alarm.textContent).toMatch(/Check the heat source/)
  })

  // Case 8 — fails before T3.
  it('8. the readback alarm of a gshp names HP', () => {
    render(
      <StatusBanner
        {...baseProps}
        heatSource={gshpSource()}
        readbackMismatchCount={5}
        readbackMismatchThreshold={5}
      />,
    )
    expect(screen.getByTestId('readback-mismatch-alarm').textContent).toMatch(/HP not responding/)
  })

  // Case 9 — fails before T3.
  it('9. the source card of a gshp uses the lightning icon', () => {
    const state = selection([sourceState()], 'Ground HP')
    const { container } = render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />,
    )
    expect(container.querySelector('.lucide-zap')).not.toBeNull()
    expect(container.querySelector('.lucide-flame')).toBeNull()
  })
})
