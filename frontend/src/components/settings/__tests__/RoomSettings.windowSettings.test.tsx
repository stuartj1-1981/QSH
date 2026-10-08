// INSTRUCTION-572B T6 — the open-window inference mode in the room form.
// Cases S1 to S16, numbered as in T6 of the instruction.
import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomSettings } from '../RoomSettings'
import { WINDOW_INFERENCE } from '../../../lib/helpText'

// Mock the hooks, in the shape of RoomSettings.window.test.tsx.
const patchMock = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))
vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {} }),
}))

const MODE_ERROR = 'Failed to save open-window detection. The mode has not been changed.'

const room = (extra: Record<string, unknown> = {}) => ({
  lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, ...extra },
})

/** Render the form with one room, `lounge`. Returns the refetch spy. */
function renderForm(
  roomExtra: Record<string, unknown> = {},
  props: { windowDetection?: unknown; driver?: 'ha' | 'mqtt' } = {},
) {
  const onRefetch = vi.fn()
  render(
    <RoomSettings
      rooms={room(roomExtra)}
      windowDetection={props.windowDetection}
      driver={props.driver ?? 'ha'}
      onRefetch={onRefetch}
    />,
  )
  return onRefetch
}

const radio = (name: 'Off' | 'Observe' | 'Act') => screen.getByRole('radio', { name }) as HTMLInputElement
const selected = () => (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked)
const saveBtn = () => screen.getByRole('button', { name: /save changes/i })
const sections = () => patchMock.mock.calls.map((call) => call[0])

beforeEach(() => {
  patchMock.mockReset()
  patchMock.mockResolvedValue({ ok: true })
})

