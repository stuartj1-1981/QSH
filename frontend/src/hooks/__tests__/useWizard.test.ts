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

// ── INSTRUCTION-414: deploy-outcome state lifecycle + re-entrancy ─────────
describe('useWizard deploy outcome lifecycle (INSTRUCTION-414)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mock422 = () =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'flow limits out of range' }),
    } as Response)

  it('stores a 422 outcome in deployOutcome (single home)', async () => {
    mock422()
    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.deploy()
    })
    expect(result.current.deployOutcome).toMatchObject({
      kind: 'validation',
      status: 422,
    })
  })

  it('clears deployOutcome on back()', async () => {
    mock422()
    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.deploy()
    })
    expect(result.current.deployOutcome).not.toBeNull()
    act(() => {
      result.current.back()
    })
    expect(result.current.deployOutcome).toBeNull()
  })

  it('clears deployOutcome on updateConfig (a submission-changing edit)', async () => {
    mock422()
    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.deploy()
    })
    act(() => {
      result.current.updateConfig('thermal', { peak_loss_kw: 6 })
    })
    expect(result.current.deployOutcome).toBeNull()
  })

  it('clears deployOutcome on setConfig (wholesale config load — R4)', async () => {
    mock422()
    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.deploy()
    })
    act(() => {
      result.current.setConfig({ driver: 'ha', rooms: {} })
    })
    expect(result.current.deployOutcome).toBeNull()
  })

  it('clears deployOutcome on toggleAcknowledgement (ack banner self-heal — L1)', async () => {
    mock422()
    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.deploy()
    })
    act(() => {
      result.current.toggleAcknowledgement('emitter_kw_defaulted:lounge', true)
    })
    expect(result.current.deployOutcome).toBeNull()
  })

  it('captures a network failure as a typed outcome, never null (D7)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unreachable'))
    const { result } = renderHook(() => useWizard())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.deploy()
    })
    expect(outcome).toMatchObject({ kind: 'network' })
    expect(result.current.deployOutcome).toMatchObject({ kind: 'network' })
  })

  it('retains the destructive outcome through the force flight (does not clear at entry — L2)', async () => {
    let resolveForce: (v: unknown) => void = () => {}
    const mockFetch = vi
      .fn()
      // First call: a normal deploy that 409s destructive.
      .mockResolvedValueOnce({
        status: 409,
        json: async () => ({ detail: { removed_sections: ['energy'] } }),
      })
      // Second call: the force flight — pending until we resolve it.
      .mockImplementationOnce(
        () => new Promise((r) => { resolveForce = r as (v: unknown) => void })
      )
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.deploy()
    })
    expect(result.current.deployOutcome).toMatchObject({ kind: 'destructive' })

    // Start the force flight without resolving.
    let forcePromise: Promise<unknown> = Promise.resolve()
    act(() => {
      forcePromise = result.current.forceDeploy() as Promise<unknown>
    })
    // Mid-flight: the destructive refusal is RETAINED, not cleared.
    expect(result.current.deployOutcome).toMatchObject({ kind: 'destructive' })
    expect(result.current.isDeploying).toBe(true)

    // Resolve to success; the outcome flips to the deployed response.
    await act(async () => {
      resolveForce({
        ok: true,
        status: 200,
        json: async () => ({
          deployed: true,
          yaml_path: '/config/qsh.yaml',
          message: 'ok',
          warnings: [],
        }),
      })
      await forcePromise
    })
    expect(result.current.deployOutcome).toMatchObject({ deployed: true })
  })

  it('re-entrancy: two deploy() calls in one act issue exactly one fetch (ref guard — R2)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        deployed: true,
        yaml_path: '/config/qsh.yaml',
        message: 'ok',
        warnings: [],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    await act(async () => {
      const p1 = result.current.deploy()
      const p2 = result.current.deploy()
      await Promise.all([p1, p2])
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ── INSTRUCTION-414: hook deploy 409 / acknowledgement threading ─────────
// (relocated from StepReview.test.tsx, which is now purely a prop-driven
//  renderer suite.)
describe('useWizard deploy 409 + acknowledgement threading', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('translates a 409 destructive response into a kind:destructive object; posts force=false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 409,
      json: () =>
        Promise.resolve({
          detail: {
            message: 'Refusing destructive deploy',
            removed_sections: ['energy', 'mqtt'],
            existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt'],
            incoming_sections: ['rooms', 'heat_source'],
          },
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    let deployResult: unknown
    await act(async () => {
      deployResult = await result.current.deploy()
    })

    expect(deployResult).toEqual({
      kind: 'destructive',
      removed_sections: ['energy', 'mqtt'],
      existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt'],
      incoming_sections: ['rooms', 'heat_source'],
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.force).toBe(false)
  })

  it('forceDeploy posts force=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          deployed: true,
          yaml_path: '/config/qsh.yaml',
          message: 'ok',
          warnings: [],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.forceDeploy()
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.force).toBe(true)
  })

  it('deploy posts acknowledged_rule_ids and translates the ack 409', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 409,
      json: () =>
        Promise.resolve({
          detail: {
            message: 'Deploy blocked',
            outstanding: ['emitter_kw_defaulted:lounge'],
          },
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    act(() => {
      result.current.toggleAcknowledgement('solar_block_no_entity', true)
    })
    let deployResult: unknown
    await act(async () => {
      deployResult = await result.current.deploy()
    })

    expect(deployResult).toEqual({
      kind: 'ack_outstanding',
      outstanding: ['emitter_kw_defaulted:lounge'],
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.acknowledged_rule_ids).toEqual(['solar_block_no_entity'])
  })

  it('toggleAcknowledgement adds and removes rule ids', () => {
    const { result } = renderHook(() => useWizard())
    act(() => {
      result.current.toggleAcknowledgement('a:1', true)
      result.current.toggleAcknowledgement('b:2', true)
    })
    expect(result.current.acknowledgedRuleIds.sort()).toEqual(['a:1', 'b:2'])
    act(() => {
      result.current.toggleAcknowledgement('a:1', false)
    })
    expect(result.current.acknowledgedRuleIds).toEqual(['b:2'])
  })
})
