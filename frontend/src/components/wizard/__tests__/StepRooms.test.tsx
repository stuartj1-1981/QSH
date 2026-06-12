/**
 * INSTRUCTION-145 — wizard scan-complete feedback and mandatory-field markers
 * exposed through StepRooms (HA path).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepRooms } from '../StepRooms'
import type { EntityCandidate, RoomConfigYaml } from '../../../types/config'

afterEach(() => {
  vi.restoreAllMocks()
})

const mkCandidate = (id: string): EntityCandidate => ({
  entity_id: id,
  friendly_name: id,
  score: 30,
  confidence: 'high',
  state: '0',
  device_class: '',
  unit: '',
})

const haConfig = (room: RoomConfigYaml) => ({
  driver: 'ha' as const,
  rooms: { lounge: room },
})

describe('StepRooms — mandatory markers (INSTRUCTION-145)', () => {
  it('HA path (indirect): TRV, Independent Sensor, Heating Feedback labels carry red asterisk', () => {
    const config = haConfig({
      area_m2: 15,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)

    // Expand the room card to render the entity pickers.
    fireEvent.click(screen.getByText(/lounge/))

    for (const text of [
      'TRV Entity',
      'Independent Temperature Sensor',
      'Heating Feedback Entity',
    ]) {
      const labelEl = screen.getByText(text).closest('label')
      expect(labelEl).not.toBeNull()
      const star = Array.from(labelEl!.querySelectorAll('span')).find(
        (s) => s.textContent === '*',
      )
      expect(star).toBeDefined()
      expect(star!.className).toContain('text-[var(--red)]')
    }
  })

  it('legend "Mandatory" is rendered with adjacent red asterisk', () => {
    const config = haConfig({
      area_m2: 15,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    const legend = screen.getByText('Mandatory')
    expect(legend).toBeInTheDocument()
    const prev = legend.previousElementSibling as HTMLElement | null
    expect(prev).not.toBeNull()
    expect(prev!.tagName).toBe('SPAN')
    expect(prev!.textContent).toBe('*')
    expect(prev!.className).toContain('text-[var(--red)]')
  })
})

describe('StepRooms — per-room scan feedback (INSTRUCTION-145)', () => {
  it('shows green badge with candidate count after a successful per-room scan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        room: 'lounge',
        candidates: {
          trv_entity: [mkCandidate('climate.trv_a'), mkCandidate('climate.trv_b')],
          independent_sensor: [mkCandidate('sensor.lounge_temp')],
        },
      }),
    } as Response)

    const config = haConfig({
      area_m2: 15,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByText(/lounge/))
    fireEvent.click(screen.getByText('Scan for this room'))

    await waitFor(() => {
      expect(screen.getByText(/Scanned — 3 candidates found/)).toBeInTheDocument()
    })
  })

  it('hides the green badge and surfaces the error when the per-room scan fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'boom' }),
    } as Response)

    const config = haConfig({
      area_m2: 15,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByText(/lounge/))
    fireEvent.click(screen.getByText('Scan for this room'))

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Scanned —/)).toBeNull()
  })
})


// =============================================================================
// INSTRUCTION-231D — paired per-emitter heating_entity rows (wizard)
// =============================================================================


describe('INSTRUCTION-231D: paired per-emitter heating_entity rows (wizard)', () => {
  it('renders one paired emitter row when both lists are empty', () => {
    const config = haConfig({
      area_m2: 15,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/lounge/))
    // One TRV row and one heating row with the wizard label conventions.
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity').length).toBe(1)
    expect(screen.queryAllByRole('button', { name: /remove emitter/i }).length).toBe(0)
  })

  it('renders N paired rows when trv and heating lists have equal length', () => {
    const config = haConfig({
      area_m2: 40,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
      trv_entity: ['climate.dining_trv', 'climate.sitting_room_trv'],
      heating_entity: [
        'number.dining_trv_valve_closing_degree',
        'number.sitting_room_trv_valve_closing_degree',
      ],
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/lounge/))
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 2').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity 2').length).toBe(1)
    expect(screen.queryAllByRole('button', { name: /remove emitter/i }).length).toBe(2)
  })

  it('renders max(trv, heating) rows when lengths differ', () => {
    const config = haConfig({
      area_m2: 40,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
      trv_entity: ['climate.A', 'climate.B', 'climate.C'],
      heating_entity: 'sensor.lounge_heating',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/lounge/))
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 2').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 3').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity 2').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity 3').length).toBe(1)
  })

  it('add emitter appends slot to both trv and heating lists', () => {
    const onUpdate = vi.fn()
    const config = haConfig({
      area_m2: 20,
      facing: 'N',
      ceiling_m: 2.4,
      control_mode: 'indirect',
      trv_entity: 'climate.lounge_trv',
      heating_entity: 'sensor.lounge_heating',
    })
    render(<StepRooms config={config} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    const addBtn = screen.getByRole('button', { name: /add emitter/i })
    fireEvent.click(addBtn)
    // Wizard pushes the full rooms object on each update; verify the
    // most recent call has both lists extended to length 2.
    const lastCall = onUpdate.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect(lastCall![0]).toBe('rooms')
    const updatedRooms = lastCall![1] as Record<string, RoomConfigYaml>
    expect(updatedRooms.lounge.trv_entity).toEqual(['climate.lounge_trv', ''])
    expect(updatedRooms.lounge.heating_entity).toEqual(['sensor.lounge_heating', ''])
  })

  it('remove emitter removes slot at same index from both lists', () => {
    const onUpdate = vi.fn()
    const config = haConfig({
      area_m2: 40,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
      trv_entity: ['climate.A', 'climate.B'],
      heating_entity: ['sensor.A', 'sensor.B'],
    })
    render(<StepRooms config={config} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    const removeButtons = screen.getAllByRole('button', { name: /remove emitter/i })
    expect(removeButtons.length).toBe(2)
    fireEvent.click(removeButtons[1])
    const lastCall = onUpdate.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    const updatedRooms = lastCall![1] as Record<string, RoomConfigYaml>
    // After collapse-to-scalar normalisation: both fields scalar.
    expect(updatedRooms.lounge.trv_entity).toBe('climate.A')
    expect(updatedRooms.lounge.heating_entity).toBe('sensor.A')
  })

  it('single-emitter scalar heating_entity contract preserved on edit via candidate selection', () => {
    const onUpdate = vi.fn()
    const config = haConfig({
      area_m2: 6,
      facing: 'N',
      ceiling_m: 2.4,
      control_mode: 'indirect',
      trv_entity: 'climate.lounge_trv',
      heating_entity: 'sensor.lounge_heating',
    })
    render(<StepRooms config={config} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    // EntityPicker is a button-dropdown; we don't simulate a candidate
    // pick here (would require populating roomCandidates which is set
    // by the scan-room hook). Instead verify the rendered row count
    // matches the scalar input (1 row, since heLen = trvLen = 1).
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Feedback Entity').length).toBe(1)
    // Confirm the EntityPicker button surfaces the current scalar value
    // somewhere on the page — the picker shows the value or
    // friendly_name in the closed-state span.
    expect(screen.getByText('sensor.lounge_heating')).toBeInTheDocument()
  })

  it('V2 MEDIUM-1 regression: extra heating row exists at index 2 when scalar heating + 3-trv list', () => {
    const config = haConfig({
      area_m2: 40,
      facing: 'S',
      ceiling_m: 2.4,
      control_mode: 'indirect',
      trv_entity: ['climate.A', 'climate.B', 'climate.C'],
      heating_entity: 'sensor.shared_template',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/lounge/))
    // V2 MEDIUM-1 pin: the third paired row exists (Heating Feedback
    // Entity 3 label rendered). Pre-V2 the helper would silently drop
    // a value typed at index 2; the rendering pre-condition is that
    // row 2 must be present so the operator CAN attempt to type into
    // it. The full updateHeatingAt scalar-pad behaviour is exercised
    // in the RoomSettings test (which uses text inputs); StepRooms
    // uses EntityPicker (button-dropdown) so the pad-and-set logic
    // is the same helper code but the interaction differs.
    expect(screen.getAllByText('Heating Feedback Entity 3').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 3').length).toBe(1)
  })
})

// ── INSTRUCTION-324: property ground truth + emitter_type seeding ─────────

describe('StepRooms — property declaration (INSTRUCTION-324)', () => {
  it('renders the property inputs and writes total_floor_area_m2 via onUpdate', () => {
    const onUpdate = vi.fn()
    render(
      <StepRooms
        config={{ driver: 'ha', rooms: {} }}
        onUpdate={onUpdate}
      />,
    )
    const areaInput = screen.getByPlaceholderText('e.g. 189')
    fireEvent.change(areaInput, { target: { value: '189' } })
    expect(onUpdate).toHaveBeenCalledWith('property', {
      total_floor_area_m2: 189,
    })
  })

  it('live readout flags a gap beyond the 25% tolerance', () => {
    const config = {
      driver: 'ha' as const,
      property: { total_floor_area_m2: 189 },
      rooms: { lounge: { area_m2: 102 } as RoomConfigYaml },
    }
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    const readout = screen.getByTestId('area-reconciliation-readout')
    expect(readout.textContent).toMatch(/102 m² of 189 m² declared/)
    expect(readout.textContent).toMatch(/exceeds the 25% tolerance/)
    expect(readout.className).toContain('text-[var(--red)]')
  })

  it('live readout is calm when the declaration reconciles', () => {
    const config = {
      driver: 'ha' as const,
      property: { total_floor_area_m2: 100 },
      rooms: { lounge: { area_m2: 90 } as RoomConfigYaml },
    }
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    const readout = screen.getByTestId('area-reconciliation-readout')
    expect(readout.textContent).not.toMatch(/exceeds/)
    expect(readout.className).not.toContain('text-[var(--red)]')
  })

  it('Add Room seeds an explicit emitter_type (visible default, never silent)', () => {
    const onUpdate = vi.fn()
    render(
      <StepRooms config={{ driver: 'ha', rooms: {} }} onUpdate={onUpdate} />,
    )
    fireEvent.change(
      screen.getByPlaceholderText('Room name (e.g. living_room)'),
      { target: { value: 'Snug' } },
    )
    fireEvent.click(screen.getByText('Add Room'))
    expect(onUpdate).toHaveBeenCalledWith(
      'rooms',
      expect.objectContaining({
        snug: expect.objectContaining({ emitter_type: 'radiator' }),
      }),
    )
  })

  it('emitter type select shows the placeholder for a room without the key', () => {
    const config = haConfig({ area_m2: 15, control_mode: 'indirect' })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/lounge/))
    const select = screen
      .getByText('Select emitter type…')
      .closest('select') as HTMLSelectElement
    expect(select.value).toBe('')
  })
})

// ── INSTRUCTION-333: emitter_type 'none' (no emitter) ────────────────────────

describe('StepRooms — emitter_type none (INSTRUCTION-333)', () => {
  const emitterSelect = () =>
    screen.getByText('Select emitter type…').closest('select') as HTMLSelectElement

  it('renders the None (no emitter) option', () => {
    const config = haConfig({
      area_m2: 15,
      control_mode: 'indirect',
      emitter_type: 'radiator',
    })
    render(<StepRooms config={config} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/lounge/))
    expect(
      screen.getByRole('option', { name: 'None (no emitter)' }),
    ).toBeInTheDocument()
  })

  it('selecting None forces emitter_kw to 0', () => {
    const onUpdate = vi.fn()
    const config = haConfig({
      area_m2: 15,
      control_mode: 'indirect',
      emitter_type: 'radiator',
      emitter_kw: 1.5,
    })
    render(<StepRooms config={config} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    fireEvent.change(emitterSelect(), { target: { value: 'none' } })
    const lastCall = onUpdate.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect(lastCall![0]).toBe('rooms')
    const updated = (lastCall![1] as Record<string, RoomConfigYaml>).lounge
    expect(updated.emitter_type).toBe('none')
    expect(updated.emitter_kw).toBe(0)
  })

  it('switching away from None clears emitter_kw (dropped on serialise)', () => {
    const onUpdate = vi.fn()
    const config = haConfig({
      area_m2: 15,
      control_mode: 'indirect',
      emitter_type: 'none',
      emitter_kw: 0,
    })
    render(<StepRooms config={config} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    fireEvent.change(emitterSelect(), { target: { value: 'radiator' } })
    const lastCall = onUpdate.mock.calls.at(-1)
    const updated = (lastCall![1] as Record<string, RoomConfigYaml>).lounge
    expect(updated.emitter_type).toBe('radiator')
    // emitter_kw cleared to undefined → dropped by JSON.stringify on the wire,
    // so area×0.1 re-applies at load rather than persisting a 0-output radiator.
    const wire = JSON.parse(JSON.stringify(updated))
    expect(wire).not.toHaveProperty('emitter_kw')
  })
})
