// INSTRUCTION-572D T4 — the Window Open Delay field in the room form. Cases D1
// to D14, numbered as in T4 of the instruction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomSettings } from '../RoomSettings'
import { WINDOW_DELAY } from '../../../lib/helpText'

// Mock the hooks, in the shape of RoomSettings.window.test.tsx.
const patchMock = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))
vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {} }),
}))

const WINDOW_ENTITY = 'binary_sensor.lounge_window'
const WINDOW_PLACEHOLDER = 'binary_sensor.room_window_contact'
const DELAY_LABEL = 'Window open delay in seconds, lounge'

const room = (extra: Record<string, unknown> = {}) => ({
  lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, ...extra },
})

/** Render the form with one room, `lounge`. */
function renderForm(roomExtra: Record<string, unknown> = {}, driver: 'ha' | 'mqtt' = 'ha') {
  render(<RoomSettings rooms={room(roomExtra)} driver={driver} onRefetch={() => {}} />)
}

const delayField = () => screen.getByLabelText(DELAY_LABEL) as HTMLInputElement
const saveBtn = () => screen.getByRole('button', { name: /save changes/i })
const sections = () => patchMock.mock.calls.map((call) => call[0])

async function savedLounge() {
  await waitFor(() => expect(patchMock).toHaveBeenCalled())
  const [section, payload] = patchMock.mock.calls[0]
  expect(section).toBe('rooms')
  return payload.lounge
}

beforeEach(() => {
  patchMock.mockReset()
  patchMock.mockResolvedValue({ ok: true })
})

