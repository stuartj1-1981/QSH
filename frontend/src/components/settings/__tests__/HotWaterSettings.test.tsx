/**
 * INSTRUCTION-236 — DHW signal inputs consolidated under Settings → Hot Water.
 * Covers the relocated "Hot Water Signals" sub-block (HA + MQTT) and the
 * MqttTopicInput-shape migration for legacy bare-string mqtt.inputs values.
 *
 * Originally INSTRUCTION-126 (hot_water_boolean field) — the prior coverage
 * is retained where still applicable and extended for the primary signal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { MqttConfig } from '../../../types/config'

const patchOrDelete = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: (...args: unknown[]) => patchOrDelete(...args),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HotWaterSettings } from '../HotWaterSettings'

beforeEach(() => {
  patchOrDelete.mockReset()
  patchOrDelete.mockResolvedValue({})
})

describe('HotWaterSettings — DHW signals (INSTRUCTION-236)', () => {
  it('HA driver: renders both DHW signal fields under Hot Water Signals', () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        heatSource={{
          type: 'heat_pump',
          sensors: { water_heater: 'water_heater.main' },
        }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    expect(screen.getByText('Hot Water Signals')).toBeInTheDocument()
    expect(screen.getByText('Water Heater Entity (primary)')).toBeInTheDocument()
    expect(screen.getByText("Hot Water Boolean Entity (optional, OR'd)")).toBeInTheDocument()
  })

  it('HA driver: Save dispatches PATCH heat_source preserving existing sensors and writing both DHW signals', async () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        heatSource={{
          type: 'heat_pump',
          sensors: {
            water_heater: 'water_heater.main',
            flow_temp: 'sensor.flow_temp',
            hot_water_boolean: 'binary_sensor.dhw_call',
          },
        }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => {
      const heatSourceCall = patchOrDelete.mock.calls.find(
        (c) => c[0] === 'heat_source',
      )
      expect(heatSourceCall).toBeTruthy()
      const payload = heatSourceCall![2]
      expect(payload.sensors.hot_water_boolean).toBe('binary_sensor.dhw_call')
      expect(payload.sensors.water_heater).toBe('water_heater.main')
      expect(payload.sensors.flow_temp).toBe('sensor.flow_temp')
      expect(payload.type).toBe('heat_pump')
    })
    expect(patchOrDelete.mock.calls.length).toBe(5)
  })

  it('HA driver: Save writes both water_heater and hot_water_boolean to heat_source.sensors', async () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        heatSource={{ type: 'heat_pump', sensors: {} }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )

    const waterHeater = screen.getByPlaceholderText('water_heater.heat_pump') as HTMLInputElement
    const boolean = screen.getByPlaceholderText('binary_sensor.hw_demand') as HTMLInputElement
    fireEvent.change(waterHeater, { target: { value: 'water_heater.main' } })
    fireEvent.change(boolean, { target: { value: 'binary_sensor.dhw_call' } })

    const saveButton = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      const heatSourceCall = patchOrDelete.mock.calls.find(c => c[0] === 'heat_source')
      expect(heatSourceCall).toBeDefined()
      expect(heatSourceCall![2].sensors.water_heater).toBe('water_heater.main')
      expect(heatSourceCall![2].sensors.hot_water_boolean).toBe('binary_sensor.dhw_call')
    })
  })

  it('MQTT driver: Save writes hot_water_active and hot_water_boolean to mqtt.inputs in object form', async () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        heatSource={{ type: 'heat_pump' }}
        mqtt={{ broker: 'localhost', port: 1883, inputs: {} } as MqttConfig}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )

    const active = screen.getByPlaceholderText('heat_pump/dhw/active') as HTMLInputElement
    const boolean = screen.getByPlaceholderText('heat_pump/dhw/demand_bool') as HTMLInputElement
    fireEvent.change(active, { target: { value: 'qsh/dhw/active' } })
    fireEvent.change(boolean, { target: { value: 'qsh/dhw/demand' } })

    const saveButton = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      const mqttCall = patchOrDelete.mock.calls.find(c => c[0] === 'mqtt')
      expect(mqttCall).toBeDefined()
      expect(mqttCall![2].inputs.hot_water_active).toEqual({ topic: 'qsh/dhw/active', format: 'plain' })
      expect(mqttCall![2].inputs.hot_water_boolean).toEqual({ topic: 'qsh/dhw/demand', format: 'plain' })
    })
  })

  it('MQTT driver: bare-string hot_water_boolean from props round-trips as object after save', async () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        heatSource={{ type: 'heat_pump' }}
        mqtt={{
          broker: 'localhost',
          port: 1883,
          // Legacy shape from pre-INSTRUCTION-236 saves.
          inputs: { hot_water_boolean: 'legacy/topic/string' },
        } as unknown as MqttConfig}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      const mqttCall = patchOrDelete.mock.calls.find(c => c[0] === 'mqtt')
      expect(mqttCall).toBeDefined()
      expect(mqttCall![2].inputs.hot_water_boolean).toEqual({ topic: 'legacy/topic/string', format: 'plain' })
    })
  })

  it('MQTT driver: bare-string hot_water_active from props round-trips as object after save', async () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        heatSource={{ type: 'heat_pump' }}
        mqtt={{
          broker: 'localhost',
          port: 1883,
          // Legacy / hand-edited YAML shape.
          inputs: { hot_water_active: 'legacy/active/topic' },
        } as unknown as MqttConfig}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      const mqttCall = patchOrDelete.mock.calls.find(c => c[0] === 'mqtt')
      expect(mqttCall).toBeDefined()
      expect(mqttCall![2].inputs.hot_water_active).toEqual({ topic: 'legacy/active/topic', format: 'plain' })
    })
  })
})
