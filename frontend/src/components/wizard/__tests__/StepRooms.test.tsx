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
