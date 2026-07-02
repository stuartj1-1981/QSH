import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SourceSelector } from '../SourceSelector'
import type { SourceSelectionState } from '../../types/api'

function makeState(overrides?: Partial<SourceSelectionState>): SourceSelectionState {
  return {
    active_source: 'Samsung HP',
    mode: 'auto',
    preference: 0.7,
    sources: [
      {
        name: 'Samsung HP',
        type: 'heat_pump',
        status: 'active',
        efficiency: 3.8,
        fuel_cost_per_kwh: 0.245,
        cost_per_kwh_thermal: 0.064,
        carbon_per_kwh_thermal: 0.036,
        score: 0.055,
        signal_quality: 'good',
      },
      {
        name: 'Glowworm LPG',
        type: 'lpg_boiler',
        status: 'standby',
        efficiency: 0.89,
        fuel_cost_per_kwh: 0.065,
        cost_per_kwh_thermal: 0.073,
        carbon_per_kwh_thermal: 0.236,
        score: 0.068,
        signal_quality: 'good',
      },
    ],
    switch_count_today: 2,
    max_switches_per_day: 6,
    failover_active: false,
    last_switch_reason: 'cost',
    // 228B Task 1: new required fields on SourceSelectionPayload base.
    reason: 'cost',
    detail: '',
    blocked_switches: [],
    ...overrides,
  }
}

describe('SourceSelector', () => {
  it('renders mode selector with source names', () => {
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    // Source names appear in both mode buttons and source cards
    expect(screen.getAllByText('Samsung HP').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Glowworm LPG').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Auto')).toBeDefined()
  })

  it('highlights active source card', () => {
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText('Active')).toBeDefined()
  })

  it('shows standby status for inactive source', () => {
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText('Standby')).toBeDefined()
  })

  it('shows failover banner when failover_active is true', () => {
    const state = makeState({
      failover_active: true,
      sources: [
        { ...makeState().sources[0], status: 'active' },
        { ...makeState().sources[1], status: 'offline', signal_quality: 'unavailable' },
      ],
    })
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText(/Failover active/)).toBeDefined()
  })

  it('shows preference slider in auto mode', () => {
    const state = makeState({ mode: 'auto' })
    const { container } = render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />
    )
    const slider = container.querySelector('input[type="range"]')
    expect(slider).not.toBeNull()
  })

  it('hides preference slider in manual mode', () => {
    const state = makeState({ mode: 'Samsung HP' })
    const { container } = render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />
    )
    const slider = container.querySelector('input[type="range"]')
    expect(slider).toBeNull()
  })

  it('calls onModeChange when mode button clicked', () => {
    const onModeChange = vi.fn()
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={onModeChange} onPreferenceChange={vi.fn()} />)
    // Click the first instance (mode button) of the source name
    const buttons = screen.getAllByText('Glowworm LPG')
    fireEvent.click(buttons[0])
    expect(onModeChange).toHaveBeenCalledWith('Glowworm LPG')
  })

  it('displays switch count correctly', () => {
    const state = makeState({ switch_count_today: 3, max_switches_per_day: 6 })
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText('Switches today: 3/6')).toBeDefined()
  })

  it('shows offline status with appropriate indicator', () => {
    const state = makeState({
      sources: [
        { ...makeState().sources[0] },
        { ...makeState().sources[1], status: 'offline' },
      ],
    })
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText('Offline')).toBeDefined()
  })

  it('formats thermal (heat) cost to 3 decimal places', () => {
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText('£0.064/kWh heat')).toBeDefined()
    expect(screen.getByText('£0.073/kWh heat')).toBeDefined()
  })

  it('surfaces the input £/kWh on each card (both modes)', () => {
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText(/£0\.245\/kWh in/)).toBeDefined()
    expect(screen.getByText(/£0\.065\/kWh in/)).toBeDefined()
  })

  it('engineering mode shows per-source score and the "Selected on {reason}" line', () => {
    const state = makeState({ reason: 'cost', detail: 'HP cheapest at COP 3.8' })
    render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} engineering />
    )
    expect(screen.getByText('score 0.055')).toBeDefined()
    expect(screen.getByText('score 0.068')).toBeDefined()
    expect(screen.getByText(/Selected on cost — HP cheapest at COP 3\.8/)).toBeDefined()
  })

  it('non-engineering render hides score and the "Selected on" line', () => {
    const state = makeState({ reason: 'cost', detail: 'x' })
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.queryByText('score 0.055')).toBeNull()
    expect(screen.queryByText(/Selected on/)).toBeNull()
  })

  it('renders the stored-efficiency badge only for a flagged source', () => {
    const state = makeState({
      sources: [
        { ...makeState().sources[0], efficiency_warning: true },
        { ...makeState().sources[1], efficiency_warning: false },
      ],
    })
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    // Exactly one badge — the flagged HP; the LPG (false) has none.
    expect(screen.getAllByText(/stored efficiency/)).toHaveLength(1)
  })

  it('renders no badge when efficiency_warning is absent on all sources', () => {
    const state = makeState()  // no efficiency_warning key
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.queryByText(/stored efficiency/)).toBeNull()
  })

  // INSTRUCTION-391 — effective-price basis + boiler parasitic on the card.
  it('shows the HP solar-adjusted basis when export_priced and effective < tariff', () => {
    const state = makeState({
      effective_electricity_price: 0.09,
      tariff_electricity: 0.27,
      sources: [
        { ...makeState().sources[0], export_priced: true },
        { ...makeState().sources[1] },
      ],
    })
    render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} engineering />
    )
    expect(screen.getByText('(solar-adjusted)')).toBeDefined()
    expect(screen.getByText(/tariff £0\.27/)).toBeDefined()
  })

  it('shows the effective price plainly (no "solar-adjusted") when effective >= tariff', () => {
    const state = makeState({
      effective_electricity_price: 0.30,
      tariff_electricity: 0.27,
      sources: [
        { ...makeState().sources[0], export_priced: false },
        { ...makeState().sources[1] },
      ],
    })
    render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} engineering />
    )
    expect(screen.getByText(/£0\.30\/kWh effective/)).toBeDefined()
    expect(screen.queryByText('(solar-adjusted)')).toBeNull()
  })

  it('renders the boiler pump adder when parasitic_per_kwh > 0', () => {
    const state = makeState({
      sources: [
        { ...makeState().sources[0] },
        { ...makeState().sources[1], parasitic_per_kwh: 0.01 },
      ],
    })
    render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} engineering />
    )
    expect(screen.getByText(/\+£0\.01\/kWh pump/)).toBeDefined()
  })

  it('renders nothing extra when 391 fields are undefined (back-compat)', () => {
    const state = makeState()  // no effective/tariff/export_priced/parasitic keys
    render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} engineering />
    )
    expect(screen.queryByText('(solar-adjusted)')).toBeNull()
    expect(screen.queryByText(/\/kWh effective/)).toBeNull()
    expect(screen.queryByText(/\/kWh pump/)).toBeNull()
  })
})

describe('SourceSelector debounce cleanup', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clears pending debounce timer on unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const state = makeState({ mode: 'auto' })
    const { container, unmount } = render(
      <SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />
    )

    // Move the slider to arm the debounce timer
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '50' } })

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
