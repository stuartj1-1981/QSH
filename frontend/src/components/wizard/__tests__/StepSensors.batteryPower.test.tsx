/**
 * INSTRUCTION-606C — the wizard sensor step takes the home battery power
 * input: an HA entity picker writing battery.power_entity, and an MQTT topic
 * writing mqtt.inputs.battery_power. "No" clears both battery topics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepSensors } from '../StepSensors'

let candidates: Record<string, unknown[]> = {}

beforeEach(() => {
  candidates = {}
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    json: async () => ({ candidates, total_entities: 1 }),
  } as Response))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StepSensors — battery power input (INSTRUCTION-606C)', () => {
  it('HA: Battery Power picker renders and writes battery.power_entity', async () => {
    candidates = {
      battery_power: [
        { entity_id: 'sensor.battery_power', friendly_name: 'Battery Power', state: '0.4', unit: 'kW', score: 90, confidence: 'high' },
      ],
    }
    const onUpdate = vi.fn()
    const config = { driver: 'ha', battery: { soc_entity: 'sensor.battery_soc' } }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    expect(screen.getByText('Battery Power')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Select battery power...'))
    const option = await screen.findByText('sensor.battery_power')
    fireEvent.click(option.closest('button') as HTMLButtonElement)

    expect(onUpdate).toHaveBeenCalledWith('battery', {
      soc_entity: 'sensor.battery_soc',
      power_entity: 'sensor.battery_power',
    })
  })

  it('MQTT: Battery Power topic writes mqtt.inputs.battery_power', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: { battery_soc: { topic: 'battery/soc' } } },
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    const label = screen.getByText('Battery Power')
    const input = label.parentElement!.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'battery/power' } })

    expect(onUpdate).toHaveBeenCalledWith('mqtt', expect.objectContaining({
      inputs: expect.objectContaining({
        battery_soc: expect.objectContaining({ topic: 'battery/soc' }),
        battery_power: expect.objectContaining({ topic: 'battery/power' }),
      }),
    }))
  })

  it('MQTT: No clears both battery topics', async () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt',
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: { battery_soc: { topic: 'battery/soc' }, battery_power: { topic: 'battery/power' } },
      },
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    const question = screen.getByText('Do you have a home battery?')
    const row = question.parentElement as HTMLElement
    const no = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'No')!
    fireEvent.click(no)

    await waitFor(() => {
      expect(onUpdate.mock.calls.some((c) => c[0] === 'mqtt')).toBe(true)
    })
    const mqttCalls = onUpdate.mock.calls.filter((c) => c[0] === 'mqtt')
    const inputs = (mqttCalls[mqttCalls.length - 1][1] as { inputs: Record<string, unknown> }).inputs
    expect(inputs).not.toHaveProperty('battery_soc')
    expect(inputs).not.toHaveProperty('battery_power')
  })
})
