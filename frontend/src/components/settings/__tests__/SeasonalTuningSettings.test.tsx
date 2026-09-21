import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ControlSource } from '../../../types/api'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// INSTRUCTION-544B T10(c) — mirrors HeatSourceSettings.controlSources.test.tsx's
// convention: mock useStatus directly rather than racing its internal fetch.
const statusData: { control_sources?: ControlSource[]; source_selection?: { active_source: string } } = {}

vi.mock('../../../hooks/useStatus', () => ({
  useStatus: () => ({ data: statusData, error: null }),
}))

import { SeasonalTuningSettings } from '../SeasonalTuningSettings'

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  delete statusData.control_sources
  delete statusData.source_selection
})

const baseProps = {
  antifrostThreshold: 7.0,
  shoulderThreshold: 2.0,
  driver: 'ha' as const,
  onRefetch: vi.fn(),
  onRefetchProcessed: vi.fn(),
}

describe('SeasonalTuningSettings', () => {
  it('renders both threshold controls', () => {
    render(<SeasonalTuningSettings {...baseProps} />)
    expect(screen.getByText('Seasonal Tuning')).toBeDefined()
    expect(screen.getByText('Antifrost OAT Threshold (Shoulder Mode Disable)')).toBeDefined()
    expect(screen.getByText('Shoulder Shutdown Threshold')).toBeDefined()
  })

  it('renders current values', () => {
    render(<SeasonalTuningSettings {...baseProps} />)
    expect(screen.getByText('7.0 °C')).toBeDefined()
    expect(screen.getByText('2.0 kW')).toBeDefined()
  })

  it('handles null values gracefully', () => {
    render(
      <SeasonalTuningSettings
        antifrostThreshold={null}
        shoulderThreshold={null}
        driver="ha"
        onRefetch={vi.fn()}
        onRefetchProcessed={vi.fn()}
      />
    )
    const dashes = screen.getAllByText('--')
    expect(dashes.length).toBe(2)
  })

  it('antifrost stays within 0-15 range', () => {
    const { rerender } = render(
      <SeasonalTuningSettings
        antifrostThreshold={0}
        shoulderThreshold={2.0}
        driver="ha"
        onRefetch={vi.fn()}
        onRefetchProcessed={vi.fn()}
      />
    )
    // First minus button (antifrost) should be disabled at 0
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toBeDisabled()

    rerender(
      <SeasonalTuningSettings
        antifrostThreshold={15}
        shoulderThreshold={2.0}
        driver="ha"
        onRefetch={vi.fn()}
        onRefetchProcessed={vi.fn()}
      />
    )
    // First plus button (antifrost) should be disabled at 15
    const buttonsUpdated = screen.getAllByRole('button')
    expect(buttonsUpdated[1]).toBeDisabled()
  })

  it('shoulder stays within 0.5-10 range', () => {
    const { rerender } = render(
      <SeasonalTuningSettings
        antifrostThreshold={7.0}
        shoulderThreshold={0.5}
        driver="ha"
        onRefetch={vi.fn()}
        onRefetchProcessed={vi.fn()}
      />
    )
    // Third button (shoulder minus) should be disabled at 0.5
    const buttons = screen.getAllByRole('button')
    expect(buttons[2]).toBeDisabled()

    rerender(
      <SeasonalTuningSettings
        antifrostThreshold={7.0}
        shoulderThreshold={10}
        driver="ha"
        onRefetch={vi.fn()}
        onRefetchProcessed={vi.fn()}
      />
    )
    // Fourth button (shoulder plus) should be disabled at 10
    const buttonsUpdated = screen.getAllByRole('button')
    expect(buttonsUpdated[3]).toBeDisabled()
  })

  it('antifrost uses POST method', async () => {
    vi.useFakeTimers()
    render(<SeasonalTuningSettings {...baseProps} />)
    const buttons = screen.getAllByRole('button')
    // Click antifrost plus button
    fireEvent.click(buttons[1])

    // Advance past debounce
    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api/control/antifrost-threshold'),
      expect.objectContaining({ method: 'POST' })
    )
    vi.useRealTimers()
  })

  it('shoulder uses PATCH method', async () => {
    vi.useFakeTimers()
    render(<SeasonalTuningSettings {...baseProps} />)
    const buttons = screen.getAllByRole('button')
    // Click shoulder plus button
    fireEvent.click(buttons[3])

    // Advance past debounce
    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api/control/shoulder-threshold'),
      expect.objectContaining({ method: 'PATCH' })
    )
    vi.useRealTimers()
  })

  it('refetches the processed config beside the existing onRefetch call on both writes (T10(e))', async () => {
    vi.useFakeTimers()
    const onRefetch = vi.fn()
    const onRefetchProcessed = vi.fn()
    render(<SeasonalTuningSettings {...baseProps} onRefetch={onRefetch} onRefetchProcessed={onRefetchProcessed} />)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1]) // antifrost plus
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(onRefetch).toHaveBeenCalledTimes(1)
    expect(onRefetchProcessed).toHaveBeenCalledTimes(1)

    fireEvent.click(buttons[3]) // shoulder plus
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(onRefetch).toHaveBeenCalledTimes(2)
    expect(onRefetchProcessed).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('reverts and flashes an error when a write is refused (T10(f))', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
    render(<SeasonalTuningSettings {...baseProps} antifrostThreshold={7.0} />)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1]) // antifrost plus: 7.0 -> 7.5
    await act(async () => { vi.advanceTimersByTime(600) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByText('7.0 °C')).toBeDefined()
    vi.useRealTimers()
  })
})

