/**
 * INSTRUCTION-575H — the wizard sensors step carries the hydraulic
 * protection fields for the primary heat source (heat_sources[0]), on both
 * drivers. Values are written to heat_sources[0] only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepSensors } from '../StepSensors'

beforeEach(() => {
  // useEntityScan auto-fires on mount (INSTRUCTION-90C); stub the fetch.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: {}, total_entities: 0 }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const rooms = {
  lounge: { area_m2: 20 },
  bedroom: { area_m2: 12 },
}

function lastHeatSources(onUpdate: ReturnType<typeof vi.fn>) {
  const calls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_sources')
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][1] as Array<Record<string, unknown>>
}

describe('StepSensors — hydraulic protection (HA)', () => {
  it('hides the minimum flow rate until a flow-rate sensor is set', () => {
    render(
      <StepSensors
        config={{ driver: 'ha', rooms, heat_sources: [{ type: 'heat_pump', name: 'hp' }] }}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Hydraulic protection/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Minimum flow rate/)).toBeNull()
  })

  it('requires the minimum flow rate when a flow-rate sensor is set and writes heat_sources[0]', () => {
    const onUpdate = vi.fn()
    render(
      <StepSensors
        config={{
          driver: 'ha',
          rooms,
          heat_sources: [
            { type: 'heat_pump', name: 'hp', sensors: { flow_rate: 'sensor.hp_flow_rate' } },
          ],
        }}
        onUpdate={onUpdate}
      />,
    )
    const input = screen.getByLabelText(/Minimum flow rate/) as HTMLInputElement
    expect(input.required).toBe(true)
    fireEvent.change(input, { target: { value: '11.5' } })
    const sources = lastHeatSources(onUpdate)
    expect(sources).toHaveLength(1)
    expect(sources[0].min_flow_rate).toBe(11.5)
    expect(sources[0].sensors).toEqual({ flow_rate: 'sensor.hp_flow_rate' })
  })

  it('writes bypass rooms and setpoint to heat_sources[0]', () => {
    const onUpdate = vi.fn()
    render(
      <StepSensors
        config={{ driver: 'ha', rooms, heat_sources: [{ type: 'heat_pump', name: 'hp' }] }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'bedroom' }))
    expect(lastHeatSources(onUpdate)[0].bypass_rooms).toEqual(['bedroom'])
    fireEvent.change(screen.getByLabelText(/Bypass room setpoint/), { target: { value: '26' } })
    expect(lastHeatSources(onUpdate)[0].bypass_setpoint).toBe(26)
  })

  it('shows the fields on the primary tab only', () => {
    const onUpdate = vi.fn()
    render(
      <StepSensors
        config={{
          driver: 'ha',
          rooms,
          heat_sources: [
            { type: 'heat_pump', name: 'hp' },
            { type: 'gas_boiler', name: 'boiler' },
          ],
        }}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByText(/Hydraulic protection/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('tab')[1])
    expect(screen.queryByText(/Hydraulic protection/)).toBeNull()
  })
})

describe('StepSensors — hydraulic protection (MQTT)', () => {
  it('requires the minimum flow rate when a flow-rate topic is set and writes heat_sources[0]', () => {
    const onUpdate = vi.fn()
    render(
      <StepSensors
        config={{
          driver: 'mqtt',
          rooms,
          mqtt: { broker: 'localhost', port: 1883, inputs: {} },
          heat_sources: [
            {
              type: 'heat_pump',
              name: 'hp',
              sensors: { flow_rate: { topic: 'hp/flow_rate', format: 'plain' } },
            },
          ],
        }}
        onUpdate={onUpdate}
      />,
    )
    const input = screen.getByLabelText(/Minimum flow rate/) as HTMLInputElement
    expect(input.required).toBe(true)
    fireEvent.change(input, { target: { value: '10' } })
    expect(lastHeatSources(onUpdate)[0].min_flow_rate).toBe(10)
  })
})
