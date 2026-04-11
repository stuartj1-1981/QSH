import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlValueDisplay } from '../ControlValueDisplay'
import type { ControlSource } from '../../../types/api'

describe('ControlValueDisplay', () => {
  it('renders editable input when source is internal (no entity)', () => {
    const onChange = vi.fn()
    render(
      <ControlValueDisplay
        label="Flow Min Temperature"
        controlSource={undefined}
        internalValue={25}
        onInternalChange={onChange}
        unit="°C"
        min={20}
        max={45}
        step={0.5}
      />
    )
    expect(screen.getByText('Flow Min Temperature')).toBeInTheDocument()
    expect(screen.getByText('No entity configured — using internal value')).toBeInTheDocument()
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(25)
  })

  it('fires onInternalChange when input changes', () => {
    const onChange = vi.fn()
    render(
      <ControlValueDisplay
        label="Flow Min"
        controlSource={undefined}
        internalValue={25}
        onInternalChange={onChange}
        min={20}
        max={45}
      />
    )
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '30' } })
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it('renders read-only live value with source badge when external connected', () => {
    const cs: ControlSource = {
      key: 'flow_min',
      value: 28,
      source: 'external',
      external_id: 'input_number.flow_min_temperature',
      external_raw: '28.0',
    }
    render(
      <ControlValueDisplay
        label="Flow Min Temperature"
        controlSource={cs}
        internalValue={25}
        onInternalChange={() => {}}
        unit="°C"
      />
    )
    expect(screen.getByText('28 °C')).toBeInTheDocument()
    expect(screen.getByText('via input_number.flow_min_temperature')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('renders fallback value with amber warning when external unavailable', () => {
    const cs: ControlSource = {
      key: 'flow_min',
      value: 25,
      source: 'internal',
      external_id: 'input_number.flow_min_temperature',
      external_raw: '',
    }
    render(
      <ControlValueDisplay
        label="Flow Min Temperature"
        controlSource={cs}
        internalValue={25}
        onInternalChange={() => {}}
        unit="°C"
      />
    )
    expect(screen.getByText('25 °C')).toBeInTheDocument()
    expect(screen.getByText('(fallback)')).toBeInTheDocument()
    expect(screen.getByText('input_number.flow_min_temperature unavailable')).toBeInTheDocument()
  })

  it('renders boolean toggle for internal boolean values', () => {
    const onChange = vi.fn()
    render(
      <ControlValueDisplay
        label="Active Control"
        controlSource={undefined}
        internalValue={true}
        onInternalChange={onChange}
      />
    )
    expect(screen.getByText('Active Control')).toBeInTheDocument()
    // Toggle button exists (no spinbutton)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    const toggle = screen.getByRole('button')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
