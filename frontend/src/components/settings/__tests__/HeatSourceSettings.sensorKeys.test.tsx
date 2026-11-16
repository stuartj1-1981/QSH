/**
 * INSTRUCTION-629F — the heat source save of Settings keeps the keys of an
 * MQTT sensor entry in its mapping form (format, json_path, unit) when the
 * user changes its topic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { patchMock } = vi.hoisted(() => ({
  patchMock: vi.fn(),
}))

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const noop = () => {}

type Sensors = Record<string, unknown>

beforeEach(() => {
  patchMock.mockReset()
  patchMock.mockResolvedValue({ updated: 'ok' })
})

function renderMqtt(sensors: Sensors, type: string = 'heat_pump') {
  render(
    <HeatSourceSettings
      heatSource={{ type, name: 'src', efficiency: 3.5, sensors } as never}
      driver="mqtt"
      mqtt={{ broker: 'localhost', port: 1883, inputs: {} } as never}
      onRefetch={noop}
    />,
  )
  fireEvent.click(screen.getByText('Sensor Topics'))
}

function field(label: string): HTMLInputElement {
  return screen.getByText(label).parentElement!.querySelector('input[type="text"]') as HTMLInputElement
}

async function savedSensors(): Promise<Sensors> {
  fireEvent.click(screen.getByLabelText('Save source 1'))
  await waitFor(() => expect(patchMock).toHaveBeenCalled())
  const call = patchMock.mock.calls[patchMock.mock.calls.length - 1]
  expect(call[0]).toBe('heat_sources')
  return (call[1] as Array<{ sensors: Sensors }>)[0].sensors
}

const JSON_POWER = { topic: 'hp/state', format: 'json', json_path: 'power', unit: 'W' }

describe('HeatSourceSettings — an MQTT sensor entry keeps its keys (INSTRUCTION-629F)', () => {
  it('a change of the topic of a mapping entry keeps format, json_path and unit', async () => {
    renderMqtt({ power_input: { ...JSON_POWER } })
    expect(field('Power Input').value).toBe('hp/state')
    fireEvent.change(field('Power Input'), { target: { value: 'hp/state2' } })
    const sensors = await savedSensors()
    expect(sensors.power_input).toEqual({
      topic: 'hp/state2', format: 'json', json_path: 'power', unit: 'W',
    })
  })

  it('two changes of one field keep the keys', async () => {
    renderMqtt({ heat_output: { topic: 'hp/out', format: 'plain', unit: 'W' } })
    fireEvent.change(field('Heat Output'), { target: { value: 'hp/out2' } })
    fireEvent.change(field('Heat Output'), { target: { value: 'hp/out3' } })
    const sensors = await savedSensors()
    expect(sensors.heat_output).toEqual({ topic: 'hp/out3', format: 'plain', unit: 'W' })
  })

  it('the pump power row of a boiler keeps the keys also', async () => {
    renderMqtt({ pump_power: { topic: 'b/pump', format: 'plain', unit: 'W' } }, 'gas_boiler')
    fireEvent.change(field('Pump power'), { target: { value: 'b/pump2' } })
    const sensors = await savedSensors()
    expect(sensors.pump_power).toEqual({ topic: 'b/pump2', format: 'plain', unit: 'W' })
  })

  it('a field that the user empties and fills again keeps the keys of the last save', async () => {
    renderMqtt({ power_input: { ...JSON_POWER } })
    fireEvent.change(field('Power Input'), { target: { value: '' } })
    fireEvent.change(field('Power Input'), { target: { value: 'hp/state2' } })
    const sensors = await savedSensors()
    expect(sensors.power_input).toEqual({
      topic: 'hp/state2', format: 'json', json_path: 'power', unit: 'W',
    })
  })

  it('a string entry stays a string', async () => {
    renderMqtt({ flow_temp: 'hp/flow' })
    fireEvent.change(field('Flow Temperature'), { target: { value: 'hp/flow2' } })
    const sensors = await savedSensors()
    expect(sensors.flow_temp).toBe('hp/flow2')
  })

  it('a new entry is the text of the field', async () => {
    renderMqtt({})
    fireEvent.change(field('Return Temperature'), { target: { value: 'hp/return' } })
    const sensors = await savedSensors()
    expect(sensors.return_temp).toBe('hp/return')
  })

  it('an empty field removes a mapping entry', async () => {
    renderMqtt({
      power_input: { ...JSON_POWER },
      flow_temp: { topic: 'hp/flow', format: 'plain' },
    })
    fireEvent.change(field('Power Input'), { target: { value: '' } })
    const sensors = await savedSensors()
    expect(sensors.power_input).toBeUndefined()
    expect(sensors.flow_temp).toEqual({ topic: 'hp/flow', format: 'plain' })
  })

  it('an entry that the user does not change is saved as it is', async () => {
    renderMqtt({ power_input: { ...JSON_POWER }, flow_temp: 'hp/flow' })
    fireEvent.change(field('Flow Temperature'), { target: { value: 'hp/flow2' } })
    const sensors = await savedSensors()
    expect(sensors.power_input).toEqual(JSON_POWER)
  })

  it('on the Home Assistant driver an entity field writes the text', async () => {
    render(
      <HeatSourceSettings
        heatSource={{
          type: 'heat_pump', name: 'src', efficiency: 3.5,
          sensors: { power_input: 'sensor.hp_power' },
        } as never}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Sensor Entities'))
    const input = screen.getByDisplayValue('sensor.hp_power')
    fireEvent.change(input, { target: { value: 'sensor.hp_power_2' } })
    const sensors = await savedSensors()
    expect(sensors.power_input).toBe('sensor.hp_power_2')
  })
})
