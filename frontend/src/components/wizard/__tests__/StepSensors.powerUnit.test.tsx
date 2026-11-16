/**
 * INSTRUCTION-629D — the sensors step gives each MQTT power topic a unit
 * selector (W or kW), and a pick keeps the unit that the entry declares.
 */
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepSensors } from '../StepSensors'
import { useWizard } from '../../../hooks/useWizard'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    json: async () => ({ candidates: {}, total_entities: 0 }),
  } as Response))
})

afterEach(() => {
  vi.restoreAllMocks()
})

type Entry = Record<string, unknown>

function mqttConfig(inputs: Record<string, unknown>, sensors: Record<string, unknown>) {
  return {
    driver: 'mqtt',
    mqtt: { broker: 'localhost', port: 1883, inputs },
    heat_sources: [{ name: 'hp', type: 'heat_pump', sensors }],
  }
}

function unitSelect(label: string): HTMLSelectElement {
  return screen.getByLabelText(`${label} unit`) as HTMLSelectElement
}

function topicInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText)
  return label.parentElement!.querySelector('input[type="text"]') as HTMLInputElement
}

type Sources = Array<{ sensors: Record<string, Entry> }>
type MqttWrite = { broker: string; inputs: Record<string, Entry> }

function lastWrite<T>(onUpdate: ReturnType<typeof vi.fn>, section: string): T {
  const calls = onUpdate.mock.calls.filter((c) => c[0] === section)
  return calls[calls.length - 1]?.[1] as T
}

function writes(onUpdate: ReturnType<typeof vi.fn>, section: string): number {
  return onUpdate.mock.calls.filter((c) => c[0] === section).length
}

const T = 'meter/power'

