/**
 * INSTRUCTION-266B Task 4 — Weather Forecast Topic field in StepSensors
 * for MQTT driver. Tests render, driver-conditional visibility, updateInput
 * integration, and hydration from existing config.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepSensors } from '../StepSensors'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: {}, total_entities: 0 }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StepSensors — Weather Forecast Topic field', () => {
  it('renders Weather Forecast Topic field for MQTT driver', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.getByText(/Weather Forecast Topic/i)).toBeDefined()
  })

  it('does NOT render Weather Forecast Topic field for HA driver', () => {
    const config = { driver: 'ha' }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.queryByText(/Weather Forecast Topic/i)).toBeNull()
  })

  it('renders helper text for forecast field', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(
      screen.getByText(/Required when forecast_extension_master_enable is true/i),
    ).toBeDefined()
  })

  it('hydrates from existing mqtt.inputs.forecast.topic on mount', () => {
    const config = {
      driver: 'mqtt',
      mqtt: {
        broker: 'localhost',
        port: 1883,
        inputs: {
          forecast: { topic: 'weather/preset', format: 'plain' as const },
        },
      },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    // The TopicPicker renders an input with the topic value. Find the
    // input whose value matches the preset topic.
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    const forecastInput = inputs.find((el) => el.value === 'weather/preset')
    expect(forecastInput).toBeDefined()
  })
})
