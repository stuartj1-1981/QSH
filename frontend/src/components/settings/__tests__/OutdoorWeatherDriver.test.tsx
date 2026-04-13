import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

vi.mock('../../../hooks/useMqttTopicScan', () => ({
  useMqttTopicScan: () => ({ topics: [], loading: false, error: null, scan: vi.fn() }),
}))

// Mock fetch for MQTT save
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ updated: 'mqtt' }),
})
vi.stubGlobal('fetch', mockFetch)

import { OutdoorWeatherSettings } from '../OutdoorWeatherSettings'

const noop = () => {}

describe('OutdoorWeatherSettings driver branching', () => {
  it('HA driver: renders EntityField, no TopicField', () => {
    render(
      <OutdoorWeatherSettings
        outdoor={{ temperature: 'sensor.outdoor_temp' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Outdoor Temperature Sensor')).toBeInTheDocument()
    expect(screen.getByText('Weather Forecast Entity')).toBeInTheDocument()
    expect(screen.queryByText('Outdoor Temperature Topic')).toBeNull()
  })

  it('MQTT driver: renders TopicField, no EntityField', () => {
    render(
      <OutdoorWeatherSettings
        outdoor={{}}
        mqtt={{ broker: 'localhost', port: 1883, inputs: { outdoor_temp: { topic: 'temps/outside' } } }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Outdoor Temperature Topic')).toBeInTheDocument()
    expect(screen.queryByText('Outdoor Temperature Sensor')).toBeNull()
    expect(screen.queryByText('Weather Forecast Entity')).toBeNull()
    // Shows the HA-only note for weather forecast
    expect(screen.getByText(/Weather forecast integration is HA-driver-only/)).toBeInTheDocument()
  })

  it('MQTT driver: displays topic from mqtt.inputs.outdoor_temp', () => {
    render(
      <OutdoorWeatherSettings
        outdoor={{}}
        mqtt={{ broker: 'localhost', port: 1883, inputs: { outdoor_temp: { topic: 'temps/outsideTemp' } } }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByDisplayValue('temps/outsideTemp')).toBeInTheDocument()
  })

  it('MQTT driver: save targets mqtt section with full object', async () => {
    mockFetch.mockClear()
    const refetch = vi.fn()
    render(
      <OutdoorWeatherSettings
        outdoor={{}}
        mqtt={{ broker: 'test-broker', port: 1883, inputs: { outdoor_temp: { topic: 'old/topic' } } }}
        driver="mqtt"
        onRefetch={refetch}
      />
    )

    // Edit the topic
    const input = screen.getByDisplayValue('old/topic')
    fireEvent.change(input, { target: { value: 'new/topic' } })

    // Click save
    fireEvent.click(screen.getByText('Save Changes'))

    // Wait for async save
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api/config/mqtt'),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"new/topic"'),
        })
      )
    })

    // Verify the payload preserves broker config
    const call = mockFetch.mock.calls.find(c => String(c[0]).includes('api/config/mqtt'))
    const body = JSON.parse(call![1].body)
    expect(body.data.broker).toBe('test-broker')
    expect(body.data.port).toBe(1883)
    expect(body.data.inputs.outdoor_temp.topic).toBe('new/topic')
  })
})
