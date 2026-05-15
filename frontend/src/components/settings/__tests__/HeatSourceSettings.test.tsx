/**
 * INSTRUCTION-236 — HeatSourceSettings is positively non-authoritative for
 * DHW signal keys (water_heater, hot_water_active, hot_water_boolean). The
 * fields are relocated to HotWaterSettings; HeatSourceSettings must NOT
 * render them and MUST NOT write them in its save payload, even when a
 * stale prop carries DHW values.
 *
 * Originally INSTRUCTION-127A (MQTT DHW signal parity inside HeatSourceSettings);
 * that contract is retired by INSTRUCTION-236.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { MqttConfig } from '../../../types/config'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const noop = () => {}
const baseHs = { type: 'heat_pump' as const, efficiency: 3.5 }

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'ok' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HeatSourceSettings — DHW relocation (INSTRUCTION-236)', () => {
  it('DHW signal fields are absent from the sensor section in both drivers', () => {
    ;(['ha', 'mqtt'] as const).forEach((driver) => {
      const { unmount } = render(
        <HeatSourceSettings
          heatSource={baseHs}
          driver={driver}
          mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
          onRefetch={noop}
        />,
      )
      fireEvent.click(screen.getByText(driver === 'mqtt' ? 'Sensor Topics' : 'Sensor Entities'))

      // HA: Water Heater EntityField removed.
      expect(screen.queryByText(/^Water Heater$/)).toBeNull()
      expect(screen.queryByPlaceholderText('water_heater.heat_pump')).toBeNull()

      // MQTT: Hot Water Signals sub-block (DHW Active primary + boolean) removed.
      expect(screen.queryByText('Hot Water Signals')).toBeNull()
      expect(screen.queryByText('DHW Active (primary)')).toBeNull()
      expect(screen.queryByText('DHW Active Boolean (optional OR)')).toBeNull()
      expect(screen.queryByPlaceholderText('heat_pump/dhw/active')).toBeNull()
      expect(screen.queryByPlaceholderText('heat_pump/dhw/demand_bool')).toBeNull()

      unmount()
    })
  })

  it('HeatSourceSettings save never includes DHW keys in patch payload, regardless of prop state', async () => {
    render(
      <HeatSourceSettings
        heatSource={{
          type: 'heat_pump',
          efficiency: 3.5,
          flow_min: 25,
          flow_max: 50,
          sensors: {
            // Stale prop carries DHW keys from a pre-236 save or a concurrent
            // HotWaterSettings tab. The HeatSource save MUST omit them.
            flow_temp: 'sensor.hp_flow_temp',
            water_heater: 'water_heater.STALE_VALUE',
            hot_water_boolean: 'binary_sensor.STALE_VALUE',
          },
        }}
        mqtt={{
          broker: 'localhost',
          port: 1883,
          // Stale MQTT prop too — though HeatSource no longer writes mqtt, prove it.
          inputs: {
            hot_water_active: { topic: 'qsh/dhw/STALE', format: 'plain' },
            hot_water_boolean: { topic: 'qsh/dhw/STALE2', format: 'plain' },
          },
        } as MqttConfig}
        driver="ha"
        onRefetch={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      const hsCall = patch.mock.calls.find(c => c[0] === 'heat_source')
      expect(hsCall).toBeDefined()
    })

    const hsCall = patch.mock.calls.find(c => c[0] === 'heat_source')!
    const body = hsCall[1] as { sensors?: Record<string, unknown> }
    // Non-DHW sensor preserved.
    expect(body.sensors?.flow_temp).toBe('sensor.hp_flow_temp')
    // DHW keys explicitly omitted by the destructure in HeatSourceSettings.save().
    expect(body.sensors?.water_heater).toBeUndefined()
    expect(body.sensors?.hot_water_boolean).toBeUndefined()
    // No MQTT patch fired — the entire branch was deleted.
    const mqttCall = patch.mock.calls.find(c => c[0] === 'mqtt')
    expect(mqttCall).toBeUndefined()
  })

  it('MQTT driver: HeatSourceSettings save does not patch mqtt at all (DHW writes owned by HotWaterSettings)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        driver="mqtt"
        mqtt={{
          broker: 'mqtt.local',
          port: 1883,
          inputs: {
            hot_water_active: { topic: 'existing/active', format: 'plain' },
            outdoor_temp: { topic: 'sensors/outdoor_temp', format: 'plain' },
          },
        }}
        onRefetch={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('heat_source', expect.any(Object))
    })
    // Crucial: no mqtt patch is fired from HeatSourceSettings.
    expect(patch.mock.calls.find(c => c[0] === 'mqtt')).toBeUndefined()
  })
})
