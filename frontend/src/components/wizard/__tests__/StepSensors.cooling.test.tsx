/**
 * INSTRUCTION-364 — optional cooling-status sensor in the Wizard sensor step.
 *
 * MQTT: a "Cooling Status" topic in the Additional Sensors section, writing to
 *   mqtt.inputs.cooling_active (system-level, like hp_mode_state).
 * HA: a "Cooling Status" entity picker in Additional HP Sensors, writing to
 *   heat_sources[i].sensors.cooling_active.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepSensors } from '../StepSensors'
import type { EngineeringState } from '../../../types/api'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: {}, total_entities: 0 }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StepSensors — cooling-status sensor (INSTRUCTION-364)', () => {
  it('MQTT: Cooling Status topic renders under Additional Sensors', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Additional Sensors \(optional\)/i))
    expect(screen.getByText('Cooling Status')).toBeInTheDocument()
  })

  it('MQTT: editing the Cooling Status topic writes mqtt.inputs.cooling_active', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt',
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: { outdoor_temp: { topic: 'sensors/outdoor', format: 'plain' } },
      },
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/Additional Sensors \(optional\)/i))

    // TopicPicker root = the label's parent div; it holds exactly this
    // field's manual-topic input (going a level higher would grab a sibling).
    const label = screen.getByText('Cooling Status')
    const input = label.parentElement!.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'qsh/hp/cooling' } })

    expect(onUpdate).toHaveBeenCalledWith('mqtt', expect.objectContaining({
      inputs: expect.objectContaining({
        outdoor_temp: expect.objectContaining({ topic: 'sensors/outdoor' }),
        cooling_active: expect.objectContaining({ topic: 'qsh/hp/cooling' }),
      }),
    }))
  })

  it('HA: Cooling Status entity picker renders under Additional HP Sensors', () => {
    render(<StepSensors config={{ driver: 'ha' }} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Additional HP Sensors/i))
    expect(screen.getByText('Cooling Status')).toBeInTheDocument()
    expect(
      screen.getByText(/Optional binary\/mode entity that reads true when the HP is cooling/i),
    ).toBeInTheDocument()
  })

  it('HA: Cooling Status entity picker binds to heat_sources[i].sensors.cooling_active', () => {
    // The EntityPicker is a combobox (no plain typed value-input); prove the
    // mapping via the value binding (value={sensorAsString(sensors.cooling_active)}).
    // The onChange → updateSensor('cooling_active', …) write path is identical
    // to the other per-source fields already covered in StepSensors.test.tsx.
    const config = {
      driver: 'ha' as const,
      heat_sources: [
        { type: 'heat_pump' as const, name: 'HP', sensors: { cooling_active: 'binary_sensor.hp_cooling' } },
      ],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Additional HP Sensors/i))
    expect(screen.getByText('binary_sensor.hp_cooling')).toBeInTheDocument()
  })
})

describe('EngineeringState type contract (INSTRUCTION-364)', () => {
  it('carries the optional cooling_active live flag', () => {
    // Compile-time contract (tsc strict) + runtime read-back.
    const eng: EngineeringState = {
      det_flow: 35,
      rl_flow: null,
      rl_blend: 0,
      rl_reward: 0,
      shoulder_monitoring: false,
      summer_monitoring: false,
      cooling_active: true,
    }
    expect(eng.cooling_active).toBe(true)
  })
})
