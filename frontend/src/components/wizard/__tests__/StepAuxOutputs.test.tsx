/**
 * INSTRUCTION-162B Task 6 — StepAuxOutputs wizard step.
 *
 * Coverage:
 *  1. Empty rooms message renders when config.rooms is empty.
 *  2. One section per room when config.rooms has multiple rooms.
 *  3. Toggling enable + filling ha_entity calls onUpdate with auxiliary_output populated.
 *  4. Driver flows through to AuxOutputEditor (HA: EntityField placeholder visible;
 *     MQTT: TopicField placeholder visible).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepAuxOutputs } from '../StepAuxOutputs'
import type { QshConfigYaml, RoomConfigYaml } from '../../../types/config'

beforeEach(() => {
  // useEntityResolve fires a fetch on mount when entity IDs are present and
  // driver is HA. Stub it so tests don't depend on network.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ entities: {} }),
  } as Response)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const mkRoom = (overrides: Partial<RoomConfigYaml> = {}): RoomConfigYaml => ({
  area_m2: 15,
  facing: 'S',
  ceiling_m: 2.4,
  control_mode: 'indirect',
  trv_entity: 'climate.x',
  ...overrides,
})

describe('StepAuxOutputs — empty rooms', () => {
  it('renders the empty-rooms message when config.rooms is empty', () => {
    const config: Partial<QshConfigYaml> = { driver: 'ha', rooms: {} }
    render(<StepAuxOutputs config={config} onUpdate={vi.fn()} />)
    expect(screen.getByText(/No rooms defined yet/i)).toBeInTheDocument()
  })

  it('renders the empty-rooms message when config.rooms is undefined', () => {
    const config: Partial<QshConfigYaml> = { driver: 'ha' }
    render(<StepAuxOutputs config={config} onUpdate={vi.fn()} />)
    expect(screen.getByText(/No rooms defined yet/i)).toBeInTheDocument()
  })
})

describe('StepAuxOutputs — per-room sections', () => {
  it('renders one section per room when three rooms are defined', () => {
    const config: Partial<QshConfigYaml> = {
      driver: 'ha',
      rooms: {
        lounge: mkRoom(),
        kitchen: mkRoom(),
        bedroom: mkRoom(),
      },
    }
    render(<StepAuxOutputs config={config} onUpdate={vi.fn()} />)

    // One <h3> per room with the room name (underscores → spaces).
    expect(screen.getByRole('heading', { level: 3, name: /lounge/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /kitchen/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /bedroom/i })).toBeInTheDocument()

    // One enable checkbox per room.
    const checkboxes = screen.getAllByRole('checkbox', { name: /enable auxiliary output/i })
    expect(checkboxes).toHaveLength(3)
  })
})

describe('StepAuxOutputs — onUpdate threading', () => {
  it('toggling enable then filling ha_entity calls onUpdate with auxiliary_output populated', () => {
    const onUpdate = vi.fn()
    const config: Partial<QshConfigYaml> = {
      driver: 'ha',
      rooms: { lounge: mkRoom() },
    }
    render(<StepAuxOutputs config={config} onUpdate={onUpdate} />)

    // Toggle enable — propagates onUpdate('rooms', { lounge: { ..., auxiliary_output: { enabled:true, ... } } })
    fireEvent.click(screen.getByRole('checkbox', { name: /enable auxiliary output/i }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [section, payload] = onUpdate.mock.calls[0]
    expect(section).toBe('rooms')
    const rooms = payload as Record<string, RoomConfigYaml>
    expect(rooms.lounge.auxiliary_output).toMatchObject({
      enabled: true,
      rated_kw: 0,
      min_on_time_s: 60,
      min_off_time_s: 60,
      max_cycles_per_hour: 6,
    })
  })

  it('disabling an enabled room calls onUpdate with auxiliary_output: null', () => {
    const onUpdate = vi.fn()
    const config: Partial<QshConfigYaml> = {
      driver: 'ha',
      rooms: {
        lounge: mkRoom({
          auxiliary_output: {
            enabled: true,
            ha_entity: 'switch.lounge_panel',
            rated_kw: 1.5,
          },
        }),
      },
    }
    render(<StepAuxOutputs config={config} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /enable auxiliary output/i }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [section, payload] = onUpdate.mock.calls[0]
    expect(section).toBe('rooms')
    const rooms = payload as Record<string, RoomConfigYaml>
    expect(rooms.lounge.auxiliary_output).toBeNull()
  })
})

describe('StepAuxOutputs — driver routing', () => {
  it('HA driver renders the entity-field placeholder', () => {
    const config: Partial<QshConfigYaml> = {
      driver: 'ha',
      rooms: {
        lounge: mkRoom({
          auxiliary_output: { enabled: true, ha_entity: 'switch.x' },
        }),
      },
    }
    render(<StepAuxOutputs config={config} onUpdate={vi.fn()} />)
    expect(screen.getByPlaceholderText('switch.lounge_panel_heater')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('control/lounge/aux')).toBeNull()
  })

  it('MQTT driver renders the topic-field placeholder', () => {
    const config: Partial<QshConfigYaml> = {
      driver: 'mqtt',
      rooms: {
        lounge: mkRoom({
          auxiliary_output: { enabled: true, mqtt_topic: 'control/x' },
        }),
      },
    }
    render(<StepAuxOutputs config={config} onUpdate={vi.fn()} />)
    expect(screen.getByPlaceholderText('control/lounge/aux')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('switch.lounge_panel_heater')).toBeNull()
  })
})
