// INSTRUCTION-569F T6 — the Settings Window Sensor field and its help text
// (owner ruling R5). Nine cases, numbered as in T6 of the instruction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomSettings } from '../RoomSettings'
import { WINDOW } from '../../../lib/helpText'

// Mock the hooks, in the shape of RoomSettings.test.tsx. The resolve hook is a
// spy that records its argument: the list of entity ids the component resolves.
const patchMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))

const resolveMock = vi.fn((_ids: string[]) => ({ resolved: {} }))
vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: (ids: string[]) => resolveMock(ids),
}))

const WINDOW_ENTITY = 'binary_sensor.lounge_window'
// The field's placeholder (T5 edit 5); the field's label is not tied to its
// input, so the input is found by its placeholder, as RoomSettings.test.tsx does.
const WINDOW_PLACEHOLDER = 'binary_sensor.room_window_contact'

const baseRooms = {
  lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4 },
}

const roomsWithWindow = {
  lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, window_sensor: WINDOW_ENTITY },
}

const saveBtn = () => screen.getByRole('button', { name: /save changes/i })

describe('RoomSettings window sensor (INSTRUCTION-569F)', () => {
  beforeEach(() => {
    patchMock.mockClear()
    resolveMock.mockClear()
  })

  it('(1) WINDOW.sensor names the contact sensor, the valve function, setting it to off and that QSH does not read it', () => {
    expect(WINDOW.sensor).toContain('contact sensor on a window or on an external door')
    expect(WINDOW.sensor).toContain('Do not use the open-window function of the radiator valve')
    expect(WINDOW.sensor).toContain('set it to off on the valve')
    expect(WINDOW.sensor).toContain('QSH does not read it')
  })

  it('(2) each of the four WINDOW strings equals its text in T1, character for character', () => {
    // Literals copied byte for byte from T1 of the instruction; not imported.
    expect(WINDOW.sensor).toBe(
      'Use a contact sensor on a window or on an external door. While the contact is open, this room does not start the heat source above 14°C, and QSH does not learn the heat loss of the room. A boost has priority. Do not use the open-window function of the radiator valve: set it to off on the valve. QSH does not read it, and a valve that closes itself is not visible to QSH.',
    )
    expect(WINDOW.open).toBe(
      'The window contact is open. This room does not start the heat source above 14°C. A boost has priority.',
    )
    expect(WINDOW.inferred).toBe(
      'This room loses heat faster than usual, and QSH treats a window as open. The room can fall up to 1.5°C below its target before it starts the heat source. A boost has priority.',
    )
    expect(WINDOW.fault).toBe(
      'The window sensor is not available. QSH reads the window as closed.',
    )
  })

  it('(3) one Window Sensor field on the ha driver', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.getAllByText('Window Sensor')).toHaveLength(1)
    expect(screen.getAllByPlaceholderText(WINDOW_PLACEHOLDER)).toHaveLength(1)
  })

  it('(4) no Window Sensor field on the mqtt driver', () => {
    render(<RoomSettings rooms={baseRooms} driver="mqtt" onRefetch={() => {}} />)
    expect(screen.queryByText('Window Sensor')).toBeNull()
    expect(screen.queryByPlaceholderText(WINDOW_PLACEHOLDER)).toBeNull()
  })

  it("(5) the help button in the field's label shows WINDOW.sensor in the tooltip", async () => {
    const user = userEvent.setup()
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    const label = screen.getByText('Window Sensor', { selector: 'label' })
    await user.click(within(label).getByRole('button', { name: 'Help' }))
    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText(WINDOW.sensor)).toBeInTheDocument()
  })

  it('(6) an edit and Save Changes patches rooms with window_sensor', async () => {
    const user = userEvent.setup()
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    await user.type(screen.getByPlaceholderText(WINDOW_PLACEHOLDER), WINDOW_ENTITY)
    await user.click(saveBtn())
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const [section, payload] = patchMock.mock.calls[0]
    expect(section).toBe('rooms')
    expect(payload.lounge.window_sensor).toBe(WINDOW_ENTITY)
  })

  it('(7) the resolve hook is called with the window entity', () => {
    render(<RoomSettings rooms={roomsWithWindow} driver="ha" onRefetch={() => {}} />)
    expect(resolveMock).toHaveBeenCalledWith(expect.arrayContaining([WINDOW_ENTITY]))
  })

  it('(8) on mqtt a room with the key shows "Window Sensor: …" in the legacy block, and Clear legacy HA fields removes the line and the key from the patch', async () => {
    const user = userEvent.setup()
    render(<RoomSettings rooms={roomsWithWindow} driver="mqtt" onRefetch={() => {}} />)
    expect(screen.getByText(`Window Sensor: ${WINDOW_ENTITY}`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear legacy HA fields' }))
    expect(screen.queryByText(/Window Sensor:/)).toBeNull()
    await user.click(saveBtn())
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const [section, payload] = patchMock.mock.calls[0]
    expect(section).toBe('rooms')
    expect(payload.lounge.window_sensor).toBeUndefined()
    // The key cleared to undefined is dropped by JSON.stringify on the wire.
    expect(JSON.parse(JSON.stringify(payload.lounge))).not.toHaveProperty('window_sensor')
  })

  it('(9) clearing the field leaves the key undefined in the patch', async () => {
    const user = userEvent.setup()
    render(<RoomSettings rooms={roomsWithWindow} driver="ha" onRefetch={() => {}} />)
    await user.clear(screen.getByPlaceholderText(WINDOW_PLACEHOLDER))
    await user.click(saveBtn())
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const [section, payload] = patchMock.mock.calls[0]
    expect(section).toBe('rooms')
    expect(payload.lounge.window_sensor).toBeUndefined()
  })
})