describe('StepSensors — unit of an MQTT power topic (INSTRUCTION-629D)', () => {
  it('a per-source power topic with no unit shows kW, and W is stored as unit W', () => {
    const onUpdate = vi.fn()
    render(<StepSensors config={mqttConfig({}, { power_input: { topic: T, format: 'plain' } })} onUpdate={onUpdate} />)
    expect(unitSelect('Power Input').value).toBe('kW')
    fireEvent.change(unitSelect('Power Input'), { target: { value: 'W' } })
    expect(lastWrite<Sources>(onUpdate, 'heat_sources')[0].sensors.power_input).toEqual({
      topic: T, format: 'plain', unit: 'W',
    })
  })

  it('kW on a per-source power topic is stored as no unit key', () => {
    const onUpdate = vi.fn()
    const entry: Entry = { topic: T, format: 'json', json_path: 'a.b', unit: 'W' }
    render(<StepSensors config={mqttConfig({}, { heat_output: entry })} onUpdate={onUpdate} />)
    expect(unitSelect('Heat Output').value).toBe('W')
    fireEvent.change(unitSelect('Heat Output'), { target: { value: 'kW' } })
    expect(lastWrite<Sources>(onUpdate, 'heat_sources')[0].sensors.heat_output).toEqual({
      topic: T, format: 'json', json_path: 'a.b',
    })
  })

  it('a pick of a per-source power topic keeps the unit', () => {
    const onUpdate = vi.fn()
    render(
      <StepSensors
        config={mqttConfig({}, { power_input: { topic: T, format: 'plain', unit: 'W' } })}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.change(topicInput('Power Input (recommended)'), { target: { value: 'meter/new' } })
    expect(lastWrite<Sources>(onUpdate, 'heat_sources')[0].sensors.power_input).toEqual({
      topic: 'meter/new', format: 'plain', unit: 'W',
    })
  })

  it('a topic that is not a power topic has no unit selector and does not take a unit', () => {
    const onUpdate = vi.fn()
    const config = mqttConfig(
      { outdoor_temp: { topic: 'out/t', format: 'plain' } },
      {
        flow_temp: { topic: 'flow/t', format: 'plain', unit: 'W' },
        cop: { topic: 'cop/t', format: 'plain' },
      },
    )
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    expect(screen.queryByLabelText('Flow Temperature unit')).toBeNull()
    expect(screen.queryByLabelText('COP unit')).toBeNull()
    expect(screen.queryByLabelText('Outdoor Temperature unit')).toBeNull()
    fireEvent.change(topicInput('Flow Temperature (recommended)'), { target: { value: 'flow/new' } })
    expect(lastWrite<Sources>(onUpdate, 'heat_sources')[0].sensors.flow_temp).toEqual({
      topic: 'flow/new', format: 'plain',
    })
  })

  it('a power topic that is not mapped has no unit selector', () => {
    render(<StepSensors config={mqttConfig({}, {})} onUpdate={vi.fn()} />)
    expect(screen.queryByLabelText('Power Input unit')).toBeNull()
    expect(screen.queryByLabelText('Heat Output unit')).toBeNull()
    expect(screen.queryByLabelText('Pump power unit')).toBeNull()
  })

  it('a system power input shows its unit, and W is stored as unit W', () => {
    const onUpdate = vi.fn()
    const config = mqttConfig({ solar_production: { topic: 'solar/p', format: 'plain' } }, {})
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    expect(unitSelect('Solar Production').value).toBe('kW')
    fireEvent.change(unitSelect('Solar Production'), { target: { value: 'W' } })
    const written = lastWrite<MqttWrite>(onUpdate, 'mqtt')
    expect(written.inputs.solar_production).toEqual({ topic: 'solar/p', format: 'plain', unit: 'W' })
    expect(written.broker).toBe('localhost')
  })

  it('a pick of a system power input keeps the unit', () => {
    const onUpdate = vi.fn()
    const config = mqttConfig({ grid_power: { topic: 'grid/p', format: 'plain', unit: 'W' } }, {})
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    expect(unitSelect('Grid Power').value).toBe('W')
    fireEvent.change(topicInput('Grid Power'), { target: { value: 'grid/new' } })
    expect(lastWrite<MqttWrite>(onUpdate, 'mqtt').inputs.grid_power).toEqual({
      topic: 'grid/new', format: 'plain', unit: 'W',
    })
  })

  it('the battery power has a unit selector and the battery state of charge has none', () => {
    const onUpdate = vi.fn()
    const soc = { topic: 'battery/soc', format: 'plain' }
    const config = mqttConfig(
      { battery_soc: soc, battery_power: { topic: 'battery/p', format: 'plain', unit: 'W' } },
      {},
    )
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    expect(unitSelect('Battery Power').value).toBe('W')
    expect(screen.queryByLabelText('Battery SoC unit')).toBeNull()
    fireEvent.change(unitSelect('Battery Power'), { target: { value: 'kW' } })
    const written = lastWrite<MqttWrite>(onUpdate, 'mqtt')
    expect(written.inputs.battery_power).toEqual({ topic: 'battery/p', format: 'plain' })
    expect(written.inputs.battery_soc).toEqual(soc)
  })

  it('a stored unit that is not W or kW is shown with an alert, and a selection replaces it', () => {
    const onUpdate = vi.fn()
    const config = mqttConfig({ grid_power: { topic: 'grid/p', format: 'plain', unit: 'watts' } }, {})
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    expect(unitSelect('Grid Power').value).toBe('watts')
    expect(screen.getByRole('alert')).toHaveTextContent('Select W or kW.')
    fireEvent.change(unitSelect('Grid Power'), { target: { value: 'W' } })
    expect(lastWrite<MqttWrite>(onUpdate, 'mqtt').inputs.grid_power).toEqual({
      topic: 'grid/p', format: 'plain', unit: 'W',
    })
  })

  it('an old system input that declares a unit takes the unit of the slot of the primary source', () => {
    const onUpdate = vi.fn()
    const old = { topic: T, format: 'plain', unit: 'W' }
    const config = mqttConfig({ hp_power: old }, { power_input: { ...old } })
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    fireEvent.change(unitSelect('Power Input'), { target: { value: 'kW' } })
    expect(lastWrite<Sources>(onUpdate, 'heat_sources')[0].sensors.power_input).toEqual({
      topic: T, format: 'plain',
    })
    expect(lastWrite<MqttWrite>(onUpdate, 'mqtt').inputs.hp_power).toEqual({ topic: T, format: 'plain' })
  })

  it('an old system input that declares no unit is not written', () => {
    const onUpdate = vi.fn()
    const plain = { topic: T, format: 'plain' }
    const config = mqttConfig(
      { hp_power: { ...plain } },
      { power_input: { ...plain }, pump_power: { topic: 'pump/p', format: 'plain' } },
    )
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    fireEvent.change(unitSelect('Power Input'), { target: { value: 'W' } })
    fireEvent.change(unitSelect('Pump power'), { target: { value: 'W' } })
    expect(writes(onUpdate, 'mqtt')).toBe(0)
    expect(writes(onUpdate, 'heat_sources')).toBe(2)
  })

  it('a stored empty unit is shown with an alert, and a pick keeps it', () => {
    const onUpdate = vi.fn()
    const config = mqttConfig({ grid_power: { topic: 'grid/p', format: 'plain', unit: '' } }, {})
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    expect(unitSelect('Grid Power').value).toBe('""')
    expect(screen.getByRole('alert')).toHaveTextContent('Select W or kW.')
    fireEvent.change(topicInput('Grid Power'), { target: { value: 'grid/new' } })
    expect(lastWrite<MqttWrite>(onUpdate, 'mqtt').inputs.grid_power).toEqual({
      topic: 'grid/new', format: 'plain', unit: '',
    })
    fireEvent.change(unitSelect('Grid Power'), { target: { value: 'kW' } })
    expect(lastWrite<MqttWrite>(onUpdate, 'mqtt').inputs.grid_power).toEqual({ topic: 'grid/p', format: 'plain' })
  })

  it('the Home Assistant path has no unit selector', () => {
    const config = {
      driver: 'ha',
      heat_sources: [{ name: 'hp', type: 'heat_pump', sensors: { power_input: 'sensor.hp_power' } }],
      solar: { production_entity: 'sensor.solar' },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.queryByText('Unit of this topic')).toBeNull()
  })
})

const HOOK_CONFIG = mqttConfig(
  {
    hp_power: { topic: T, format: 'plain', unit: 'W' },
  },
  { power_input: { topic: T, format: 'plain', unit: 'W' } },
)

function Harness() {
  const wizard = useWizard()
  const { setConfig } = wizard
  useEffect(() => {
    setConfig(HOOK_CONFIG as never)
  }, [setConfig])
  return (
    <div>
      {wizard.config.driver === 'mqtt' && (
        <StepSensors
          config={wizard.config as Record<string, unknown>}
          onUpdate={wizard.updateConfig}
        />
      )}
      <pre data-testid="config">{JSON.stringify(wizard.config)}</pre>
    </div>
  )
}

describe('StepSensors with the wizard hook — two sections in one handler (INSTRUCTION-629D)', () => {
  it('the configuration has the unit of the slot and of the old input after one selection', () => {
    render(<Harness />)
    expect(unitSelect('Power Input').value).toBe('W')
    fireEvent.change(unitSelect('Power Input'), { target: { value: 'kW' } })
    const config = JSON.parse(screen.getByTestId('config').textContent as string)
    expect(config.heat_sources[0].sensors.power_input).toEqual({ topic: T, format: 'plain' })
    expect(config.mqtt.inputs.hp_power).toEqual({ topic: T, format: 'plain' })
    expect(config.mqtt.broker).toBe('localhost')
    expect(unitSelect('Power Input').value).toBe('kW')
  })
})
