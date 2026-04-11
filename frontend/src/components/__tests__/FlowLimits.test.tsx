import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FlowLimits } from '../FlowLimits'

const baseProps = {
  flowMin: 25,
  flowMax: 50,
  onFlowMinChange: vi.fn(),
  onFlowMaxChange: vi.fn(),
}

describe('FlowLimits', () => {
  it('renders with valid values', () => {
    render(<FlowLimits {...baseProps} />)
    expect(screen.getByText('Flow Limits')).toBeDefined()
    expect(screen.getByText('25.0°')).toBeDefined()
    expect(screen.getByText('50.0°')).toBeDefined()
  })

  it('handles null values — shows "--" and disables buttons', () => {
    render(
      <FlowLimits
        flowMin={null}
        flowMax={null}
        onFlowMinChange={vi.fn()}
        onFlowMaxChange={vi.fn()}
      />
    )
    const dashes = screen.getAllByText('--')
    expect(dashes.length).toBe(2)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it('minus button decreases min value', () => {
    render(<FlowLimits {...baseProps} />)
    const buttons = screen.getAllByRole('button')
    // First button is min minus
    fireEvent.click(buttons[0])
    expect(screen.getByText('24.5°')).toBeDefined()
  })

  it('plus button increases min value', () => {
    render(<FlowLimits {...baseProps} />)
    const buttons = screen.getAllByRole('button')
    // Second button is min plus
    fireEvent.click(buttons[1])
    expect(screen.getByText('25.5°')).toBeDefined()
  })

  it('minus button decreases max value', () => {
    render(<FlowLimits {...baseProps} />)
    const buttons = screen.getAllByRole('button')
    // Third button is max minus
    fireEvent.click(buttons[2])
    expect(screen.getByText('49.5°')).toBeDefined()
  })

  it('plus button increases max value', () => {
    render(<FlowLimits {...baseProps} />)
    const buttons = screen.getAllByRole('button')
    // Fourth button is max plus
    fireEvent.click(buttons[3])
    expect(screen.getByText('50.5°')).toBeDefined()
  })

  it('min cannot exceed max', () => {
    render(
      <FlowLimits
        flowMin={49.5}
        flowMax={50}
        onFlowMinChange={vi.fn()}
        onFlowMaxChange={vi.fn()}
      />
    )
    const buttons = screen.getAllByRole('button')
    // Min plus button should be disabled (49.5 + 0.5 = 50 >= max)
    expect(buttons[1]).toBeDisabled()
  })

  it('max cannot go below min', () => {
    render(
      <FlowLimits
        flowMin={49.5}
        flowMax={50}
        onFlowMinChange={vi.fn()}
        onFlowMaxChange={vi.fn()}
      />
    )
    const buttons = screen.getAllByRole('button')
    // Max minus button should be disabled (50 - 0.5 = 49.5 <= min)
    expect(buttons[2]).toBeDisabled()
  })

  it('min does not go below 20', () => {
    render(
      <FlowLimits
        flowMin={20}
        flowMax={50}
        onFlowMinChange={vi.fn()}
        onFlowMaxChange={vi.fn()}
      />
    )
    const buttons = screen.getAllByRole('button')
    // Min minus button disabled at lower bound
    expect(buttons[0]).toBeDisabled()
  })

  it('max does not go above 60', () => {
    render(
      <FlowLimits
        flowMin={25}
        flowMax={60}
        onFlowMinChange={vi.fn()}
        onFlowMaxChange={vi.fn()}
      />
    )
    const buttons = screen.getAllByRole('button')
    // Max plus button disabled at upper bound
    expect(buttons[3]).toBeDisabled()
  })
})
