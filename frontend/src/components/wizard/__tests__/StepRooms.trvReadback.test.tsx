/**
 * INSTRUCTION-627B T7(c) — the wizard's TRV Setpoint Readback field, the
 * default control mode and the auxiliary step: cases (W1) to (W7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepRooms } from '../StepRooms'
import { StepAuxOutputs } from '../StepAuxOutputs'
import type { RoomConfigYaml } from '../../../types/config'

beforeEach(() => {
  // StepAuxOutputs resolves entities with a fetch on the HA driver; stub it.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ entities: {} }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const LABEL = 'TRV Setpoint Readback (optional)'

const ENSUITE: RoomConfigYaml = {
  area_m2: 6,
  facing: 'N',
  ceiling_m: 2.4,
  control_mode: 'indirect',
}

function renderStep(driver: 'mqtt' | 'ha', room: RoomConfigYaml = ENSUITE) {
  const onUpdate = vi.fn()
  render(<StepRooms config={{ driver, rooms: { ensuite: room } }} onUpdate={onUpdate} />)
  fireEvent.click(screen.getByText('ensuite'))
  return onUpdate
}

function lastEnsuite(onUpdate: ReturnType<typeof vi.fn>): RoomConfigYaml {
  const lastCall = onUpdate.mock.calls.at(-1)
  expect(lastCall).toBeDefined()
  expect(lastCall![0]).toBe('rooms')
  return (lastCall![1] as Record<string, RoomConfigYaml>).ensuite
}

const readbackInput = () =>
  screen.getByText(LABEL).closest('div')!.querySelector('input[type="text"]') as HTMLInputElement
const controlModeValue = () =>
  (screen.getByText('Control Mode').parentElement!.querySelector('select') as HTMLSelectElement).value

describe('StepRooms TRV setpoint readback (INSTRUCTION-627B)', () => {
  it('(W1) the MQTT driver shows the field', () => {
    renderStep('mqtt')
    expect(screen.getByText(LABEL)).toBeInTheDocument()
  })

  it('(W2) a typed topic writes the topic string', () => {
    const onUpdate = renderStep('mqtt')
    fireEvent.change(readbackInput(), { target: { value: 'z/trv' } })
    expect(lastEnsuite(onUpdate).mqtt_topics?.trv_setpoint_readback).toBe('z/trv')
  })

  it('(W3) a stored json mapping shows its topic', () => {
    renderStep('mqtt', {
      ...ENSUITE,
      mqtt_topics: { trv_setpoint_readback: { topic: 'z/trv', format: 'json', json_path: 'occupied_heating_setpoint' } },
    })
    expect(readbackInput().value).toBe('z/trv')
  })

  it('(W4) a list of two is shown and has no input', () => {
    renderStep('mqtt', {
      ...ENSUITE,
      mqtt_topics: { trv_setpoint_readback: ['z/trv1', { topic: 'z/trv2', format: 'json', json_path: 'k' }] },
    })
    const note = screen.getByTestId('ensuite-wizard-trv-readback-list')
    expect(note).toHaveTextContent('z/trv1')
    expect(note).toHaveTextContent('z/trv2')
    expect(note.querySelector('input')).toBeNull()
  })

  it('(W5) the HA driver shows no readback field', () => {
    renderStep('ha')
    expect(screen.queryByText(LABEL)).toBeNull()
  })

  it('(W6) a room with no stored control mode shows None on MQTT and Indirect on HA', () => {
    const { control_mode: _omit, ...bare } = ENSUITE
    void _omit
    const a = render(<StepRooms config={{ driver: 'mqtt', rooms: { ensuite: bare } }} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText('ensuite'))
    expect(controlModeValue()).toBe('none')
    a.unmount()
    const b = render(
      <StepRooms config={{ driver: 'mqtt', rooms: { ensuite: { ...bare, trv_entity: 'climate.x' } } }} onUpdate={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('ensuite'))
    expect(controlModeValue()).toBe('none')
    b.unmount()
    render(
      <StepRooms config={{ driver: 'ha', rooms: { ensuite: { ...bare, trv_entity: 'climate.x' } } }} onUpdate={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('ensuite'))
    expect(controlModeValue()).toBe('indirect')
  })

  it('(W7) the auxiliary step shows none on MQTT and indirect on HA', () => {
    const { control_mode: _omit, ...bare } = ENSUITE
    void _omit
    const withTrv = { ...bare, trv_entity: 'climate.x' }
    const a = render(<StepAuxOutputs config={{ driver: 'mqtt', rooms: { ensuite: withTrv } }} onUpdate={vi.fn()} />)
    expect(screen.getByText('Control mode: none')).toBeInTheDocument()
    a.unmount()
    render(<StepAuxOutputs config={{ driver: 'ha', rooms: { ensuite: withTrv } }} onUpdate={vi.fn()} />)
    expect(screen.getByText('Control mode: indirect')).toBeInTheDocument()
  })
})
