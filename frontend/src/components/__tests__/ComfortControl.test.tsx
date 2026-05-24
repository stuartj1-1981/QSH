import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComfortControl } from '../ComfortControl'

const baseProps = {
  comfortTemp: 20.0,
  controlEnabled: true,
  saving: false,
  onComfortTempChange: vi.fn(),
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