describe('RoomSettings open-window inference mode (INSTRUCTION-572B)', () => {
  it.each(['ha', 'mqtt'] as const)('(S1) the %s driver shows the chooser, after the room list', (driver) => {
    renderForm({}, { driver })
    const card = screen.getByTestId('window-inference-settings')
    expect(within(card).getByRole('group', { name: WINDOW_INFERENCE.title })).toBeInTheDocument()
    expect(within(card).getAllByRole('radio')).toHaveLength(3)
    const lastOfRoom = screen.getAllByText('Auxiliary output').at(-1)!
    expect(lastOfRoom.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('(S2) with no stored section, Off is selected, and Save Changes patches nothing', async () => {
    const user = userEvent.setup()
    const onRefetch = renderForm()
    expect(radio('Off')).toBeChecked()
    expect(selected()).toHaveLength(1)
    await user.click(saveBtn())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
    expect(patchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['observe', 'Observe'],
    ['act', 'Act'],
    ['disabled', 'Off'],
  ] as const)('(S3) a stored %s shows %s', (stored, label) => {
    renderForm({}, { windowDetection: { inference: stored } })
    expect(radio(label)).toBeChecked()
    expect(selected()).toHaveLength(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each([
    ['false', { inference: false }],
    ['the text off', { inference: 'off' }],
    ['a section that is a string', 'observe'],
    ['a section that is false', false],
  ])('(S4) a stored value that is not a mode (%s) shows no selection and the text for it', (_label, section) => {
    renderForm({}, { windowDetection: section })
    expect(selected()).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(WINDOW_INFERENCE.invalid)
  })

  it.each(['ha', 'mqtt'] as const)('(S5) on the %s driver a selection and Save Changes patch window_detection with the mode, and nothing more', async (driver) => {
    const user = userEvent.setup()
    const onRefetch = renderForm({}, { driver })
    await user.click(radio('Act'))
    expect(radio('Act')).toBeChecked()
    expect(patchMock).not.toHaveBeenCalled()
    await user.click(saveBtn())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
    expect(patchMock.mock.calls).toEqual([['window_detection', { inference: 'act' }]])
  })

  it('(S6) the patch keeps a stored key that the chooser does not set', async () => {
    const user = userEvent.setup()
    renderForm({}, { windowDetection: { inference: 'observe', note: 'x' } })
    await user.click(radio('Off'))
    await user.click(saveBtn())
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1))
    expect(patchMock.mock.calls).toEqual([['window_detection', { inference: 'disabled', note: 'x' }]])
  })

  it('(S7) a selection of the stored mode again patches nothing', async () => {
    const user = userEvent.setup()
    const onRefetch = renderForm({}, { windowDetection: { inference: 'observe' } })
    await user.click(radio('Act'))
    await user.click(radio('Observe'))
    await user.click(saveBtn())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('(S8) for a stored value that is not a mode, a selection of Off and Save Changes store the name disabled', async () => {
    const user = userEvent.setup()
    renderForm({}, { windowDetection: { inference: false, note: 'x' } })
    await user.click(radio('Off'))
    expect(screen.queryByRole('status')).toBeNull()
    await user.click(saveBtn())
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1))
    expect(patchMock.mock.calls).toEqual([['window_detection', { inference: 'disabled', note: 'x' }]])
  })

  it.each([
    ['the room edit first', true],
    ['the selection first', false],
  ])('(S9) one Save Changes stores a room edit and a mode change (%s): rooms first, then window_detection, then one refetch', async (_label, editFirst) => {
    const user = userEvent.setup()
    const onRefetch = renderForm({}, { windowDetection: { inference: 'act' } })
    const editRoom = () => fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '22' } })
    if (editFirst) editRoom()
    await user.click(radio('Off'))
    if (!editFirst) editRoom()
    expect(radio('Off')).toBeChecked()
    await user.click(saveBtn())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
    expect(sections()).toEqual(['rooms', 'window_detection'])
    expect(patchMock.mock.calls[0][1].lounge.area_m2).toBe(22)
    expect(patchMock.mock.calls[1][1]).toEqual({ inference: 'disabled' })
  })

  it('(S10) when the rooms save fails, the mode is not saved, and there is no refetch', async () => {
    const user = userEvent.setup()
    patchMock.mockResolvedValueOnce(null)
    const onRefetch = renderForm()
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '22' } })
    await user.click(radio('Act'))
    await user.click(saveBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save rooms.')
    expect(sections()).toEqual(['rooms'])
    expect(onRefetch).not.toHaveBeenCalled()
  })

  it('(S11) when the mode save fails, the error names it, the selection stays, and there is no refetch', async () => {
    const user = userEvent.setup()
    patchMock.mockResolvedValueOnce(null)
    const onRefetch = renderForm()
    await user.click(radio('Observe'))
    await user.click(saveBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent(MODE_ERROR)
    expect(sections()).toEqual(['window_detection'])
    expect(onRefetch).not.toHaveBeenCalled()
    expect(radio('Observe')).toBeChecked()
  })

  it('(S12) the radio group of the Settings chooser has its own name', () => {
    renderForm()
    expect((screen.getAllByRole('radio') as HTMLInputElement[]).map((r) => r.name)).toEqual([
      'settings-window-inference',
      'settings-window-inference',
      'settings-window-inference',
    ])
  })

  it('(S13) the chooser card has no button and is the last element of the form, and the section has one Save Changes button', () => {
    renderForm({}, { windowDetection: { inference: 'observe' } })
    const card = screen.getByTestId('window-inference-settings')
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    expect(card.nextElementSibling).toBeNull()
    // No button is a direct child of the root of the form, and no button is
    // named for the mode: the one save is the Save Changes button.
    expect(Array.from(card.parentElement!.children).filter((el) => el.tagName === 'BUTTON')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /mode/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /save/i })).toHaveLength(1)
  })

  // Each of the three steps between the rooms step and the mode step: the
  // props that give the form the stored value, and the edit that changes it.
  const LATER_STEPS: [string, Partial<ComponentProps<typeof RoomSettings>>, () => void][] = [
    [
      'property',
      { property: { total_floor_area_m2: 100 } },
      () => fireEvent.change(screen.getByLabelText(/Total Floor Area/), { target: { value: '120' } }),
    ],
    [
      'root',
      { construction_year: 1990 },
      () => fireEvent.change(screen.getByDisplayValue('1990'), { target: { value: '1995' } }),
    ],
    [
      'battery_devices',
      { rooms: room({ trv_entity: 'climate.lounge_trv' }) },
      () =>
        fireEvent.change(screen.getByPlaceholderText('sensor.room_trv_battery'), {
          target: { value: 'sensor.lounge_trv_battery' },
        }),
    ],
  ]

  it.each(LATER_STEPS)('(S14) when the %s save fails, the mode is not saved, and there is no refetch', async (step, props, edit) => {
    const user = userEvent.setup()
    patchMock.mockResolvedValueOnce(null)
    const onRefetch = vi.fn()
    render(<RoomSettings rooms={room()} driver="ha" onRefetch={onRefetch} {...props} />)
    edit()
    await user.click(radio('Act'))
    await user.click(saveBtn())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(sections()).toEqual([step])
    expect(onRefetch).not.toHaveBeenCalled()
  })

  it.each([
    ['false', { inference: false }],
    ['the text off', { inference: 'off' }],
    ['a section that is a string', 'observe'],
    ['a section that is false', false],
  ])('(S15) for a stored value that is not a mode (%s), a save with no selection sends no window_detection', async (_label, section) => {
    const user = userEvent.setup()
    const onRefetch = renderForm({}, { windowDetection: section })
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '22' } })
    await user.click(saveBtn())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
    expect(sections()).toEqual(['rooms'])
    expect(selected()).toHaveLength(0)
  })

  it.each(LATER_STEPS)('(S16) when the %s save is stored, the mode is stored after it, in the same save', async (step, props, edit) => {
    const user = userEvent.setup()
    const onRefetch = vi.fn()
    render(<RoomSettings rooms={room()} driver="ha" onRefetch={onRefetch} {...props} />)
    edit()
    await user.click(radio('Act'))
    await user.click(saveBtn())
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1))
    expect(sections()).toEqual([step, 'window_detection'])
    expect(patchMock.mock.calls[1][1]).toEqual({ inference: 'act' })
  })
})
