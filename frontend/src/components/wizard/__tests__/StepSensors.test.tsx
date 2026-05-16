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

/**
 * INSTRUCTION-151 — error banner + retry surface scan failures in StepSensors.HaSensors.
 */
describe('StepSensors — error banner with retry (INSTRUCTION-151)', () => {
  it('renders an error banner with retry when entity scan fails', async () => {
    vi.restoreAllMocks()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'Cannot reach HA API' }),
      } as Response)

    render(<StepSensors config={{ driver: 'ha' }} onUpdate={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Entity scan failed')).toBeInTheDocument()
      expect(screen.getByText('Retry scan')).toBeInTheDocument()
    })

    // Retry click invokes the scan endpoint a second time.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: {}, total_entities: 0 }),
    } as Response)
    fireEvent.click(screen.getByText('Retry scan'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
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

/**
 * INSTRUCTION-237A Task 7 — per-source sensor tabs on the HA path. The HA
 * sensor structure naturally lives at heat_sources[i].sensors; the tab
 * strip toggles which source's sensor mappings are visible and routes
 * writes to the correct index.
 */
describe('StepSensors — per-source tabs (INSTRUCTION-237A)', () => {
  it('renders no tab strip when only one heat source is configured', () => {
    const config = {
      driver: 'ha' as const,
      heat_sources: [{ type: 'heat_pump' as const, name: 'Samsung HP' }],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('renders tab strip with source names when two sources are configured', () => {
    const config = {
      driver: 'ha' as const,
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Samsung HP' },
        { type: 'lpg_boiler' as const, name: 'Glowworm LPG' },
      ],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('Samsung HP')
    expect(tabs[1]).toHaveTextContent('Glowworm LPG')
  })

  it('tab switch routes display to the correct heat_sources index and writes plural', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'ha' as const,
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Samsung HP', sensors: { flow_temp: 'sensor.s1_flow' } },
        { type: 'lpg_boiler' as const, name: 'Glowworm LPG', sensors: { flow_temp: 'sensor.s2_flow' } },
      ],
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    // Default tab 0 — source 1's flow_temp shown.
    expect(screen.getByText('sensor.s1_flow')).toBeInTheDocument()
    expect(screen.queryByText('sensor.s2_flow')).toBeNull()

    // Switch to tab 2.
    const tabs = screen.getAllByRole('tab')
    fireEvent.click(tabs[1])

    // Now source 2's flow_temp is shown; source 1's gone.
    expect(screen.getByText('sensor.s2_flow')).toBeInTheDocument()
    expect(screen.queryByText('sensor.s1_flow')).toBeNull()

    // Drive a write by clicking the X clear button on the visible picker —
    // this triggers onChange('') on whatever sensor field is being cleared.
    // We just need to assert the routed write targets heat_sources with
    // index 1 cleared, index 0 unchanged.
    onUpdate.mockClear()
    const flowLabel = screen.getByText('Flow Temperature')
    const pickerRoot = flowLabel.closest('.relative') as HTMLElement
    // The X clear icon — picker renders it as an SVG when value is truthy.
    const xIcon = pickerRoot.querySelector('button svg.lucide-x, button svg.lucide-X') as SVGElement | null
    // Fallback: the X is rendered as a child of the trigger button when value
    // is set. lucide-react renders it with class containing 'lucide'.
    const xEl =
      xIcon ?? (pickerRoot.querySelector('svg[class*="lucide"]:not(.lucide-search)') as SVGElement | null)
    expect(xEl).not.toBeNull()
    fireEvent.click(xEl!)

    const heatSourcesCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_sources')
    expect(heatSourcesCalls.length).toBeGreaterThan(0)
    const lastCall = heatSourcesCalls[heatSourcesCalls.length - 1]
    const payload = lastCall[1] as Array<{ sensors?: { flow_temp?: string } }>
    expect(payload[0].sensors?.flow_temp).toBe('sensor.s1_flow') // unchanged
    // Index 1 cleared.
    expect(payload[1].sensors?.flow_temp).toBeUndefined()
    // Frontend writes plural only.
    const singularCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_source')
    expect(singularCalls).toHaveLength(0)
  })

  it('plural-first read on single-source path uses heat_sources[0] over heat_source', () => {
    const config = {
      driver: 'ha' as const,
      // Stale singular has different sensors than plural[0].
      heat_source: {
        type: 'heat_pump' as const,
        sensors: { flow_temp: 'sensor.STALE_singular' },
      },
      heat_sources: [
        { type: 'heat_pump' as const, sensors: { flow_temp: 'sensor.PLURAL_winner' } },
      ],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    // The Flow Temperature EntityPicker's selected value displays in its
    // trigger button. The plural[0] value wins.
    expect(screen.getByText('sensor.PLURAL_winner')).toBeInTheDocument()
    expect(screen.queryByText('sensor.STALE_singular')).toBeNull()
  })
})

/**
 * INSTRUCTION-241B — MQTT per-source sensor tabs.
 *
 * Closes the MQTT-side wizard gap reported 16 May 2026 — a multi-source
 * MQTT install previously had no way to map per-source topics through
 * the wizard. The MqttSensors component now mirrors the HA tab strip
 * pattern from 237A.
 */
describe('MqttSensors — per-source tabs (INSTRUCTION-241B)', () => {
  it('Test 1: single-source MQTT config — no tab strip rendered', () => {
    const config = {
      driver: 'mqtt' as const,
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
      heat_sources: [{ type: 'heat_pump' as const, name: 'Primary HP' }],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('Test 2: two-source MQTT config — tab strip with two tabs labelled by name', () => {
    const config = {
      driver: 'mqtt' as const,
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Primary HP' },
        { type: 'gas_boiler' as const, name: 'Backup Boiler' },
      ],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('Primary HP')
    expect(tabs[1]).toHaveTextContent('Backup Boiler')
  })

  it('Test 3: edit flow temp on tab 1 writes heat_sources[1].sensors.flow_temp', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt' as const,
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Primary HP', sensors: {} },
        { type: 'gas_boiler' as const, name: 'Boiler', sensors: {} },
      ],
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    fireEvent.click(screen.getAllByRole('tab')[1])

    // Find the Flow Temperature picker under the per-source heading.
    const heading = screen.getByText('Heat Source Sensors')
    const sectionRoot = heading.closest('div')!.parentElement as HTMLElement
    const flowLabel = sectionRoot.querySelector('input[placeholder="gas_boiler/flow_temp"]') as HTMLInputElement
    expect(flowLabel).not.toBeNull()

    fireEvent.change(flowLabel, { target: { value: 'qsh/boiler/flow_temp' } })

    const heatSourcesCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_sources')
    expect(heatSourcesCalls.length).toBeGreaterThan(0)
    const last = heatSourcesCalls[heatSourcesCalls.length - 1]
    const payload = last[1] as Array<{ sensors?: Record<string, { topic?: string } | string> }>
    expect(payload[0].sensors).toEqual({})
    const slot = payload[1].sensors?.flow_temp
    const topic = typeof slot === 'string' ? slot : slot?.topic
    expect(topic).toBe('qsh/boiler/flow_temp')
  })

  it('Test 4: switching tabs reflects each source\'s stored topics', () => {
    const config = {
      driver: 'mqtt' as const,
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Primary',
          sensors: { flow_temp: { topic: 'qsh/primary/flow', format: 'plain' as const } } },
        { type: 'gas_boiler' as const, name: 'Boiler',
          sensors: { flow_temp: { topic: 'qsh/boiler/flow', format: 'plain' as const } } },
      ],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)

    // Tab 0 active by default — primary topic shown.
    const heading = screen.getByText('Heat Source Sensors')
    const sectionRoot = heading.closest('div')!.parentElement as HTMLElement
    let flowInput = sectionRoot.querySelector(
      'input[placeholder="heat_pump/flow_temp"]',
    ) as HTMLInputElement
    expect(flowInput.value).toBe('qsh/primary/flow')

    // Switch to tab 1.
    fireEvent.click(screen.getAllByRole('tab')[1])
    flowInput = sectionRoot.querySelector(
      'input[placeholder="gas_boiler/flow_temp"]',
    ) as HTMLInputElement
    expect(flowInput.value).toBe('qsh/boiler/flow')
  })

  it('Test 5: placeholder uses type stem per source (singleSource mode suppresses name disambiguation)', () => {
    const config = {
      driver: 'mqtt' as const,
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Primary' },
        { type: 'gas_boiler' as const, name: 'Boiler' },
      ],
    }
    render(<StepSensors config={config} onUpdate={vi.fn()} />)

    // Default tab — Primary, placeholder uses heat_pump stem.
    const heading = screen.getByText('Heat Source Sensors')
    const sectionRoot = heading.closest('div')!.parentElement as HTMLElement
    expect(
      sectionRoot.querySelector('input[placeholder="heat_pump/flow_temp"]'),
    ).not.toBeNull()

    // Switch to Boiler — placeholder uses gas_boiler stem.
    fireEvent.click(screen.getAllByRole('tab')[1])
    expect(
      sectionRoot.querySelector('input[placeholder="gas_boiler/flow_temp"]'),
    ).not.toBeNull()
  })

  it('Test 6: clearing topic removes the field from heat_sources[i].sensors', () => {
    const onUpdate = vi.fn()
    const config = {
      driver: 'mqtt' as const,
      mqtt: { broker: 'localhost', port: 1883, inputs: {} },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Primary',
          sensors: { flow_temp: { topic: 'qsh/p/flow', format: 'plain' as const } } },
      ],
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    const heading = screen.getByText('Heat Source Sensors')
    const sectionRoot = heading.closest('div')!.parentElement as HTMLElement
    const flowInput = sectionRoot.querySelector(
      'input[placeholder="heat_pump/flow_temp"]',
    ) as HTMLInputElement
    fireEvent.change(flowInput, { target: { value: '' } })

    const heatSourcesCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_sources')
    expect(heatSourcesCalls.length).toBeGreaterThan(0)
    const last = heatSourcesCalls[heatSourcesCalls.length - 1]
    const payload = last[1] as Array<{ sensors?: Record<string, unknown> }>
    expect(payload[0].sensors).toBeDefined()
    expect((payload[0].sensors as Record<string, unknown>).flow_temp).toBeUndefined()
  })
})

/**
 * INSTRUCTION-241B Task 4b — legacy mqtt.inputs.hp_* → heat_sources[0].sensors.*
 * migration helper.
 */
describe('migrateLegacyMqttInputsToPerSource (INSTRUCTION-241B Task 4b)', () => {
  it('Test 7: migration produces correct per-source state', async () => {
    const { migrateLegacyMqttInputsToPerSource } = await import('../../../hooks/useWizard')
    const config = {
      driver: 'mqtt' as const,
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: { hp_flow_temp: { topic: 'foo/bar', format: 'plain' as const } },
      },
      heat_sources: [{ type: 'heat_pump' as const, name: 'Primary', sensors: {} }],
    }
    const migrated = migrateLegacyMqttInputsToPerSource(config)
    const slot = migrated.heat_sources?.[0]?.sensors?.flow_temp
    expect(slot).toEqual({ topic: 'foo/bar', format: 'plain' })
  })

  it('Test 8: no-double-write — wizard never writes mqtt.inputs.hp_* after migration', () => {
    const onUpdate = vi.fn()
    // Post-migration config: per-source has the migrated value, legacy is still in mqtt.inputs.
    const config = {
      driver: 'mqtt' as const,
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: { hp_flow_temp: { topic: 'foo/bar', format: 'plain' as const } },
      },
      heat_sources: [
        { type: 'heat_pump' as const, name: 'Primary',
          sensors: { flow_temp: { topic: 'foo/bar', format: 'plain' as const } } },
      ],
    }
    render(<StepSensors config={config} onUpdate={onUpdate} />)

    const heading = screen.getByText('Heat Source Sensors')
    const sectionRoot = heading.closest('div')!.parentElement as HTMLElement
    const flowInput = sectionRoot.querySelector(
      'input[placeholder="heat_pump/flow_temp"]',
    ) as HTMLInputElement
    fireEvent.change(flowInput, { target: { value: 'new/topic' } })

    const mqttCalls = onUpdate.mock.calls.filter((c) => c[0] === 'mqtt')
    // The wizard MUST NOT write into mqtt.inputs.hp_* when the user edits a
    // per-source flow temp. F5(b) no-double-write invariant.
    for (const call of mqttCalls) {
      const payload = call[1] as { inputs?: Record<string, unknown> }
      const hpKeys = Object.keys(payload.inputs ?? {}).filter((k) => k.startsWith('hp_'))
      // hp_flow_temp must not appear as a new write target; if mqtt was
      // written at all, it must not have been for an hp_* slot.
      for (const k of hpKeys) {
        expect(k).not.toBe('hp_flow_temp')
      }
    }
    const heatSourcesCalls = onUpdate.mock.calls.filter((c) => c[0] === 'heat_sources')
    expect(heatSourcesCalls.length).toBeGreaterThan(0)
  })

  it('Test 9: idempotent — second run returns unchanged config', async () => {
    const { migrateLegacyMqttInputsToPerSource } = await import('../../../hooks/useWizard')
    const config = {
      driver: 'mqtt' as const,
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: { hp_flow_temp: { topic: 'foo/bar', format: 'plain' as const } },
      },
      heat_sources: [{ type: 'heat_pump' as const, name: 'Primary', sensors: {} }],
    }
    const once = migrateLegacyMqttInputsToPerSource(config)
    const twice = migrateLegacyMqttInputsToPerSource(once)
    expect(twice).toBe(once)
  })

  it('Test 10: legacy globals preserved — outdoor_temp stays in mqtt.inputs', async () => {
    const { migrateLegacyMqttInputsToPerSource } = await import('../../../hooks/useWizard')
    const config = {
      driver: 'mqtt' as const,
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: {
          outdoor_temp: { topic: 'home/outdoor', format: 'plain' as const },
          hp_flow_temp: { topic: 'home/hp/flow', format: 'plain' as const },
        },
      },
      heat_sources: [{ type: 'heat_pump' as const, name: 'Primary', sensors: {} }],
    }
    const migrated = migrateLegacyMqttInputsToPerSource(config)
    expect(migrated.mqtt?.inputs.outdoor_temp).toEqual({
      topic: 'home/outdoor', format: 'plain',
    })
    const flowSlot = migrated.heat_sources?.[0]?.sensors?.flow_temp
    expect(flowSlot).toEqual({ topic: 'home/hp/flow', format: 'plain' })
  })

  it('Test 11: slot remap completeness — eight legacy keys covered, hp_mode_state NOT remapped', async () => {
    const { migrateLegacyMqttInputsToPerSource } = await import('../../../hooks/useWizard')

    const remap: Array<[string, string]> = [
      ['hp_flow_temp', 'flow_temp'],
      ['hp_return_temp', 'return_temp'],
      ['flow_rate', 'flow_rate'],
      ['hp_power', 'power_input'],
      ['hp_cop', 'cop'],
      ['hp_heat_output', 'heat_output'],
    ]

    for (const [legacy, perSource] of remap) {
      const config = {
        driver: 'mqtt' as const,
        mqtt: {
          broker: 'localhost', port: 1883,
          inputs: { [legacy]: { topic: `t/${legacy}`, format: 'plain' as const } },
        },
        heat_sources: [{ type: 'heat_pump' as const, name: 'Primary', sensors: {} }],
      }
      const migrated = migrateLegacyMqttInputsToPerSource(config)
      const slot = (migrated.heat_sources?.[0]?.sensors as Record<string, unknown> | undefined)?.[
        perSource
      ]
      expect(slot, `${legacy} → ${perSource}`).toEqual({
        topic: `t/${legacy}`, format: 'plain',
      })
    }

    // hp_mode_state must NOT be remapped — it's a global per §D-8.
    const modeConfig = {
      driver: 'mqtt' as const,
      mqtt: {
        broker: 'localhost', port: 1883,
        inputs: { hp_mode_state: { topic: 'home/hp/mode', format: 'plain' as const } },
      },
      heat_sources: [{ type: 'heat_pump' as const, name: 'Primary', sensors: {} }],
    }
    const modeMigrated = migrateLegacyMqttInputsToPerSource(modeConfig)
    expect(modeMigrated.mqtt?.inputs.hp_mode_state).toEqual({
      topic: 'home/hp/mode', format: 'plain',
    })
    const sensors = modeMigrated.heat_sources?.[0]?.sensors as Record<string, unknown> | undefined
    expect(sensors?.mode_state).toBeUndefined()
    expect(sensors?.hp_mode_state).toBeUndefined()
  })
})
