/**
 * INSTRUCTION-90D — flow_rate sensor binding is present and optional in the
 * wizard's sensor step for both MQTT and HA drivers. StepReview surfaces it
 * so the operator always sees whether the capability fallback is in effect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepSensors } from '../StepSensors'
import { StepReview } from '../StepReview'
import type { EntityCandidate } from '../../../types/config'

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

const mkCandidate = (id: string): EntityCandidate => ({
  entity_id: id,
  friendly_name: id,
  score: 30,
  confidence: 'high',
  state: '0',
  device_class: '',
  unit: '',
})

describe('StepSensors — flow_rate field visibility', () => {
  it('MQTT driver exposes flow rate sensor in core sensors', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    // The label "Flow rate sensor (optional)" appears in core sensors,
    // NOT hidden behind the Additional Sensors toggle.
    expect(screen.getByText(/Flow rate sensor \(optional\)/i)).toBeDefined()
    expect(
      screen.getByText(/Live flow rate \(L\/min\) improves COP calculation/i),
    ).toBeDefined()
  })

  it('MQTT flow_rate is not a required field', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    // Required fields are rendered with an asterisk inside the label —
    // the flow_rate label should not contain one.
    const label = screen.getByText(/Flow rate sensor \(optional\)/i)
    expect(label.textContent).not.toContain('*')
  })

  it('HA driver exposes flow rate entity picker with helper text', () => {
    const config = { driver: 'ha' }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    // HA path shows Flow rate sensor in "Additional HP Sensors" section.
    // Click the disclosure to reveal it.
    const toggle = screen.getByText(/Additional HP Sensors/i)
    fireEvent.click(toggle)
    expect(screen.getByText(/Flow rate sensor \(optional\)/i)).toBeDefined()
    expect(
      screen.getByText(/Live flow rate \(L\/min\) improves COP calculation/i),
    ).toBeDefined()
  })
})

describe('StepReview — flow_rate summary row', () => {
  it('MQTT: shows fallback notice when flow_rate topic unset', () => {
    const config = {
      driver: 'mqtt' as const,
      rooms: {},
      mqtt: {
        broker: 'localhost',
        port: 1883,
        inputs: { hp_flow_temp: { topic: 'test/flow', format: 'plain' as const } },
      },
    }
    render(
      <StepReview
        config={config}
        validationWarnings={[]}
        isDeploying={false}
        onDeploy={async () => null}
        onForceDeploy={async () => null}
      />,
    )
    expect(screen.getByText(/Flow rate sensor/i)).toBeDefined()
    expect(screen.getByText(/Not configured \(capability fallback\)/i)).toBeDefined()
  })

  it('HA: shows configured flow_rate entity when set', () => {
    const config = {
      driver: 'ha' as const,
      rooms: {},
      heat_source: {
        type: 'heat_pump' as const,
        sensors: { flow_rate: 'sensor.hp_flow_rate' },
      },
    }
    render(
      <StepReview
        config={config}
        validationWarnings={[]}
        isDeploying={false}
        onDeploy={async () => null}
        onForceDeploy={async () => null}
      />,
    )
    expect(screen.getByText(/Flow rate sensor/i)).toBeDefined()
    expect(screen.getByText('sensor.hp_flow_rate')).toBeDefined()
  })

  it('HA: shows fallback notice when flow_rate entity unset', () => {
    const config = {
      driver: 'ha' as const,
      rooms: {},
      heat_source: { type: 'heat_pump' as const, sensors: {} },
    }
    render(
      <StepReview
        config={config}
        validationWarnings={[]}
        isDeploying={false}
        onDeploy={async () => null}
        onForceDeploy={async () => null}
      />,
    )
    expect(screen.getByText(/Flow rate sensor/i)).toBeDefined()
    expect(screen.getByText(/Not configured \(capability fallback\)/i)).toBeDefined()
  })
})

/**
 * INSTRUCTION-127A — MQTT Hot Water Signals section: DHW primary +
 * secondary-OR TopicPickers render always-visible in StepSensors.MqttSensors,
 * and editing dispatches onUpdate('mqtt', ...) preserving other inputs keys.
 */
