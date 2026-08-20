import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OccupancyFields } from '../OccupancyFields'
import type { RoomConfigYaml } from '../../types/config'

const baseRoom: RoomConfigYaml = {
  area_m2: 15,
  occupancy_sensor: 'binary_sensor.lounge_presence',
}

function renderFields(opts: {
  room?: Partial<RoomConfigYaml>
  sensorConfigured?: boolean
  deviceClass?: string
} = {}) {
  const onChange = vi.fn()
  const room: RoomConfigYaml = { ...baseRoom, ...opts.room }
  const utils = render(
    <OccupancyFields
      room={room}
      onChange={onChange}
      sensorSlot={<div data-testid="sensor-slot">slot</div>}
      sensorConfigured={opts.sensorConfigured ?? true}
      deviceClass={opts.deviceClass}
      idPrefix="test"
    />,
  )
  return { onChange, room, ...utils }
}

const classSelect = () => document.getElementById('test-occupancy-class') as HTMLSelectElement
const debounceInput = () => document.getElementById('test-occupancy-debounce') as HTMLInputElement
const fallbackSelect = () => document.getElementById('test-occupancy-fallback') as HTMLSelectElement
const watchdogInput = () => document.getElementById('test-occupancy-watchdog') as HTMLInputElement
const predictiveCheckbox = () =>
  document.querySelector('input[type="checkbox"]') as HTMLInputElement

describe('OccupancyFields', () => {
  it('case 1: renders sensorSlot regardless of sensorConfigured', () => {
    renderFields({ sensorConfigured: true })
    expect(screen.getByTestId('sensor-slot')).toBeInTheDocument()
    cleanup()

    renderFields({ sensorConfigured: false })
    expect(screen.getByTestId('sensor-slot')).toBeInTheDocument()
  })

  it('case 2: with sensorConfigured=false, none of the five fields render', () => {
    renderFields({ sensorConfigured: false })
    expect(classSelect()).toBeNull()
    expect(screen.queryByText('Predictive occupancy')).toBeNull()
    expect(debounceInput()).toBeNull()
    expect(fallbackSelect()).toBeNull()
    expect(watchdogInput()).toBeNull()
  })

  it('case 3: with sensorConfigured=true and fallback unset, four of five render, watchdog does not', () => {
    renderFields({ sensorConfigured: true })
    expect(classSelect()).not.toBeNull()
    expect(screen.getByText('Predictive occupancy')).toBeInTheDocument()
    expect(debounceInput()).not.toBeNull()
    expect(fallbackSelect()).not.toBeNull()
    expect(watchdogInput()).toBeNull()
  })

  it('case 4: sensor-type select defaults to motion and writes occupancy_class only', () => {
    const { onChange } = renderFields({ room: { occupancy_class: undefined } })
    expect(classSelect().value).toBe('motion')
    onChange.mockClear()
    fireEvent.change(classSelect(), { target: { value: 'presence' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ occupancy_class: 'presence' })
  })

  it('case 5: predictive checkbox reflects predictive_occupancy and writes it', () => {
    const { onChange } = renderFields({ room: { predictive_occupancy: false } })
    expect(predictiveCheckbox().checked).toBe(false)
    onChange.mockClear()
    fireEvent.click(predictiveCheckbox())
    expect(onChange).toHaveBeenCalledWith({ predictive_occupancy: true })
  })

  it('case 6: debounce clamps to 600 and clears to undefined', () => {
    // Two independent renders — the field is fully controlled by `room` and
    // the mock onChange never feeds a value back in, so React restores the
    // DOM to the controlled value after each event fires. Chaining two
    // fireEvents on one instance would make the second a same-value no-op
    // that never dispatches.
    const { onChange } = renderFields({ room: { occupancy_debounce: undefined } })
    fireEvent.change(debounceInput(), { target: { value: '900' } })
    expect(onChange).toHaveBeenCalledWith({ occupancy_debounce: 600 })
    cleanup()

    const { onChange: onChangeClear } = renderFields({ room: { occupancy_debounce: 300 } })
    fireEvent.change(debounceInput(), { target: { value: '' } })
    expect(onChangeClear).toHaveBeenCalledWith({ occupancy_debounce: undefined })
  })

  it('case 7: watchdog appears only for last_known fallback, converts and clamps minutes', () => {
    const { onChange } = renderFields({
      room: { occupancy_fallback: 'last_known', last_known_timeout_s: 1800 },
    })
    expect(watchdogInput()).not.toBeNull()
    fireEvent.change(watchdogInput(), { target: { value: '45' } })
    expect(onChange).toHaveBeenCalledWith({ last_known_timeout_s: 2700 })
    cleanup()

    const { onChange: onChangeClamp } = renderFields({
      room: { occupancy_fallback: 'last_known', last_known_timeout_s: 1800 },
    })
    fireEvent.change(watchdogInput(), { target: { value: '2' } })
    expect(onChangeClamp).toHaveBeenCalledWith({ last_known_timeout_s: 300 })
  })

  it('case 8: fallback select offers exactly the three documented values', () => {
    renderFields()
    const options = Array.from(fallbackSelect().querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    )
    expect(options).toEqual(['schedule', 'occupied', 'last_known'])
  })

  it('case 9: suggestion hint renders, suppresses on match, suppresses with no evidence — never writes', () => {
    // Renders: deviceClass 'occupancy' while current class is 'motion'.
    const { onChange } = renderFields({
      room: { occupancy_class: 'motion' },
      deviceClass: 'occupancy',
    })
    expect(screen.getByText('Looks like a presence sensor.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    cleanup()

    // Suppressed: suggestion equals current effective value.
    renderFields({ room: { occupancy_class: 'motion' }, deviceClass: 'motion' })
    expect(screen.queryByText(/Looks like a/)).toBeNull()
    cleanup()

    // Suppressed: no deviceClass and no keyword in the entity id.
    renderFields({
      room: { occupancy_class: 'motion', occupancy_sensor: 'binary_sensor.lounge_thing' },
      deviceClass: undefined,
    })
    expect(screen.queryByText(/Looks like a/)).toBeNull()
  })

  it('case 10: fallback change retains the watchdog value — no second key emitted', () => {
    const { onChange } = renderFields({
      room: { occupancy_fallback: 'last_known', last_known_timeout_s: 1800 },
    })
    onChange.mockClear()
    fireEvent.change(fallbackSelect(), { target: { value: 'schedule' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ occupancy_fallback: 'schedule' })
  })
})
