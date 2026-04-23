/**
 * INSTRUCTION-126 — HotWaterSettings page: hot_water_boolean field and
 * its deterministic full-section save path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

describe('HotWaterSettings — hot_water_boolean', () => {
  it("HA driver: renders the Hot Water Boolean field", () => {
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
    expect(screen.getByText('Hot Water Boolean (optional)')).toBeInTheDocument()
  })

  it('HA driver: Save dispatches PATCH heat_source preserving existing sensors', async () => {
    const { container } = render(
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

    // Click Save Changes.
    const saveButton = screen.getByText('Save Changes')
    fireEvent.click(saveButton)

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
    // The heat_source PATCH is the extra section, so expect 5 total.
    expect(patchOrDelete.mock.calls.length).toBe(5)
    void container
  })

  it('MQTT driver: Save dispatches PATCH mqtt preserving existing inputs', async () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50 }}
        mqtt={{
          broker: 'localhost',
          port: 1883,
          inputs: {
            hot_water_active: 'existing/topic',
            hot_water_boolean: 'qsh/hw/boolean',
          } as unknown as Record<string, never>,
        }}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => {
      const mqttCall = patchOrDelete.mock.calls.find((c) => c[0] === 'mqtt')
      expect(mqttCall).toBeTruthy()
      const payload = mqttCall![2]
      expect(payload.inputs.hot_water_boolean).toBe('qsh/hw/boolean')
      expect(payload.inputs.hot_water_active).toBe('existing/topic')
      expect(payload.broker).toBe('localhost')
      expect(payload.port).toBe(1883)
    })
  })
})
