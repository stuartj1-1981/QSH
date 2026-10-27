/**
 * INSTRUCTION-604B T6 — the wizard's MQTT Window Sensor Topic field: cases
 * (W1) to (W5).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { StepRooms } from '../StepRooms'
import { WINDOW } from '../../../lib/helpText'
import type { RoomConfigYaml } from '../../../types/config'

afterEach(() => {
  vi.restoreAllMocks()
})

const ENSUITE: RoomConfigYaml = {
  area_m2: 6,
  facing: 'N',
  ceiling_m: 2.4,
  control_mode: 'indirect',
}

const INVERT_LABEL = 'Window sensor reads true when closed, ensuite'

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

describe('StepRooms MQTT window contact (INSTRUCTION-604B)', () => {
  it('(W1) shows the topic field and no invert box with no topic', () => {
    renderStep('mqtt')
    expect(screen.getByText('Window Sensor Topic (optional)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('rooms/ensuite/window')).toBeInTheDocument()
    expect(screen.queryByLabelText(INVERT_LABEL)).toBeNull()
  })

  it('(W2) the help tip of the hint line shows the R5 text', async () => {
    renderStep('mqtt')
    const hint = screen.getByText(/Use a contact sensor on a window or an external door\./).closest('p')!
    fireEvent.click(within(hint).getByRole('button', { name: 'Help' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText(WINDOW.sensor)).toBeInTheDocument()
  })

  it('(W3) with a topic, the invert box is shown unchecked and a click writes invert', () => {
    const onUpdate = renderStep('mqtt', { ...ENSUITE, mqtt_topics: { window_sensor: 'z/win' } })
    const box = screen.getByLabelText(INVERT_LABEL) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(lastEnsuite(onUpdate).mqtt_topics?.window_sensor).toEqual({ topic: 'z/win', invert: true })
  })

  it('(W4) the HA driver shows no MQTT window field', () => {
    renderStep('ha')
    expect(screen.queryByText('Window Sensor Topic (optional)')).toBeNull()
  })

  it('(W5) ticking JSON payload and typing a boolean key writes the json mapping', () => {
    // H11: the JSON payload box is TopicPicker local state; with the parent not
    // re-rendering the room (onUpdate is a spy), the key input stays shown.
    const onUpdate = renderStep('mqtt', { ...ENSUITE, mqtt_topics: { window_sensor: 'z/win' } })
    fireEvent.click(screen.getByLabelText('JSON payload'))
    fireEvent.change(screen.getByPlaceholderText('json_path (e.g. temperature)'), { target: { value: 'contact' } })
    expect(lastEnsuite(onUpdate).mqtt_topics?.window_sensor).toEqual({
      topic: 'z/win', format: 'json', json_path: 'contact',
    })
  })
})
