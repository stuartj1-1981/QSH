import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SeasonalTuningSettings } from '../SeasonalTuningSettings'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
})

const baseProps = {
  antifrostThreshold: 7.0,
  shoulderThreshold: 2.0,
  driver: 'ha' as const,
  onRefetch: vi.fn(),
}

describe('SeasonalTuningSettings', () => {
  it('renders both threshold controls', () => {
    render(<SeasonalTuningSettings {...baseProps} />)
    expect(screen.getByText('Seasonal Tuning')).toBeDefined()
    expect(screen.getByText('Antifrost OAT Threshold')).toBeDefined()
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
})
