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
    // INSTRUCTION-237A: frontend writes plural only. Server reconciles to
    // singular per cross-cutting decision.
    expect(onUpdate).toHaveBeenCalledWith(
      'heat_sources',
      expect.arrayContaining([
        expect.objectContaining({ capacity_kw: 6.5 }),
      ]),
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
    // INSTRUCTION-237A: frontend writes plural only.
    expect(onUpdate).toHaveBeenCalledWith(
      'heat_sources',
      expect.arrayContaining([
        expect.objectContaining({ capacity_kw: undefined }),
      ]),
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

  it('renders write-budget fields whenever at least one heat source is configured', () => {
    // INSTRUCTION-237A: in the multi-source model, the wizard always
    // hydrates at least one source (a default heat_pump entry), so the
    // write-budget fields are unconditionally visible. The original
    // pre-237A "no type selected" branch can no longer occur.
    render(
      <StepHeatSource
        config={{}}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Flow writes per hour')).toBeInTheDocument()
    expect(screen.getByLabelText('Mode writes per hour')).toBeInTheDocument()
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

describe('StepHeatSource — multi-source (INSTRUCTION-237A)', () => {
  it('renders an "Add heat source" button at the bottom of the cards list', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump' } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: /add heat source/i }),
    ).toBeInTheDocument()
  })

  it('adds a second source card when the Add button is clicked', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', name: 'HP' } }}
        onUpdate={vi.fn()}
      />,
    )
    // Card count via the always-rendered remove buttons (visible regardless
    // of expanded/collapsed state — name input is body-only).
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /add heat source/i }))
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2)
  })

  it('caps the number of sources at MAX_HEAT_SOURCES (4) and disables Add', () => {
    const config = {
      heat_sources: [
        { type: 'heat_pump' as const, name: 'S1' },
        { type: 'gas_boiler' as const, name: 'S2' },
        { type: 'oil_boiler' as const, name: 'S3' },
      ],
    }
    render(<StepHeatSource config={config} onUpdate={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
    const addBtn = screen.getByRole('button', { name: /add heat source/i })
    expect(addBtn).not.toBeDisabled()
    fireEvent.click(addBtn)
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(4)
    // Now at the cap.
    expect(addBtn).toBeDisabled()
    expect(screen.getByText(/Maximum 4 sources/i)).toBeInTheDocument()
    fireEvent.click(addBtn)
    // No more cards added.
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(4)
  })

  it('removes a non-first source card on remove click', () => {
    const config = {
      heat_sources: [
        { type: 'heat_pump' as const, name: 'HP' },
        { type: 'gas_boiler' as const, name: 'Boiler' },
      ],
    }
    render(<StepHeatSource config={config} onUpdate={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2)
    // Click the second card's remove button (it is enabled — removable=true).
    fireEvent.click(screen.getByRole('button', { name: /Remove Boiler/ }))
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
  })

  it('disables the remove button on the only remaining source', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', name: 'OnlySource' } }}
        onUpdate={vi.fn()}
      />,
    )
    const removeBtn = screen.getByRole('button', { name: /Remove OnlySource/ })
    expect(removeBtn).toBeDisabled()
  })

  it('each card exposes name / type / efficiency / capacity / min_output fields', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', name: 'HP' } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/Source name/i)).toBeInTheDocument()
    expect(screen.getByText(/System Type/i)).toBeInTheDocument()
    // For heat_pump, label is "Expected COP"; for boilers, "Efficiency".
    expect(screen.getByLabelText(/Expected COP|Efficiency/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Rated capacity/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Min Output/i)).toBeInTheDocument()
  })

  it('shows fuel_cost fields for non-HP sources only', () => {
    // HP — fuel cost hidden.
    const { unmount } = render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', name: 'HP' } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/Fuel cost \(£/)).toBeNull()
    unmount()

    // Gas boiler — fuel cost visible.
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'gas_boiler', name: 'Boiler' } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/Fuel cost \(£/)).toBeInTheDocument()
  })

  it('writes ONLY to heat_sources (plural) on field updates', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', name: 'HP' } }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Source name/i), {
      target: { value: 'Renamed HP' },
    })
    // At least one heat_sources call.
    const hsCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_sources')
    expect(hsCalls.length).toBeGreaterThan(0)
    expect(Array.isArray(hsCalls[0][1])).toBe(true)
    // No singular call ever.
    const singularCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_source')
    expect(singularCalls).toHaveLength(0)
  })

  it('hydrates from plural when both heat_source and heat_sources are present', () => {
    const config = {
      heat_source: { type: 'heat_pump' as const, name: 'Stale singular' },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Real source 1' },
        { type: 'gas_boiler' as const, name: 'Real source 2' },
      ],
    }
    render(<StepHeatSource config={config} onUpdate={vi.fn()} />)
    // Two cards rendered (from plural), not one (from singular).
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2)
    // Header text reflects plural names, not the stale singular.
    expect(screen.getByText('Real source 1')).toBeInTheDocument()
    expect(screen.getByText('Real source 2')).toBeInTheDocument()
    expect(screen.queryByText('Stale singular')).toBeNull()
    // First card is expanded by default → its name input shows plural[0].
    const nameInput = screen.getByLabelText(/Source name/i) as HTMLInputElement
    expect(nameInput.value).toBe('Real source 1')
  })
})
