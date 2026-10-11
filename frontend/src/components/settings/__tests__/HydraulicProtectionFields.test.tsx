/**
 * INSTRUCTION-575H — hydraulic protection fields for the primary heat
 * source: min_flow_rate (shown and required when a flow-rate sensor is set),
 * bypass_setpoint, and bypass_rooms (configured rooms; none = automatic).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HydraulicProtectionFields } from '../HydraulicProtectionFields'
import type { HeatSourceYaml } from '../../../types/config'

const hp = (extra: Partial<HeatSourceYaml> = {}): HeatSourceYaml => ({
  type: 'heat_pump',
  name: 'hp',
  ...extra,
})

function renderFields(source: HeatSourceYaml, roomNames: string[] = ['lounge', 'bedroom']) {
  const onChange = vi.fn()
  render(
    <HydraulicProtectionFields
      source={source}
      roomNames={roomNames}
      onChange={onChange}
      idPrefix="t"
    />,
  )
  return onChange
}

describe('HydraulicProtectionFields — minimum flow rate', () => {
  it('is not rendered when no flow-rate sensor is set', () => {
    renderFields(hp())
    expect(screen.queryByLabelText(/Minimum flow rate/)).toBeNull()
  })

  it('is not rendered for a blank sensor value', () => {
    renderFields(hp({ sensors: { flow_rate: '  ' } }))
    expect(screen.queryByLabelText(/Minimum flow rate/)).toBeNull()
  })

  it('is rendered and required for an HA flow-rate entity', () => {
    renderFields(hp({ sensors: { flow_rate: 'sensor.hp_flow_rate' } }))
    const input = screen.getByLabelText(/Minimum flow rate/) as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.step).toBe('0.1')
    const star = Array.from(input.closest('div')!.querySelectorAll('label span')).find(
      (s) => s.textContent === '*',
    )
    expect(star).toBeDefined()
    expect(screen.getByText(/installation manual/)).toBeInTheDocument()
  })

  it('is rendered and required for an MQTT flow-rate topic', () => {
    renderFields(hp({ sensors: { flow_rate: { topic: 'hp/flow_rate', format: 'plain' } } }))
    const input = screen.getByLabelText(/Minimum flow rate/) as HTMLInputElement
    expect(input.required).toBe(true)
  })

  it('flags the missing value until a positive number is entered', () => {
    renderFields(hp({ sensors: { flow_rate: 'sensor.hp_flow_rate' } }))
    expect(screen.getByLabelText(/Minimum flow rate/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/Required when a flow-rate sensor is set/)
  })

  it('does not flag a positive value', () => {
    renderFields(hp({ sensors: { flow_rate: 'sensor.hp_flow_rate' }, min_flow_rate: 12 }))
    expect(screen.getByLabelText(/Minimum flow rate/)).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('flags a value of 0, which is not above 0', () => {
    renderFields(hp({ sensors: { flow_rate: 'sensor.hp_flow_rate' }, min_flow_rate: 0 }))
    expect(screen.getByLabelText(/Minimum flow rate/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter a number above 0/)
  })

  it('sends the typed value, and undefined when cleared', () => {
    const onChange = renderFields(
      hp({ sensors: { flow_rate: 'sensor.hp_flow_rate' }, min_flow_rate: 12 }),
    )
    const input = screen.getByLabelText(/Minimum flow rate/)
    fireEvent.change(input, { target: { value: '9.5' } })
    expect(onChange).toHaveBeenLastCalledWith({ min_flow_rate: 9.5 })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ min_flow_rate: undefined })
  })
})

describe('HydraulicProtectionFields — bypass setpoint', () => {
  it('shows the 25 °C default and sends a typed value', () => {
    const onChange = renderFields(hp())
    const input = screen.getByLabelText(/Bypass room setpoint/) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('25')
    fireEvent.change(input, { target: { value: '27' } })
    expect(onChange).toHaveBeenLastCalledWith({ bypass_setpoint: 27 })
  })
})

describe('HydraulicProtectionFields — bypass rooms', () => {
  it('lists the configured rooms and reports automatic selection when none is ticked', () => {
    renderFields(hp())
    expect(screen.getByRole('checkbox', { name: 'lounge' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'bedroom' })).not.toBeChecked()
    expect(screen.getByText(/Automatic selection/)).toBeInTheDocument()
  })

  it('appends a ticked room to the declared list', () => {
    const onChange = renderFields(hp({ bypass_rooms: ['bedroom'] }))
    expect(screen.getByRole('checkbox', { name: 'bedroom' })).toBeChecked()
    expect(screen.queryByText(/Automatic selection/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'lounge' }))
    expect(onChange).toHaveBeenLastCalledWith({ bypass_rooms: ['bedroom', 'lounge'] })
  })

  it('unticking the last room returns to automatic (key removed)', () => {
    const onChange = renderFields(hp({ bypass_rooms: ['lounge'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'lounge' }))
    expect(onChange).toHaveBeenLastCalledWith({ bypass_rooms: undefined })
  })

  it('shows a declared room that is not configured so it can be removed', () => {
    const onChange = renderFields(hp({ bypass_rooms: ['attic', 'lounge'] }))
    const stale = screen.getByRole('checkbox', { name: /attic/ })
    expect(stale).toBeChecked()
    expect(screen.getByText(/not a configured room/)).toBeInTheDocument()
    fireEvent.click(stale)
    expect(onChange).toHaveBeenLastCalledWith({ bypass_rooms: ['lounge'] })
  })

  it('explains the automatic default when no rooms are configured', () => {
    renderFields(hp(), [])
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText(/No rooms are configured yet/)).toBeInTheDocument()
  })
})
