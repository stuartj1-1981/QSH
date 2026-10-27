/**
 * INSTRUCTION-606C — Settings › Solar & Battery takes the battery power input
 * (HA entity, MQTT topic), the sign option and the price of battery energy.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

import { patchOrDelete } from '../../../hooks/useConfig'

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

vi.mock('../../../hooks/useSysid', () => ({
  useSysid: () => ({ data: null, error: null }),
}))

import { SolarBatterySettings } from '../SolarBatterySettings'

const noop = () => {}

const getCheckbox = (labelText: string): HTMLInputElement => {
  const label = screen.getByText(labelText).closest('label') as HTMLLabelElement
  return label.querySelector('input[type="checkbox"]') as HTMLInputElement
}

// By id: the help tip's text also names the price, so a label query finds two.
const priceInput = (): HTMLInputElement => {
  const el = document.getElementById('battery-stored-energy-rate')
  expect(el).not.toBeNull()
  return el as HTMLInputElement
}

// Save, then return the body of the last battery PATCH. A cleared field sets
// its key to undefined, which JSON.stringify drops from the request body.
const saveBattery = async (): Promise<Record<string, unknown>> => {
  vi.mocked(patchOrDelete).mockClear()
  fireEvent.click(screen.getByText('Save Changes'))
  await waitFor(() => {
    expect(vi.mocked(patchOrDelete).mock.calls.some((c) => c[0] === 'battery')).toBe(true)
  })
  const calls = vi.mocked(patchOrDelete).mock.calls.filter((c) => c[0] === 'battery')
  const last = calls[calls.length - 1]
  expect(last[1]).toBe(true)
  return last[2] as Record<string, unknown>
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.mocked(patchOrDelete).mockClear().mockResolvedValue({})
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
  vi.stubGlobal('fetch', fetchMock)
})

describe('SolarBatterySettings — battery power input (INSTRUCTION-606C)', () => {
  it('HA: renders the power entity field and saves it', async () => {
    render(<SolarBatterySettings battery={{ soc_entity: 'sensor.b' }} driver="ha" onRefetch={noop} />)
    expect(screen.getByText('Battery Power Entity')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('sensor.battery_power'), {
      target: { value: 'sensor.bp' },
    })
    const body = await saveBattery()
    expect(body.power_entity).toBe('sensor.bp')
    expect(body.soc_entity).toBe('sensor.b')
  })

  it('MQTT: renders the power topic and writes mqtt.inputs.battery_power', async () => {
    render(
      <SolarBatterySettings
        mqtt={{ broker: 'x', port: 1883, inputs: { battery_soc: { topic: 'battery/soc' } } }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Battery Power Topic')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('battery/power_kw'), {
      target: { value: 'battery/power' },
    })
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const mqttCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('config/mqtt'))
    expect(mqttCall).toBeTruthy()
    const data = JSON.parse((mqttCall![1] as RequestInit).body as string).data
    expect(data.inputs.battery_power).toBe('battery/power')
    expect(data.inputs.battery_soc).toEqual({ topic: 'battery/soc' })
  })

  it('invert and price write only when set', async () => {
    const { unmount } = render(
      <SolarBatterySettings battery={{ soc_entity: 'sensor.b' }} driver="ha" onRefetch={noop} />
    )
    let body = await saveBattery()
    // OB-04: absent from the loaded section, absent from the body.
    expect(body).not.toHaveProperty('power_invert')
    expect(body).not.toHaveProperty('stored_energy_rate_gbp_per_kwh')
    unmount()

    // Loaded values are kept as loaded.
    const loaded = render(
      <SolarBatterySettings
        battery={{ soc_entity: 'sensor.b', power_invert: true, stored_energy_rate_gbp_per_kwh: 0.08 }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(priceInput().value).toBe('0.08')
    body = await saveBattery()
    expect(body.power_invert).toBe(true)
    expect(body.stored_energy_rate_gbp_per_kwh).toBe(0.08)
    loaded.unmount()

    render(<SolarBatterySettings battery={{ soc_entity: 'sensor.b' }} driver="ha" onRefetch={noop} />)
    fireEvent.click(getCheckbox('Sensor reads positive while charging'))
    fireEvent.change(priceInput(), { target: { value: '0.08' } })
    body = await saveBattery()
    expect(body.power_invert).toBe(true)
    expect(body.stored_energy_rate_gbp_per_kwh).toBe(0.08)

    fireEvent.change(priceInput(), { target: { value: '0' } })
    body = await saveBattery()
    expect(body.stored_energy_rate_gbp_per_kwh).toBe(0)

    fireEvent.change(priceInput(), { target: { value: '2.0' } })
    body = await saveBattery()
    expect(body.stored_energy_rate_gbp_per_kwh).toBe(2)

    fireEvent.change(priceInput(), { target: { value: '' } })
    body = await saveBattery()
    expect(body.stored_energy_rate_gbp_per_kwh).toBeUndefined()

    fireEvent.click(getCheckbox('Sensor reads positive while charging'))
    body = await saveBattery()
    expect(body.power_invert).toBeUndefined()
  })

  it('a price outside [0, 2.0] is not written', async () => {
    render(<SolarBatterySettings battery={{ soc_entity: 'sensor.b' }} driver="ha" onRefetch={noop} />)

    fireEvent.change(priceInput(), { target: { value: '-1' } })
    expect(priceInput().value).toBe('-1')
    let body = await saveBattery()
    expect(body.stored_energy_rate_gbp_per_kwh).toBeUndefined()

    fireEvent.change(priceInput(), { target: { value: '2.5' } })
    expect(priceInput().value).toBe('2.5')
    expect(screen.getByText(/Above £2\.00\/kWh/)).toBeInTheDocument()
    body = await saveBattery()
    expect(body.stored_energy_rate_gbp_per_kwh).toBeUndefined()

    // jsdom gives a type="number" input '' for text that is not a number.
    fireEvent.change(priceInput(), { target: { value: 'abc' } })
    expect(priceInput().value).toBe('')
    body = await saveBattery()
    expect(body.stored_energy_rate_gbp_per_kwh).toBeUndefined()
  })
})
