import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWizard } from '../useWizard'

describe('useWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to HA branch with 15 steps', () => {
    // INSTRUCTION-162B: HA gained an `aux_outputs` step between `rooms` and
    // `tariff` (13 → 14). INSTRUCTION-368: HA gained a `building` step after
    // `thermal` (14 → 15).
    const { result } = renderHook(() => useWizard())
    expect(result.current.totalSteps).toBe(15)
    expect(result.current.stepName).toBe('restore_backup')
  })

  it('HA branch step sequence skips MQTT Broker', () => {
    const { result } = renderHook(() => useWizard())
    expect(result.current.steps).not.toContain('mqtt_broker')
    expect(result.current.totalSteps).toBe(15)
  })

  it('MQTT branch includes MQTT Broker step with 16 steps', () => {
    // INSTRUCTION-162B: MQTT path gained `aux_outputs` (14 → 15).
    // INSTRUCTION-368: MQTT gained `building` after `thermal` (15 → 16).
    // Mock validation endpoint
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [], warnings: [] }),
    } as Response)

    const { result } = renderHook(() => useWizard())

    // Set driver to mqtt
    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })

    expect(result.current.totalSteps).toBe(16)
    expect(result.current.steps).toContain('mqtt_broker')
  })

  it('building step sits after thermal, before review, in both branches', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [], warnings: [] }),
    } as Response)

    const { result } = renderHook(() => useWizard())
    const haSteps = [...result.current.steps]
    const haThermalIdx = haSteps.indexOf('thermal')
    const haBuildingIdx = haSteps.indexOf('building')
    const haReviewIdx = haSteps.indexOf('review')
    expect(haBuildingIdx).toBe(haThermalIdx + 1)
    expect(haBuildingIdx).toBeLessThan(haReviewIdx)

    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })
    const mqttSteps = [...result.current.steps]
    const mqttThermalIdx = mqttSteps.indexOf('thermal')
    const mqttBuildingIdx = mqttSteps.indexOf('building')
    const mqttReviewIdx = mqttSteps.indexOf('review')
    expect(mqttBuildingIdx).toBe(mqttThermalIdx + 1)
    expect(mqttBuildingIdx).toBeLessThan(mqttReviewIdx)
  })

  it('aux_outputs step sits between rooms and tariff in both branches', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [], warnings: [] }),
    } as Response)

    const { result } = renderHook(() => useWizard())

    // HA branch
    const haSteps = [...result.current.steps]
    const haRoomsIdx = haSteps.indexOf('rooms')
    const haAuxIdx = haSteps.indexOf('aux_outputs')
    const haTariffIdx = haSteps.indexOf('tariff')
    expect(haAuxIdx).toBeGreaterThan(-1)
    expect(haAuxIdx).toBe(haRoomsIdx + 1)
    expect(haTariffIdx).toBe(haAuxIdx + 1)

    // Switch to MQTT
    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })
    const mqttSteps = [...result.current.steps]
    const mqttRoomsIdx = mqttSteps.indexOf('rooms')
    const mqttAuxIdx = mqttSteps.indexOf('aux_outputs')
    const mqttTariffIdx = mqttSteps.indexOf('tariff')
    expect(mqttAuxIdx).toBeGreaterThan(-1)
    expect(mqttAuxIdx).toBe(mqttRoomsIdx + 1)
    expect(mqttTariffIdx).toBe(mqttAuxIdx + 1)
  })

  it('connection method persists across navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [], warnings: [] }),
    } as Response)

    const { result } = renderHook(() => useWizard())

    // Set driver to mqtt
    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })

    // Navigate forward from welcome
    await act(async () => {
      await result.current.next()
    })

    expect(result.current.config.driver).toBe('mqtt')

    // Navigate back
    act(() => {
      result.current.back()
    })

    expect(result.current.config.driver).toBe('mqtt')
  })

  it('step labels match step count', () => {
    const { result } = renderHook(() => useWizard())
    expect(result.current.stepLabels).toHaveLength(result.current.totalSteps)
  })

  it('MQTT step labels include MQTT Broker', () => {
    const { result } = renderHook(() => useWizard())

    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })

    expect(result.current.stepLabels).toContain('MQTT Broker')
    expect(result.current.stepLabels).toContain('Auxiliary outputs')
    expect(result.current.stepLabels).toHaveLength(16)
  })
})

// ── INSTRUCTION-324: full validation on entering review + ack pruning ────

describe('useWizard review-entry full validation (INSTRUCTION-324)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs a full (step=null) validation when advancing into review and prunes stale acks', async () => {
    const firedWarning = {
      rule_id: 'emitter_kw_defaulted:lounge',
      message: "Room 'lounge' emitter_kw not set",
    }
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string)
        const isFull = body.step === null
        return {
          ok: true,
          json: async () => ({
            valid: true,
            errors: [],
            warnings: isFull ? [firedWarning] : [],
          }),
        } as Response
      })

    const { result } = renderHook(() => useWizard())

    // Position on the step before review (HA branch: disclaimer at index 12)
    const reviewIdx = result.current.steps.indexOf('review')
    act(() => {
      result.current.goToStep(reviewIdx - 1)
    })
    // Tick one stale ack (its rule won't fire) and one that will fire.
    act(() => {
      result.current.toggleAcknowledgement('emitter_kw_defaulted:renamed_room', true)
      result.current.toggleAcknowledgement('emitter_kw_defaulted:lounge', true)
    })

    await act(async () => {
      await result.current.next()
    })

    expect(result.current.stepName).toBe('review')
    // Two validate calls: the step itself, then the full pass.
    const steps = mockFetch.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).step
    )
    expect(steps).toEqual(['disclaimer', null])
    // The review warnings come from the FULL validation.
    expect(result.current.validationWarnings).toEqual([firedWarning])
    // The stale ack (rule no longer fired) is pruned; the live one survives.
    expect(result.current.acknowledgedRuleIds).toEqual([
      'emitter_kw_defaulted:lounge',
    ])
  })
})

// ── INSTRUCTION-412 (R5): deploy 422 is captured, not swallowed ──────────
describe('useWizard deploy validation error (INSTRUCTION-412)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures a non-409 deploy error into a typed validation result with the detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail:
          "heat_sources[0] ('Boiler') flow_min=35.0 is outside the appliance flow capability [50.0, 80.0].",
      }),
    } as Response)

    const { result } = renderHook(() => useWizard())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.deploy()
    })
    expect(outcome).toMatchObject({
      kind: 'validation',
      status: 422,
    })
    expect((outcome as { detail: string }).detail).toMatch(
      /outside the appliance flow capability \[50.0, 80.0\]/,
    )
  })

  it('flattens the validate_config 422 message+errors shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: { message: 'Config validation failed', errors: ['bad thing'] },
      }),
    } as Response)

    const { result } = renderHook(() => useWizard())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.deploy()
    })
    expect((outcome as { detail: string }).detail).toMatch(
      /Config validation failed: bad thing/,
    )
  })
})
