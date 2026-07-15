import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { StepReview } from '../StepReview'
import { renderHook } from '@testing-library/react'
import { useWizard } from '../../../hooks/useWizard'

// Minimum config that makes StepReview render without runtime errors.
const baseConfig = {
  driver: 'ha' as const,
  rooms: { living_room: { area_m2: 25.0 } },
  heat_source: { type: 'heat_pump' as const },
}

describe('StepReview destructive deploy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders amber destructive banner with removed sections and Force Deploy button when onDeploy returns destructive error', async () => {
    const onDeploy = vi.fn().mockResolvedValue({
      kind: 'destructive',
      removed_sections: ['energy', 'mqtt', 'historian'],
      existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt', 'historian'],
      incoming_sections: ['rooms', 'heat_source'],
    })
    const onForceDeploy = vi.fn()

    render(
      <StepReview
        config={baseConfig}
        validationWarnings={[]}
        acknowledgedRuleIds={[]}
        onAcknowledge={vi.fn()}
        isDeploying={false}
        onDeploy={onDeploy}
        onForceDeploy={onForceDeploy}
      />
    )

    fireEvent.click(screen.getByText('Deploy Configuration'))

    await waitFor(() => {
      expect(screen.getByText('Destructive deploy refused')).toBeDefined()
    })
    expect(screen.getByRole('alert').textContent).toMatch(/energy, mqtt, historian/)
    expect(screen.getByText('Force Deploy')).toBeDefined()
  })

  it('Force Deploy button calls onForceDeploy and surfaces the success path', async () => {
    const onDeploy = vi.fn().mockResolvedValue({
      kind: 'destructive',
      removed_sections: ['energy'],
      existing_sections: ['rooms', 'heat_source', 'energy'],
      incoming_sections: ['rooms', 'heat_source'],
    })
    const onForceDeploy = vi.fn().mockResolvedValue({
      deployed: true,
      yaml_path: '/config/qsh.yaml',
      message: 'Configuration saved.',
      warnings: [],
    })

    render(
      <StepReview
        config={baseConfig}
        validationWarnings={[]}
        acknowledgedRuleIds={[]}
        onAcknowledge={vi.fn()}
        isDeploying={false}
        onDeploy={onDeploy}
        onForceDeploy={onForceDeploy}
      />
    )

    fireEvent.click(screen.getByText('Deploy Configuration'))
    await waitFor(() => {
      expect(screen.getByText('Force Deploy')).toBeDefined()
    })

    fireEvent.click(screen.getByText('Force Deploy'))
    await waitFor(() => {
      expect(onForceDeploy).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(screen.getByText('Configuration Deployed!')).toBeDefined()
    })
  })
})

describe('useWizard.deploy 409 handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('translates a 409 destructive response into a kind:destructive object', async () => {
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

    // The POST body is config + force=false on the regular deploy.
    const fetchCall = mockFetch.mock.calls[0]
    const body = JSON.parse(fetchCall[1].body as string)
    expect(body.force).toBe(false)
  })

  it('forceDeploy posts force=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
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
})

// ── INSTRUCTION-324: acknowledgement UX ──────────────────────────────────

const ackWarnings = [
  { rule_id: 'emitter_kw_defaulted:living_room', message: "Room 'living_room' emitter_kw not set" },
  { rule_id: 'solar_block_no_entity', message: 'A solar block is configured but no live matching entity was found' },
  { rule_id: null, message: 'heat_source.capacity_kw not set — fleet telemetry will report null.' },
]

describe('StepReview acknowledgement gate (INSTRUCTION-324)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderWithAcks = (acknowledged: string[], onAcknowledge = vi.fn(), onDeploy = vi.fn()) => {
    render(
      <StepReview
        config={baseConfig}
        validationWarnings={ackWarnings}
        acknowledgedRuleIds={acknowledged}
        onAcknowledge={onAcknowledge}
        isDeploying={false}
        onDeploy={onDeploy}
        onForceDeploy={vi.fn()}
      />
    )
    return { onAcknowledge, onDeploy }
  }

  it('renders one checkbox per acknowledged-class warning and lists null-rule_id warnings as plain text', () => {
    renderWithAcks([])
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    // The legacy informational warning renders without a checkbox.
    expect(screen.getByText(/fleet telemetry will report null/)).toBeDefined()
  })

  it('disables Deploy until every acknowledged-class warning is ticked', () => {
    renderWithAcks(['emitter_kw_defaulted:living_room'])
    const deployBtn = screen.getByText('Deploy Configuration').closest('button')!
    expect(deployBtn.disabled).toBe(true)
  })

  it('enables Deploy when all acknowledged-class warnings are ticked', () => {
    renderWithAcks(['emitter_kw_defaulted:living_room', 'solar_block_no_entity'])
    const deployBtn = screen.getByText('Deploy Configuration').closest('button')!
    expect(deployBtn.disabled).toBe(false)
  })

  it('ticking a checkbox fires onAcknowledge with the qualified rule id', () => {
    const { onAcknowledge } = renderWithAcks([])
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onAcknowledge).toHaveBeenCalledWith('emitter_kw_defaulted:living_room', true)
  })

  it('renders the outstanding banner when deploy returns an ack_outstanding 409', async () => {
    const onDeploy = vi.fn().mockResolvedValue({
      kind: 'ack_outstanding',
      outstanding: ['emitter_kw_defaulted:living_room'],
    })
    renderWithAcks(['emitter_kw_defaulted:living_room', 'solar_block_no_entity'], vi.fn(), onDeploy)
    fireEvent.click(screen.getByText('Deploy Configuration'))
    await waitFor(() => {
      expect(screen.getByTestId('ack-outstanding-banner')).toBeDefined()
    })
    expect(screen.getByTestId('ack-outstanding-banner').textContent).toMatch(
      /emitter_kw_defaulted:living_room/
    )
  })
})

describe('useWizard acknowledgement threading (INSTRUCTION-324)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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

// ── INSTRUCTION-412 (R5): deploy validation error renders verbatim ───────
describe('StepReview deploy validation error (INSTRUCTION-412)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the backend 422 detail verbatim in a red banner', async () => {
    const detail =
      "heat_sources[0] ('Boiler') flow_min=35.0 is outside the appliance flow capability [50.0, 80.0]."
    const onDeploy = vi.fn().mockResolvedValue({
      kind: 'validation',
      status: 422,
      detail,
    })

    render(
      <StepReview
        config={baseConfig}
        validationWarnings={[]}
        acknowledgedRuleIds={[]}
        onAcknowledge={vi.fn()}
        isDeploying={false}
        onDeploy={onDeploy}
        onForceDeploy={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('Deploy Configuration'))

    await waitFor(() => {
      expect(screen.getByText('Deploy rejected')).toBeDefined()
    })
    expect(screen.getByTestId('deploy-error-banner').textContent).toContain(detail)
    // Success screen must NOT show.
    expect(screen.queryByText('Configuration Deployed!')).toBeNull()
  })
})