/**
 * INSTRUCTION-544B T10(c)/T10(d) — read-only branches. Antifrost has one
 * shape (an entity, or not); shoulder has two, and the second is not an
 * entity (§1.3): a multi-source install renders the shoulder control
 * read-only via a synthetic source-shaped row naming the active heat
 * source, since ControlValueDisplay's own three-state logic has no branch
 * for "overridden by source selection, not by an entity".
 */
describe('SeasonalTuningSettings — read-only branches (INSTRUCTION-544B)', () => {
  it('antifrost renders read-only with the source named when an entity is bound', () => {
    statusData.control_sources = [{
      key: 'antifrost_oat_threshold_internal',
      value: 7.0,
      source: 'external',
      external_id: 'input_number.antifrost_threshold',
      external_raw: '7.0',
    }]
    render(<SeasonalTuningSettings {...baseProps} />)
    expect(screen.getByText(/via input_number\.antifrost_threshold/)).toBeDefined()
  })

  it('shoulder stays editable on a single-source install with no entity bound', () => {
    render(<SeasonalTuningSettings {...baseProps} heatSources={[{ type: 'heat_pump' }]} />)
    expect(screen.getByText('2.0 kW')).toBeDefined()
    expect(screen.queryByText(/via /)).toBeNull()
  })

  it('shoulder renders read-only and names the active source on a multi-source install with no entity bound', () => {
    statusData.control_sources = [
      { key: 'hp_min_output_kw_internal', value: 2.0, source: 'internal', external_id: '', external_raw: '' },
    ]
    statusData.source_selection = { active_source: 'Octopus Cosy 6' }
    render(
      <SeasonalTuningSettings
        {...baseProps}
        heatSources={[{ type: 'heat_pump' }, { type: 'gas_boiler' }]}
      />,
    )
    expect(screen.getByText(/via Octopus Cosy 6/)).toBeDefined()
    // An editable shoulder stepper on a multi-source install is a defect of
    // this task, not a cosmetic difference (T10(c)).
    expect(screen.queryByText('2.0 kW')).toBeNull()
  })

  it('shoulder renders read-only and names the entity on a multi-source install with an entity bound', () => {
    statusData.control_sources = [{
      key: 'hp_min_output_kw_internal',
      value: 2.0,
      source: 'external',
      external_id: 'input_number.shoulder_threshold',
      external_raw: '2.0',
    }]
    render(
      <SeasonalTuningSettings
        {...baseProps}
        heatSources={[{ type: 'heat_pump' }, { type: 'gas_boiler' }]}
      />,
    )
    expect(screen.getByText(/via input_number\.shoulder_threshold/)).toBeDefined()
  })
})
