import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepHeatSource } from '../StepHeatSource'

describe('StepHeatSource — capacity_kw input (INSTRUCTION-154C)', () => {
  it('renders the rated capacity field once a heat source type is selected', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/Rated capacity/i)).toBeDefined()
  })

  it('emits onUpdate with capacity_kw when the user enters a value', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Rated capacity/i), {
      target: { value: '6.5' },
    })
    expect(onUpdate).toHaveBeenCalledWith(
      'heat_source',
      expect.objectContaining({ capacity_kw: 6.5 }),
    )
  })

  it('shows a warning when capacity is outside typical residential range', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', capacity_kw: 200 } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Outside typical residential range/i)).toBeDefined()
  })

  it('does not show the warning for capacity in range', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', capacity_kw: 6 } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.queryByText(/Outside typical residential range/i)).toBeNull()
  })

  it('handles empty input by emitting undefined (not zero)', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', capacity_kw: 6 } }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Rated capacity/i), {
      target: { value: '' },
    })
    expect(onUpdate).toHaveBeenCalledWith(
      'heat_source',
      expect.objectContaining({ capacity_kw: undefined }),
    )
  })
})
