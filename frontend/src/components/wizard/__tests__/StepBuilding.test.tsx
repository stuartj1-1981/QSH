/**
 * Tests for StepBuilding — INSTRUCTION-368 wizard capture of construction_year
 * + fabric_class. Both optional; the "I don't know" path leaves them unset
 * (undefined), it never stores "unknown".
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepBuilding } from '../StepBuilding'
import type { QshConfigYaml } from '../../../types/config'

describe('StepBuilding (INSTRUCTION-368)', () => {
  it('renders the construction-year and fabric-class inputs', () => {
    render(<StepBuilding config={{}} onUpdate={vi.fn()} />)
    expect(screen.getByLabelText('Construction Year')).toBeInTheDocument()
    expect(screen.getByLabelText('Wall Construction')).toBeInTheDocument()
  })

  it('persists an entered construction year as a number', () => {
    const onUpdate = vi.fn()
    render(<StepBuilding config={{}} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Construction Year'), {
      target: { value: '2016' },
    })
    expect(onUpdate).toHaveBeenCalledWith('construction_year', 2016)
  })

  it('persists a selected fabric class', () => {
    const onUpdate = vi.fn()
    render(<StepBuilding config={{}} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Wall Construction'), {
      target: { value: 'cavity_filled' },
    })
    expect(onUpdate).toHaveBeenCalledWith('fabric_class', 'cavity_filled')
  })

  it('clearing the year field leaves construction_year unset', () => {
    const onUpdate = vi.fn()
    render(
      <StepBuilding config={{ construction_year: 2016 }} onUpdate={onUpdate} />
    )
    fireEvent.change(screen.getByLabelText('Construction Year'), {
      target: { value: '' },
    })
    expect(onUpdate).toHaveBeenCalledWith('construction_year', undefined)
  })

  it('the "I don\'t know" fabric option leaves fabric_class unset', () => {
    const onUpdate = vi.fn()
    const config: Partial<QshConfigYaml> = { fabric_class: 'cavity_filled' }
    render(<StepBuilding config={config} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Wall Construction'), {
      target: { value: '' },
    })
    expect(onUpdate).toHaveBeenCalledWith('fabric_class', undefined)
  })

  it('reflects existing config values', () => {
    render(
      <StepBuilding
        config={{ construction_year: 1975, fabric_class: 'solid_wall' }}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Construction Year')).toHaveValue(1975)
    expect(screen.getByLabelText('Wall Construction')).toHaveValue('solid_wall')
  })
})
