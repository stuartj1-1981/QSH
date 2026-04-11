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
    last_switch_reason: 'auto',
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

  it('formats thermal cost to 3 decimal places', () => {
    const state = makeState()
    render(<SourceSelector sourceSelection={state} onModeChange={vi.fn()} onPreferenceChange={vi.fn()} />)
    expect(screen.getByText('£0.064/kWh')).toBeDefined()
    expect(screen.getByText('£0.073/kWh')).toBeDefined()
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
