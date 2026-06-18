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

describe('HotWaterSettings — Octopus schedule source (INSTRUCTION-351B)', () => {
  const baseProps = {
    hwPlan: 'W' as const,
    hwTank: { volume_litres: 200, target_temperature: 50 },
    heatSource: { type: 'heat_pump' as const, sensors: { water_heater: 'water_heater.main' } },
    onRefetch: () => {},
  }

  it('renders the Octopus radio only when octopusDhwAvailable is true', () => {
    const { unmount } = render(
      <HotWaterSettings {...baseProps} driver="ha" octopusDhwAvailable={true} />,
    )
    expect(screen.getByRole('radio', { name: /Octopus \(reactive/i })).toBeInTheDocument()
    unmount()

    // Non-Octopus HA install: flag false → hidden.
    const ha = render(<HotWaterSettings {...baseProps} driver="ha" octopusDhwAvailable={false} />)
    expect(screen.queryByRole('radio', { name: /Octopus \(reactive/i })).not.toBeInTheDocument()
    ha.unmount()

    // Flag undefined (prop omitted) → hidden.
    const undef = render(<HotWaterSettings {...baseProps} driver="ha" />)
    expect(screen.queryByRole('radio', { name: /Octopus \(reactive/i })).not.toBeInTheDocument()
    undef.unmount()

    // MQTT driver (flag false) → hidden.
    render(<HotWaterSettings {...baseProps} driver="mqtt" octopusDhwAvailable={false} />)
    expect(screen.queryByRole('radio', { name: /Octopus \(reactive/i })).not.toBeInTheDocument()
  })

  it('selecting Octopus sets source to octopus and hides the entity/time inputs', () => {
    render(<HotWaterSettings {...baseProps} driver="ha" octopusDhwAvailable={true} />)
    // Default source is 'fixed' → Start Time visible to begin with.
    expect(screen.getByText('Start Time')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Octopus \(reactive/i }))

    expect(screen.queryByText('Start Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Schedule Entity')).not.toBeInTheDocument()
    expect(
      screen.getByText(/QSH tracks DHW activity live from the Octopus heat-pump API/i),
    ).toBeInTheDocument()
  })

  it('Save with source=octopus patches hw_schedule with source octopus', async () => {
    render(
      <HotWaterSettings
        {...baseProps}
        hwSchedule={{ source: 'octopus' }}
        driver="ha"
        octopusDhwAvailable={true}
      />,
    )
    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => {
      const call = patchOrDelete.mock.calls.find(c => c[0] === 'hw_schedule')
      expect(call).toBeTruthy()
      expect(call![1]).toBe(true)
      expect(call![2].source).toBe('octopus')
    })
  })

  it('Hot Water Signals shows the tank-temp-only note iff source is octopus', () => {
    const note = /Water Heater Entity below is used for tank temperature only/i
    const oct = render(
      <HotWaterSettings
        {...baseProps}
        hwSchedule={{ source: 'octopus' }}
        driver="ha"
        octopusDhwAvailable={true}
      />,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    // The Water Heater Entity field itself remains visible (tank temp source).
    expect(screen.getByText('Water Heater Entity (primary)')).toBeInTheDocument()
    oct.unmount()

    render(<HotWaterSettings {...baseProps} hwSchedule={{ source: 'fixed' }} driver="ha" />)
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  it('MQTT coerces a persisted octopus source to fixed', async () => {
    render(
      <HotWaterSettings
        {...baseProps}
        hwSchedule={{ source: 'octopus', fixed_start_time: '03:00' }}
        mqtt={{ broker: 'localhost', port: 1883, inputs: {} } as MqttConfig}
        driver="mqtt"
        octopusDhwAvailable={false}
      />,
    )
    // After the coercion effect, the Fixed-time inputs are shown and the Octopus
    // schedule note is gone.
    await waitFor(() => expect(screen.getByText('Start Time')).toBeInTheDocument())
    expect(screen.queryByText(/QSH tracks DHW activity live/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => {
      const call = patchOrDelete.mock.calls.find(c => c[0] === 'hw_schedule')
      expect(call).toBeTruthy()
      expect(call![2].source).toBe('fixed')
    })
  })

  it('regression: entity/fixed radios and DHW signal fields unaffected when flag absent', () => {
    render(<HotWaterSettings {...baseProps} hwSchedule={{ source: 'fixed' }} driver="ha" />)
    expect(screen.getByRole('radio', { name: /HA entity/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Fixed time/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Octopus \(reactive/i })).not.toBeInTheDocument()
    expect(screen.getByText('Water Heater Entity (primary)')).toBeInTheDocument()
    expect(screen.getByText("Hot Water Boolean Entity (optional, OR'd)")).toBeInTheDocument()
  })
})
