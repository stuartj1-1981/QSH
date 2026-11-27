/**
 * INSTRUCTION-646B — the off-power threshold field of the wizard's heat-source
 * step: it shows once a type is chosen, writes the value into `heat_sources`,
 * writes nothing for a blank field, and flags a value outside the band.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepHeatSource } from '../StepHeatSource'
import { offPowerThresholdHelp } from '../../../lib/heat-source-types'

describe('StepHeatSource — off-power threshold (INSTRUCTION-646B)', () => {
  it('shows the field with the type value as placeholder', () => {
    render(<StepHeatSource config={{ heat_source: { type: 'gas_boiler' } }} onUpdate={vi.fn()} />)
    const input = screen.getByLabelText(/Off-power threshold/i) as HTMLInputElement
    expect(input.placeholder).toBe('default 0.5')
    expect(screen.getByText(offPowerThresholdHelp('gas_boiler'))).toBeDefined()
  })

  it('writes the entered value into heat_sources', () => {
    const onUpdate = vi.fn()
    render(<StepHeatSource config={{ heat_source: { type: 'heat_pump' } }} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/Off-power threshold/i), { target: { value: '0.2' } })
    expect(onUpdate).toHaveBeenCalledWith(
      'heat_sources',
      expect.arrayContaining([expect.objectContaining({ off_power_threshold_kw: 0.2 })]),
    )
  })

  it('a blank field writes no value', () => {
    const onUpdate = vi.fn()
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', off_power_threshold_kw: 0.2 } }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Off-power threshold/i), { target: { value: '' } })
    const sources = onUpdate.mock.calls.at(-1)![1] as Array<{ off_power_threshold_kw?: number }>
    expect(sources[0].off_power_threshold_kw).toBeUndefined()
  })

  it('flags a value outside the band', () => {
    render(
      <StepHeatSource
        config={{ heat_source: { type: 'heat_pump', off_power_threshold_kw: 0.01 } }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Must be between 0\.05 and 1 kW/)).toBeDefined()
  })
})
