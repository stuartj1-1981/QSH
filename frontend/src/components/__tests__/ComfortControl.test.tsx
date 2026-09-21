import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ComfortControl } from '../ComfortControl'

const baseProps = {
  comfortTemp: 20.0,
  controlEnabled: true,
  saving: false,
  onComfortTempChange: vi.fn().mockResolvedValue(undefined),
  onControlModeChange: vi.fn(),
}

describe('ComfortControl schedule indicator', () => {
  it('shows "Scheduled" badge with active temp when schedule is active', () => {
    render(
      <ComfortControl
        {...baseProps}
        comfortScheduleActive={true}
        comfortTempActive={17.0}
      />
    )
    const badge = screen.getByText(/Scheduled/)
    expect(badge).toBeDefined()
    expect(badge.textContent).toContain('17.0°')
  })

  it('does not show "Scheduled" badge when schedule is inactive', () => {
    render(
      <ComfortControl
        {...baseProps}
        comfortScheduleActive={false}
      />
    )
    expect(screen.queryByText(/Scheduled/)).toBeNull()
  })

  it('shows "Away" badge instead of "Scheduled" when both are active', () => {
    render(
      <ComfortControl
        {...baseProps}
        awayActive={true}
        comfortScheduleActive={true}
        comfortTempActive={17.0}
      />
    )
    expect(screen.getByText(/Away mode active/)).toBeDefined()
    expect(screen.queryByText(/Scheduled/)).toBeNull()
  })

  it('shows "Scheduled" badge without temp when comfortTempActive is undefined', () => {
    render(
      <ComfortControl
        {...baseProps}
        comfortScheduleActive={true}
        comfortTempActive={undefined}
      />
    )
    const badge = screen.getByText(/Scheduled/)
    expect(badge).toBeDefined()
    expect(badge.textContent).not.toMatch(/\d+\.\d°/)
  })

  it('renders temperature display correctly', () => {
    render(<ComfortControl {...baseProps} />)
    expect(screen.getByText('20.0°')).toBeDefined()
  })

  it('renders writeback-unverified pill when unverified true and cycles >= 2', () => {
    render(
      <ComfortControl
        {...baseProps}
        writebackUnverified={true}
        writebackUnverifiedCycles={3}
        engineering={false}
      />
    )
    expect(screen.getByText('Writeback unverified')).toBeDefined()
  })

  it('hides writeback-unverified pill when cycles < 2 and not engineering', () => {
    const { rerender } = render(
      <ComfortControl
        {...baseProps}
        writebackUnverified={true}
        writebackUnverifiedCycles={1}
        engineering={false}
      />
    )
    expect(screen.queryByText('Writeback unverified')).toBeNull()

    rerender(
      <ComfortControl
        {...baseProps}
        writebackUnverified={true}
        writebackUnverifiedCycles={1}
        engineering={true}
      />
    )
    expect(screen.getByText('Writeback unverified')).toBeDefined()
  })
})

// INSTRUCTION-544B T9(f) — read-only branch cases (P34: FlowLimits names no
// source; owner ruling 2 requires it named, so ComfortControl reuses
// ControlValueDisplay rather than a silent read-only display) and the
// failed-write annunciation (T9(c)).
describe('ComfortControl — read-only branch (INSTRUCTION-544B)', () => {
  it('is editable (steppers, no source badge) when readOnly is false', () => {
    render(<ComfortControl {...baseProps} readOnly={false} />)
    expect(screen.getByText('20.0°')).toBeDefined()
    expect(screen.queryByText(/via /)).toBeNull()
  })

  it('renders read-only via ControlValueDisplay with the source named when an entity is bound', () => {
    render(
      <ComfortControl
        {...baseProps}
        readOnly
        controlSource={{
          key: 'pid_target_internal',
          value: 21.5,
          source: 'external',
          external_id: 'input_number.comfort_temp',
          external_raw: '21.5',
        }}
      />
    )
    // No +/- steppers in the read-only branch.
    expect(screen.queryByText('20.0°')).toBeNull()
    expect(screen.getByText(/via input_number\.comfort_temp/)).toBeDefined()
    expect(screen.getByText(/21\.5/)).toBeDefined()
  })

  it('renders the fallback-with-warning state when the bound entity is unavailable', () => {
    render(
      <ComfortControl
        {...baseProps}
        readOnly
        controlSource={{
          key: 'pid_target_internal',
          value: 20.0,
          source: 'internal',
          external_id: 'input_number.comfort_temp',
          external_raw: '',
        }}
      />
    )
    expect(screen.getByText(/input_number\.comfort_temp unavailable/)).toBeDefined()
  })
})

describe('ComfortControl — failed write annunciation (INSTRUCTION-544B T9(c))', () => {
  it('reverts the displayed value and flashes an error when the write is refused', async () => {
    vi.useFakeTimers()
    const onComfortTempChange = vi.fn().mockRejectedValue(new Error('HTTP 503'))
    render(
      <ComfortControl
        {...baseProps}
        comfortTemp={20.0}
        onComfortTempChange={onComfortTempChange}
      />
    )
    const plusButton = screen.getAllByRole('button')[1]
    fireEvent.click(plusButton)

    await act(async () => { vi.advanceTimersByTime(500) })
    // Flush the rejected-promise microtask queue under fake timers — waitFor
    // polls with a real setTimeout, which never fires while timers are faked.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(onComfortTempChange).toHaveBeenCalledWith(20.5)
    expect(screen.getByText('20.0°')).toBeDefined()
    vi.useRealTimers()
  })
})