describe('StepSensors — Hot Water Signals (INSTRUCTION-127A)', () => {
  it('MQTT driver: DHW Active (primary) TopicPicker renders (not collapsed)', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.getByText('DHW Active (primary)')).toBeInTheDocument()
    // YAML-key reference is rendered in the helper text via <code>.
    expect(screen.getByText('mqtt.inputs.hot_water_active')).toBeInTheDocument()
  })

  it('MQTT driver: DHW Active Boolean (optional OR) TopicPicker renders', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.getByText('DHW Active Boolean (optional OR)')).toBeInTheDocument()
    const boolHelpers = screen.getAllByText(/OR'd with the primary/i)
    expect(boolHelpers.length).toBeGreaterThan(0)
  })

  it('MQTT driver: typing the primary topic dispatches onUpdate(\'mqtt\', ...) preserving other inputs keys', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt',
      mqtt: {
        broker: 'localhost',
        port: 1883,
        inputs: {
          outdoor_temp: { topic: 'sensors/outdoor_temp', format: 'plain' },
        },
      },
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    // Find the primary DHW input by proximity to its label.
    const label = screen.getByText('DHW Active (primary)')
    const labelWrapper = label.closest('div')?.parentElement
    expect(labelWrapper).not.toBeNull()
    const input = labelWrapper!.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()

    fireEvent.change(input, { target: { value: 'heat_pump/dhw/active' } })

    expect(onUpdate).toHaveBeenCalledWith('mqtt', expect.objectContaining({
      inputs: expect.objectContaining({
        outdoor_temp: expect.objectContaining({ topic: 'sensors/outdoor_temp' }),
        hot_water_active: expect.objectContaining({ topic: 'heat_pump/dhw/active' }),
      }),
    }))
  })
})

/**
 * INSTRUCTION-145 — wizard scan-complete feedback and mandatory-field markers.
 */
describe('StepSensors — scan-complete feedback (INSTRUCTION-145)', () => {
  it('HA path: shows green badge with plural after auto-scan resolves', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: {
          hp_flow_temp: [mkCandidate('sensor.flow_a'), mkCandidate('sensor.flow_b')],
          hp_power: [mkCandidate('sensor.power_a')],
        },
        total_entities: 42,
      }),
    } as Response)

    render(<StepSensors config={{ driver: 'ha' }} onUpdate={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/Scanned — 3 candidates found/)).toBeInTheDocument()
    })
  })

  it('HA path: shows green badge with singular for exactly one candidate', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: { hp_flow_temp: [mkCandidate('sensor.flow_a')] },
        total_entities: 5,
      }),
    } as Response)

    render(<StepSensors config={{ driver: 'ha' }} onUpdate={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/Scanned — 1 candidate found/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Scanned — 1 candidates/)).toBeNull()
  })
})

describe('StepSensors — mandatory markers (INSTRUCTION-145)', () => {
  it('HA path: Flow Temperature, Power Input, Outdoor Temperature labels carry red asterisk', async () => {
    render(<StepSensors config={{ driver: 'ha' }} onUpdate={vi.fn()} />)
    // Flush the auto-scan promise so post-render setState lands inside act().
    await waitFor(() => expect(screen.getByText('Mandatory')).toBeInTheDocument())
    for (const text of ['Flow Temperature', 'Power Input', 'Outdoor Temperature']) {
      const labelEl = screen.getByText(text).closest('label')
      expect(labelEl).not.toBeNull()
      const star = Array.from(labelEl!.querySelectorAll('span')).find(
        (s) => s.textContent === '*',
      )
      expect(star).toBeDefined()
      expect(star!.className).toContain('text-[var(--red)]')
    }
  })

  it('HA path: legend "Mandatory" is rendered with adjacent red asterisk', async () => {
    render(<StepSensors config={{ driver: 'ha' }} onUpdate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Mandatory')).toBeInTheDocument())
    const legend = screen.getByText('Mandatory')
    const prev = legend.previousElementSibling as HTMLElement | null
    expect(prev).not.toBeNull()
    expect(prev!.tagName).toBe('SPAN')
    expect(prev!.textContent).toBe('*')
    expect(prev!.className).toContain('text-[var(--red)]')
  })

  it('MQTT path: legend "Mandatory" is rendered with adjacent red asterisk', () => {
    const config = {
      driver: 'mqtt',
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    const legend = screen.getByText('Mandatory')
    expect(legend).toBeInTheDocument()
    const prev = legend.previousElementSibling as HTMLElement | null
    expect(prev).not.toBeNull()
    expect(prev!.tagName).toBe('SPAN')
    expect(prev!.textContent).toBe('*')
    expect(prev!.className).toContain('text-[var(--red)]')
  })
})
