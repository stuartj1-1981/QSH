/**
 * INSTRUCTION-569F T6 — the wizard's Window Sensor field: the picker's help
 * text (T3) and the field in a room's Home Assistant section (T4). Cases (1)
 * to (7) are T6's StepRooms cases, in its order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { StepRooms } from '../StepRooms'
import { EntityPicker } from '../EntityPicker'
import { WINDOW } from '../../../lib/helpText'
import type { EntityCandidate, RoomConfigYaml } from '../../../types/config'

afterEach(() => {
  vi.restoreAllMocks()
})

const ENSUITE: RoomConfigYaml = {
  area_m2: 6,
  facing: 'N',
  ceiling_m: 2.4,
  control_mode: 'indirect',
}

const WINDOW_ENTITY = 'binary_sensor.ensuite_window'

const windowCandidate: EntityCandidate = {
  entity_id: WINDOW_ENTITY,
  friendly_name: 'Ensuite Window',
  score: 30,
  confidence: 'high',
  state: 'off',
  device_class: 'window',
  unit: '',
}

const haConfig = (room: RoomConfigYaml) => ({
  driver: 'ha' as const,
  rooms: { ensuite: room },
})

/** The <label> element whose own text is `text`. */
const labelOf = (text: string): HTMLLabelElement => {
  const label = screen.getByText(text).closest('label')
  expect(label).not.toBeNull()
  return label!
}

describe('StepRooms — the Window Sensor field (INSTRUCTION-569F)', () => {
  it('(1) EntityPicker with no helpText renders no help button and a block label', () => {
    render(
      <EntityPicker
        slot="window_sensor"
        label="Window Sensor (optional)"
        value=""
        onChange={vi.fn()}
      />,
    )
    expect(labelOf('Window Sensor (optional)')).toHaveClass('block')
    expect(screen.queryByRole('button', { name: 'Help' })).toBeNull()
  })

  it('(2) EntityPicker with helpText has a flex label, and its help button shows the text', async () => {
    const text = 'Help text for this field.'
    render(
      <EntityPicker
        slot="window_sensor"
        label="Window Sensor (optional)"
        helpText={text}
        value=""
        onChange={vi.fn()}
      />,
    )
    const label = labelOf('Window Sensor (optional)')
    expect(label).toHaveClass('flex')
    fireEvent.click(within(label).getByRole('button', { name: 'Help' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText(text)).toBeInTheDocument()
  })

  it('(3) the wizard renders "Window Sensor (optional)" with no required star and the R5 text', async () => {
    render(<StepRooms config={haConfig(ENSUITE)} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText('ensuite'))

    const label = labelOf('Window Sensor (optional)')
    const star = Array.from(label.querySelectorAll('span')).find(
      (s) => s.textContent === '*',
    )
    expect(star).toBeUndefined()

    fireEvent.click(within(label).getByRole('button', { name: 'Help' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText(WINDOW.sensor)).toBeInTheDocument()
  })

  it('(4) a configured entity is shown', () => {
    render(
      <StepRooms
        config={haConfig({ ...ENSUITE, window_sensor: WINDOW_ENTITY })}
        onUpdate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('ensuite'))

    const picker = labelOf('Window Sensor (optional)').closest('div')!
    expect(within(picker).getByText(WINDOW_ENTITY)).toBeInTheDocument()
  })

  it('(5) after a scan, picking the candidate from "Select window sensor..." calls onUpdate("rooms", …) with window_sensor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        room: 'ensuite',
        candidates: { window_sensor: [windowCandidate] },
      }),
    } as Response)

    const onUpdate = vi.fn()
    render(<StepRooms config={haConfig(ENSUITE)} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText('ensuite'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan for this room' }))
    await waitFor(() => {
      expect(screen.getByText(/Scanned — 1 candidate\b/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select window sensor...' }))
    fireEvent.click(screen.getByText('Ensuite Window'))

    expect(onUpdate).toHaveBeenCalledWith('rooms', {
      ensuite: { ...ENSUITE, window_sensor: WINDOW_ENTITY },
    })
  })

  it('(6) with an entity configured, a click on it and on "None / Skip" calls onUpdate with window_sensor present and undefined', () => {
    const onUpdate = vi.fn()
    render(
      <StepRooms
        config={haConfig({ ...ENSUITE, window_sensor: WINDOW_ENTITY })}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByText('ensuite'))
    fireEvent.click(screen.getByText(WINDOW_ENTITY))
    fireEvent.click(screen.getByRole('button', { name: 'None / Skip' }))

    const lastCall = onUpdate.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect(lastCall![0]).toBe('rooms')
    const updated = (lastCall![1] as Record<string, RoomConfigYaml>).ensuite
    expect(Object.keys(updated)).toContain('window_sensor')
    expect(updated.window_sensor).toBeUndefined()
  })

  it('(7) the MQTT path renders no picker', () => {
    render(
      <StepRooms
        config={{ driver: 'mqtt' as const, rooms: { ensuite: ENSUITE } }}
        onUpdate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('ensuite'))

    // The room is open on the MQTT path.
    expect(screen.getByText('Room Temperature')).toBeInTheDocument()
    expect(screen.queryByText('Window Sensor (optional)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Select window sensor...' })).toBeNull()
  })
})
