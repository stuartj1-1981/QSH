/**
 * INSTRUCTION-126 — StepHotWater picker for the optional
 * hot_water_boolean slot. Renders in both HA and MQTT modes,
 * dispatches onUpdate to the correct section with undefined on clear.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../hooks/useEntityScan', () => ({
  useEntityScan: () => ({
    candidates: {
      hot_water_boolean: [
        {
          entity_id: 'binary_sensor.dhw_call',
          friendly_name: 'DHW Call',
          score: 30,
          confidence: 'high' as const,
          state: 'off',
          device_class: '',
          unit: '',
        },
      ],
    },
    totalEntities: 1,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}))

import { StepHotWater } from '../StepHotWater'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: {}, total_entities: 0 }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StepHotWater — hot_water_boolean picker', () => {
  it('HA mode: renders hot_water_boolean picker', () => {
    const config = {
      driver: 'ha' as const,
      hw_plan: 'W' as const,
      hw_tank: { volume_litres: 200, target_temperature: 50 },
      heat_source: { type: 'heat_pump' as const, sensors: {} },
    }
    render(<StepHotWater config={config} onUpdate={vi.fn()} />)
    expect(
      screen.getByText("Hot Water Boolean (optional, OR'd with water heater)"),
    ).toBeInTheDocument()
  })

  it("HA mode: picking a candidate dispatches onUpdate('heat_source', ...)", () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'ha' as const,
      hw_plan: 'W' as const,
      hw_tank: { volume_litres: 200, target_temperature: 50 },
      heat_source: {
        type: 'heat_pump' as const,
        sensors: { water_heater: 'water_heater.main' },
      },
    }
    render(<StepHotWater config={config} onUpdate={onUpdate} />)

    // Open the hot_water_boolean dropdown — its trigger button sits
    // next to the matching label.
    const label = screen.getByText("Hot Water Boolean (optional, OR'd with water heater)")
    const triggerButton = label.nextElementSibling as HTMLButtonElement
    fireEvent.click(triggerButton)

    // Click the single candidate row surfaced by the useEntityScan mock.
    fireEvent.click(screen.getByText('DHW Call'))

    const heatSourceCall = onUpdate.mock.calls.find((c) => c[0] === 'heat_source')
    expect(heatSourceCall).toBeTruthy()
    expect(heatSourceCall![1].sensors.hot_water_boolean).toBe('binary_sensor.dhw_call')
    expect(heatSourceCall![1].sensors.water_heater).toBe('water_heater.main')
  })

  it("MQTT mode: picker bound to mqtt.inputs.hot_water_boolean", () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt' as const,
      hw_plan: 'W' as const,
      hw_tank: { volume_litres: 200, target_temperature: 50 },
      mqtt: {
        broker: 'localhost',
        port: 1883,
        inputs: { hot_water_active: 'test/hw/active' } as unknown as Record<string, never>,
      },
    }
    render(<StepHotWater config={config} onUpdate={onUpdate} />)
    expect(
      screen.getByText("Hot Water Active (Boolean) Topic — optional, OR'd with water heater"),
    ).toBeInTheDocument()
  })

  it('Selecting None / Skip dispatches undefined (not empty string)', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'ha' as const,
      hw_plan: 'W' as const,
      hw_tank: { volume_litres: 200, target_temperature: 50 },
      heat_source: {
        type: 'heat_pump' as const,
        sensors: { hot_water_boolean: 'binary_sensor.dhw_call' },
      },
    }
    render(<StepHotWater config={config} onUpdate={onUpdate} />)

    const label = screen.getByText("Hot Water Boolean (optional, OR'd with water heater)")
    const triggerButton = label.nextElementSibling as HTMLButtonElement
    fireEvent.click(triggerButton)

    // The dropdown's first entry is "None / Skip" for non-required slots.
    fireEvent.click(screen.getByText('None / Skip'))

    const heatSourceCall = onUpdate.mock.calls.find((c) => c[0] === 'heat_source')
    expect(heatSourceCall).toBeTruthy()
    expect(heatSourceCall![1].sensors.hot_water_boolean).toBeUndefined()
  })
})

describe('StepHotWater water_heater picker removal (127B)', () => {
  ;(['ha', 'mqtt'] as const).forEach((driver) => {
    it(`does not render a water heater picker in ${driver} mode`, () => {
      const config = {
        driver,
        hw_plan: 'W' as const,
        hw_tank: { volume_litres: 200, target_temperature: 50 },
        heat_source: { type: 'heat_pump' as const, sensors: {} },
      }
      const { unmount } = render(<StepHotWater config={config} onUpdate={vi.fn()} />)
      expect(screen.queryByLabelText(/water heater/i)).toBeNull()
      unmount()
    })
  })
})