describe('RoomSettings window open delay (INSTRUCTION-572D)', () => {
  it.each([
    ['no key', {}],
    ['an empty text', { window_sensor: '' }],
  ])('(D1) a room with no window sensor (%s) has no delay field', (_label, extra) => {
    renderForm(extra)
    expect(screen.queryByLabelText(DELAY_LABEL)).toBeNull()
    expect(screen.queryByText('Window Open Delay (s)')).toBeNull()
  })

  it('(D2) a room with a window sensor has one delay field, empty, with the range and the default, and its label is tied to it', () => {
    renderForm({ window_sensor: WINDOW_ENTITY })
    expect(screen.getAllByText('Window Open Delay (s)')).toHaveLength(1)
    const field = delayField()
    expect(field.value).toBe('')
    expect(field).toHaveAttribute('type', 'number')
    expect(field).toHaveAttribute('min', '0')
    expect(field).toHaveAttribute('max', '600')
    expect(field).toHaveAttribute('step', '1')
    expect(field).toHaveAttribute('placeholder', '60')
    expect(field).not.toHaveAttribute('readonly')
    const label = screen.getByText('Window Open Delay (s)', { selector: 'label' }) as HTMLLabelElement
    expect(label.htmlFor).toBe(field.id)
    expect(field.id).toBe('lounge-window-open-delay')
  })

  it.each([120, 0, 900])('(D3) a stored delay of %i is shown as it is stored', (stored) => {
    renderForm({ window_sensor: WINDOW_ENTITY, window_open_delay_s: stored })
    expect(delayField().value).toBe(String(stored))
  })

  it('(D4) the mqtt driver has no delay field', () => {
    renderForm({ window_sensor: WINDOW_ENTITY, window_open_delay_s: 120 }, 'mqtt')
    expect(screen.queryByLabelText(DELAY_LABEL)).toBeNull()
  })

  it('(D5) an edit and Save Changes patches rooms with the delay as a number', async () => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY })
    fireEvent.change(delayField(), { target: { value: '90' } })
    expect(delayField().value).toBe('90')
    await user.click(saveBtn())
    const lounge = await savedLounge()
    expect(lounge.window_open_delay_s).toBe(90)
    expect(lounge.window_sensor).toBe(WINDOW_ENTITY)
    expect(sections()).toEqual(['rooms'])
  })

  it.each([
    ['900', 600],
    ['-5', 0],
    ['90.5', 91],
  ])('(D6) an entry of %s is stored as %i', async (text, stored) => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY })
    fireEvent.change(delayField(), { target: { value: text } })
    expect(delayField().value).toBe(String(stored))
    await user.click(saveBtn())
    expect((await savedLounge()).window_open_delay_s).toBe(stored)
  })

  it('(D7) an emptied field removes the key from the patch', async () => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY, window_open_delay_s: 120 })
    fireEvent.change(delayField(), { target: { value: '' } })
    await user.click(saveBtn())
    const lounge = await savedLounge()
    expect(lounge.window_open_delay_s).toBeUndefined()
    // The key cleared to undefined is dropped by JSON.stringify on the wire.
    expect(JSON.parse(JSON.stringify(lounge))).not.toHaveProperty('window_open_delay_s')
  })

  it("(D8) the help button in the field's label shows WINDOW_DELAY.help in the tooltip", async () => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY })
    const label = screen.getByText('Window Open Delay (s)', { selector: 'label' })
    await user.click(within(label).getByRole('button', { name: 'Help' }))
    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText(WINDOW_DELAY.help)).toBeInTheDocument()
  })

  it('(D9) the field comes when a window sensor is entered, and it shows a delay that the room holds', async () => {
    const user = userEvent.setup()
    renderForm({ window_open_delay_s: 120 })
    expect(screen.queryByLabelText(DELAY_LABEL)).toBeNull()
    await user.type(screen.getByPlaceholderText(WINDOW_PLACEHOLDER), WINDOW_ENTITY)
    expect(delayField().value).toBe('120')
    await user.click(saveBtn())
    const lounge = await savedLounge()
    expect(lounge.window_sensor).toBe(WINDOW_ENTITY)
    expect(lounge.window_open_delay_s).toBe(120)
  })

  it('(D10) the field goes when the window sensor is cleared, and the delay stays in the patch', async () => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY, window_open_delay_s: 120 })
    await user.clear(screen.getByPlaceholderText(WINDOW_PLACEHOLDER))
    expect(screen.queryByLabelText(DELAY_LABEL)).toBeNull()
    await user.click(saveBtn())
    const lounge = await savedLounge()
    expect(lounge.window_sensor).toBeUndefined()
    expect(lounge.window_open_delay_s).toBe(120)
  })

  it('(D11) a stored delay outside the range is saved as it is stored when another field of the room is edited', async () => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY, window_open_delay_s: 900 })
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '22' } })
    await user.click(saveBtn())
    const lounge = await savedLounge()
    expect(lounge.area_m2).toBe(22)
    expect(lounge.window_open_delay_s).toBe(900)
  })

  it('(D12) with two rooms, an edit of one delay changes that room only', async () => {
    const user = userEvent.setup()
    const rooms = {
      lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, window_sensor: WINDOW_ENTITY, window_open_delay_s: 30 },
      study: { area_m2: 9, facing: 'N', ceiling_m: 2.4, window_sensor: 'binary_sensor.study_window' },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(delayField().value).toBe('30')
    const study = screen.getByLabelText('Window open delay in seconds, study') as HTMLInputElement
    expect(study.value).toBe('')
    expect(study.id).toBe('study-window-open-delay')
    fireEvent.change(study, { target: { value: '45' } })
    await user.click(saveBtn())
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const payload = patchMock.mock.calls[0][1]
    expect(payload.study.window_open_delay_s).toBe(45)
    expect(payload.lounge.window_open_delay_s).toBe(30)
  })

  it('(D13) the operator can type a delay into the field', async () => {
    const user = userEvent.setup()
    renderForm({ window_sensor: WINDOW_ENTITY })
    await user.type(delayField(), '45')
    expect(delayField().value).toBe('45')
    await user.click(saveBtn())
    expect((await savedLounge()).window_open_delay_s).toBe(45)
  })

  it('(D14) with two rooms, only the room that has a window sensor has a delay field', () => {
    const rooms = {
      lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, window_sensor: WINDOW_ENTITY },
      study: { area_m2: 9, facing: 'N', ceiling_m: 2.4 },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.getAllByText('Window Open Delay (s)')).toHaveLength(1)
    expect(delayField()).toBeInTheDocument()
    expect(screen.queryByLabelText('Window open delay in seconds, study')).toBeNull()
  })
})
