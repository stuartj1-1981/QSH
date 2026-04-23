/**
 * INSTRUCTION-127A — HeatSourceSettings MQTT branch DHW signal parity.
 *
 * - DHW Active (primary) + DHW Active Boolean (optional OR) TopicFields render
 *   under a "Hot Water Signals" subsection on MQTT.
 * - The legacy `water_heater` TopicField row is removed.
 * - Save issues PATCH /api/config/heat_source then PATCH /api/config/mqtt
 *   with a full mqtt body whose inputs contain the new topics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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

describe('HeatSourceSettings — MQTT DHW signals (INSTRUCTION-127A)', () => {
  it('MQTT driver: DHW Active (primary) TopicField renders in Sensor Topics', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Sensor Topics'))
    expect(screen.getByText('DHW Active (primary)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('heat_pump/dhw/active')).toBeInTheDocument()
  })

  it('MQTT driver: DHW Active Boolean (optional OR) TopicField renders', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Sensor Topics'))
    expect(screen.getByText('DHW Active Boolean (optional OR)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('heat_pump/dhw/demand_bool')).toBeInTheDocument()
  })

  it('MQTT driver: legacy Water Heater TopicField is absent from the Sensor Topics section', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Sensor Topics'))
    // Scope to the Sensor Topics section — "Water Heater" must not appear here.
    const sensorHeader = screen.getByText('Sensor Topics')
    const sensorSection = sensorHeader.closest('div')
    expect(sensorSection).not.toBeNull()
    expect(within(sensorSection!).queryByText(/^Water Heater$/)).toBeNull()
    expect(screen.queryByPlaceholderText('heat_pump/water_heater')).toBeNull()
  })

  it('MQTT driver: Save issues PATCH heat_source then PATCH mqtt with full body + new topic', async () => {
    const { container } = render(
      <HeatSourceSettings
        heatSource={baseHs}
        driver="mqtt"
        mqtt={{
          broker: 'mqtt.local',
          port: 1883,
          password: '***REDACTED***',
          inputs: {
            outdoor_temp: { topic: 'sensors/outdoor_temp', format: 'plain' },
          },
        }}
        onRefetch={noop}
      />,
    )

    // Expand sensors and populate primary DHW topic.
    fireEvent.click(screen.getByText('Sensor Topics'))
    const primaryInput = screen.getByPlaceholderText('heat_pump/dhw/active') as HTMLInputElement
    fireEvent.change(primaryInput, { target: { value: 'heat_pump/dhw/active' } })

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('heat_source', expect.any(Object))
      expect(patch).toHaveBeenCalledWith('mqtt', expect.any(Object))
    })

    const mqttCall = patch.mock.calls.find(c => c[0] === 'mqtt')
    expect(mqttCall).toBeTruthy()
    const body = mqttCall![1] as Record<string, unknown>
    expect(body.broker).toBe('mqtt.local')
    expect(body.port).toBe(1883)
    expect(body.password).toBe('***REDACTED***') // UI echoes sentinel; server swaps it
    const inputs = body.inputs as Record<string, { topic: string }>
    expect(inputs.hot_water_active.topic).toBe('heat_pump/dhw/active')
    expect(inputs.outdoor_temp.topic).toBe('sensors/outdoor_temp')
    void container
  })
})
