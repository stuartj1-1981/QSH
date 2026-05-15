/**
 * Tests for StepThermal — focused on the INSTRUCTION-227C Task 7 solar
 * capacity informational paragraph. The wizard step is otherwise pre-existing
 * and not under active test coverage; this file pins the new content only.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepThermal } from '../StepThermal'
import type { QshConfigYaml } from '../../../types/config'

const _config: Partial<QshConfigYaml> = {
  rooms: {
    lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, control_mode: 'indirect' },
  },
}

describe('StepThermal solar-capacity informational paragraph (INSTRUCTION-227C Task 7)', () => {
  it('renders the solar production capacity section', () => {
    render(<StepThermal config={_config} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('step-thermal-solar-capacity-info')).toBeInTheDocument()
    expect(screen.getByText('Solar production capacity')).toBeInTheDocument()
  })

  it('explains the learning behaviour and points to Settings', () => {
    render(<StepThermal config={_config} onUpdate={vi.fn()} />)
    const section = screen.getByTestId('step-thermal-solar-capacity-info')
    // Learning-from-observation framing.
    expect(section.textContent).toMatch(/learns/)
    expect(section.textContent).toMatch(/peak solar production capacity \(kWp\)/)
    // No-setup framing — wizard must not imply the user needs to do anything.
    expect(section.textContent).toMatch(/No setup is required/)
    // Pointer to Settings for live monitoring.
    expect(section.textContent).toMatch(/Settings/)
  })

  it('explains the no-override choice and reset path', () => {
    render(<StepThermal config={_config} onUpdate={vi.fn()} />)
    const section = screen.getByTestId('step-thermal-solar-capacity-info')
    expect(section.textContent).toMatch(/Manual override is intentionally not offered/)
    expect(section.textContent).toMatch(/sysid_state\.json/)
  })

  it('contains no input controls — purely informational', () => {
    render(<StepThermal config={_config} onUpdate={vi.fn()} />)
    const section = screen.getByTestId('step-thermal-solar-capacity-info')
    expect(section.querySelectorAll('input').length).toBe(0)
    expect(section.querySelectorAll('button').length).toBe(0)
    expect(section.querySelectorAll('select').length).toBe(0)
  })
})
