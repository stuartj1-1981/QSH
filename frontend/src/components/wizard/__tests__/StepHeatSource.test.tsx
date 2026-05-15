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

describe('StepHeatSource — write budget fields (INSTRUCTION-216B)', () => {
  it('renders flow_writes_per_hour defaulting to 6 when config is undefined', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('6')
  })

  it('renders mode_writes_per_hour defaulting to 6 when config is undefined', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Mode writes per hour') as HTMLInputElement
    expect(input.value).toBe('6')
  })

  it('renders flow_writes_per_hour with configured value 4', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 4 }}
        onUpdate={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('4')
  })

  it('caption shows "10 min" at default value 6', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getAllByText(/≈ one update every 10 min/).length).toBeGreaterThan(0)
  })

  it('caption shows "15 min" when flow_writes_per_hour is 4', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 4 }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/≈ one update every 15 min/)).toBeInTheDocument()
  })

  it('caption shows "20 min" when flow_writes_per_hour is 3', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 3 }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/≈ one update every 20 min/)).toBeInTheDocument()
  })

  it('does not render write-budget fields when heat source type is not selected', () => {
    render(
      <StepHeatSource
        config={{}}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Flow writes per hour')).toBeNull()
    expect(screen.queryByLabelText('Mode writes per hour')).toBeNull()
  })

  it('onChange with valid integer (4) writes through to setConfig via onUpdate', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    expect(onUpdate).toHaveBeenCalledWith('flow_writes_per_hour', 4)
  })

  it('onChange with out-of-range integer (9) shows error and does NOT call onUpdate', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    onUpdate.mockClear()
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    // Did not commit '9' to wizard config
    expect(onUpdate).not.toHaveBeenCalledWith('flow_writes_per_hour', 9)
  })

  it('onChange with non-integer (5.5) shows error and does NOT update local state', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 6 }}
        onUpdate={onUpdate}
      />,
    )
    onUpdate.mockClear()
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5.5' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalledWith('flow_writes_per_hour', 5.5)
  })

  it('onChange with empty string does NOT change state or error', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 4 }}
        onUpdate={onUpdate}
      />,
    )
    onUpdate.mockClear()
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('4')
    expect(screen.queryByText('Must be 3–6')).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('onBlur with out-of-range local state (9) clamps to 6, commits via onUpdate, clears error', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 3 }}
        onUpdate={onUpdate}
      />,
    )
    onUpdate.mockClear()
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.queryByText('Must be 3–6')).toBeNull()
    expect(onUpdate).toHaveBeenCalledWith('flow_writes_per_hour', 6)
  })

  it('onBlur does NOT call onUpdate redundantly when clamped value equals committed value', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 4 }}
        onUpdate={onUpdate}
      />,
    )
    onUpdate.mockClear()
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.blur(input)
    // No change typed; local state == committed == 4. No onUpdate fires.
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('onBlur clears error span when local state was non-integer that clamps to a valid integer (typed 6.4 → 6)', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 6 }}
        onUpdate={onUpdate}
      />,
    )
    onUpdate.mockClear()
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '6.4' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.queryByText('Must be 3–6')).toBeNull()
    // clamp(6) === 6 === committed → no onUpdate
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('external config change re-syncs local state via useEffect', () => {
    const { rerender } = render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 6 }}
        onUpdate={vi.fn()}
      />,
    )
    let input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('6')
    rerender(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' }, flow_writes_per_hour: 4 }}
        onUpdate={vi.fn()}
      />,
    )
    input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('4')
  })

  it('mode_writes_per_hour onChange writes mode key independently', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    const input = screen.getByLabelText('Mode writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    expect(onUpdate).toHaveBeenCalledWith('mode_writes_per_hour', 5)
  })
})
