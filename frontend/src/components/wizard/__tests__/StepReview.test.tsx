import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepReview } from '../StepReview'
import type {
  AckOutstandingError,
  DeployNetworkError,
  DeployOutcome,
  DeployResponse,
  DestructiveDeployError,
  DeployValidationError,
  WizardWarning,
} from '../../../types/config'
import type { SysidResponse } from '../../../types/api'

// INSTRUCTION-420 — the review page hosts a sensor-cadence ADVISORY fed by
// useSysid. Mocked module-wide so no test performs a real fetch; individual
// tests swap the payload via mockSysidData.
let mockSysidData: SysidResponse | null = null
vi.mock('../../../hooks/useSysid', () => ({
  useSysid: () => ({ data: mockSysidData, error: null }),
}))

// Minimum config that makes StepReview render without runtime errors.
const baseConfig = {
  driver: 'ha' as const,
  rooms: { living_room: { area_m2: 25.0 } },
  heat_source: { type: 'heat_pump' as const },
}

// INSTRUCTION-414 — StepReview is now a pure renderer over the typed
// deployOutcome prop. The deploy trigger is the footer button (WizardShell);
// StepReview owns no local outcome state and no deploy handler of its own.
function renderReview(
  props: {
    deployOutcome?: DeployOutcome | null
    isDeploying?: boolean
    validationWarnings?: WizardWarning[]
    acknowledgedRuleIds?: string[]
    onAcknowledge?: (ruleId: string, on: boolean) => void
    onForceDeploy?: () => Promise<DeployOutcome | null>
  } = {}
) {
  const onAcknowledge = props.onAcknowledge ?? vi.fn()
  const onForceDeploy = props.onForceDeploy ?? vi.fn().mockResolvedValue(null)
  render(
    <StepReview
      config={baseConfig}
      validationWarnings={props.validationWarnings ?? []}
      acknowledgedRuleIds={props.acknowledgedRuleIds ?? []}
      onAcknowledge={onAcknowledge}
      isDeploying={props.isDeploying ?? false}
      deployOutcome={props.deployOutcome ?? null}
      onForceDeploy={onForceDeploy}
    />
  )
  return { onAcknowledge, onForceDeploy }
}

const destructiveOutcome: DestructiveDeployError = {
  kind: 'destructive',
  removed_sections: ['energy', 'mqtt', 'historian'],
  existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt', 'historian'],
  incoming_sections: ['rooms', 'heat_source'],
}

const successOutcome: DeployResponse = {
  deployed: true,
  yaml_path: '/config/qsh.yaml',
  message: 'Configuration saved.',
  warnings: [],
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ── D1/D3: single affordance — no inline Deploy button ───────────────────
describe('StepReview single affordance (INSTRUCTION-414 D1)', () => {
  it('renders no inline deploy control — the footer button is the sole trigger', () => {
    renderReview()
    // The only button StepReview owns (with no outcome) is Download Config; the
    // former inline deploy button is gone, so nothing matches /deploy/i.
    expect(screen.queryByRole('button', { name: /deploy/i })).toBeNull()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toContain('Download Config')
  })

  it('always renders Download Config', () => {
    renderReview()
    expect(screen.getByText('Download Config')).toBeDefined()
  })
})

// ── D3/M2: five outcome variants render from the prop ────────────────────
describe('StepReview outcome rendering (INSTRUCTION-414 D3)', () => {
  it('renders the destructive banner with removed sections and an in-banner Force Deploy button', () => {
    renderReview({ deployOutcome: destructiveOutcome })
    expect(screen.getByText('Destructive deploy refused')).toBeDefined()
    const banner = screen.getByTestId('destructive-banner')
    expect(banner.textContent).toMatch(/energy, mqtt, historian/)
    // Force Deploy lives INSIDE the destructive banner (D4).
    expect(banner.querySelector('button')?.textContent).toContain('Force Deploy')
  })

  it('renders the deploy validation-error banner verbatim (412 detail) and not the success screen', () => {
    const detail =
      "heat_sources[0] ('Boiler') flow_min=35.0 is outside the appliance flow capability [50.0, 80.0]."
    const outcome: DeployValidationError = { kind: 'validation', status: 422, detail }
    renderReview({ deployOutcome: outcome })
    expect(screen.getByText('Deploy rejected')).toBeDefined()
    expect(screen.getByTestId('deploy-error-banner').textContent).toContain(detail)
    expect(screen.queryByText('Configuration Deployed!')).toBeNull()
  })

  it('renders the ack-outstanding banner with the outstanding ids', () => {
    const outcome: AckOutstandingError = {
      kind: 'ack_outstanding',
      outstanding: ['emitter_kw_defaulted:living_room'],
    }
    renderReview({ deployOutcome: outcome })
    expect(screen.getByTestId('ack-outstanding-banner').textContent).toMatch(
      /emitter_kw_defaulted:living_room/
    )
  })

  it('renders the amber network banner (D7) with the advisory copy', () => {
    const outcome: DeployNetworkError = {
      kind: 'network',
      detail:
        'Deploy request did not complete — the add-on may be unreachable or already restarting. Check the add-on log before retrying.',
    }
    renderReview({ deployOutcome: outcome })
    const banner = screen.getByTestId('deploy-network-banner')
    expect(banner.textContent).toMatch(/did not complete/i)
    expect(banner.textContent).toMatch(/unreachable or already restarting/i)
  })

  it('renders the success screen (full-page replacement) from a deployed response', () => {
    renderReview({ deployOutcome: successOutcome })
    expect(screen.getByText('Configuration Deployed!')).toBeDefined()
    // The review body (Download Config) is replaced by the success screen.
    expect(screen.queryByText('Download Config')).toBeNull()
  })

  it('renders no outcome banner when deployOutcome is null', () => {
    renderReview({ deployOutcome: null })
    expect(screen.queryByTestId('deploy-outcome-region')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ── D4/L2: Force Deploy is an escalation inside the destructive banner ────
describe('StepReview Force Deploy escalation (INSTRUCTION-414 D4/L2)', () => {
  it('Force Deploy click calls onForceDeploy', async () => {
    const onForceDeploy = vi.fn().mockResolvedValue(successOutcome)
    renderReview({ deployOutcome: destructiveOutcome, onForceDeploy })
    fireEvent.click(screen.getByText('Force Deploy'))
    await waitFor(() => expect(onForceDeploy).toHaveBeenCalledOnce())
  })

  it('the destructive banner and its disabled Force button persist while a force flight is in progress (QG2)', () => {
    // isDeploying=true while the destructive outcome is retained (L2 — the hook
    // holds the refusal through the force flight).
    renderReview({ deployOutcome: destructiveOutcome, isDeploying: true })
    expect(screen.getByTestId('destructive-banner')).toBeDefined()
    const forceBtn = screen.getByText('Force Deploy').closest('button')!
    expect(forceBtn.disabled).toBe(true)
  })

  it('QG8 prop contract — destructive outcome + outstanding acknowledgements disables Force with the count title', () => {
    // Production-unreachable after the tick-seal, but the pure renderer must
    // render any prop combination sanely (R1(iii)).
    const warnings: WizardWarning[] = [
      { rule_id: 'emitter_kw_defaulted:living_room', message: 'x' },
      { rule_id: 'solar_block_no_entity', message: 'y' },
    ]
    renderReview({
      deployOutcome: destructiveOutcome,
      validationWarnings: warnings,
      acknowledgedRuleIds: [],
    })
    const forceBtn = screen.getByText('Force Deploy').closest('button')!
    expect(forceBtn.disabled).toBe(true)
    expect(forceBtn.title).toBe('2 warnings awaiting confirmation')
  })
})

// ── D8/R3/QG10: refusal scrolled into view, role="alert" alone ───────────
describe('StepReview refusal visibility (INSTRUCTION-414 D8/R3)', () => {
  it('the outcome region carries role="alert" and no explicit aria-live', () => {
    renderReview({ deployOutcome: destructiveOutcome })
    const region = screen.getByTestId('deploy-outcome-region')
    expect(region.getAttribute('role')).toBe('alert')
    expect(region.getAttribute('aria-live')).toBeNull()
  })

  it('scrolls the outcome region into view on a refusal', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderReview({ deployOutcome: destructiveOutcome })
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })

  it('does NOT scroll on a success outcome (body is replaced)', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderReview({ deployOutcome: successOutcome })
    // Give the effect a tick to run.
    await Promise.resolve()
    expect(spy).not.toHaveBeenCalled()
  })
})

// ── R1/QG11: acknowledgement tick-seal while a flight is in progress ──────
const ackWarnings: WizardWarning[] = [
  { rule_id: 'emitter_kw_defaulted:living_room', message: "Room 'living_room' emitter_kw not set" },
  { rule_id: 'solar_block_no_entity', message: 'A solar block is configured but no live matching entity was found' },
  { rule_id: null, message: 'heat_source.capacity_kw not set — fleet telemetry will report null.' },
]

describe('StepReview acknowledgement controls (INSTRUCTION-324 + 414 tick-seal)', () => {
  it('renders one checkbox per acknowledged-class warning and the null-rule_id warning as plain text', () => {
    renderReview({ validationWarnings: ackWarnings })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText(/fleet telemetry will report null/)).toBeDefined()
  })

  it('ticking a checkbox fires onAcknowledge with the qualified rule id', () => {
    const { onAcknowledge } = renderReview({ validationWarnings: ackWarnings })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onAcknowledge).toHaveBeenCalledWith('emitter_kw_defaulted:living_room', true)
  })

  it('QG11 — every acknowledgement checkbox is disabled while isDeploying', () => {
    renderReview({ validationWarnings: ackWarnings, isDeploying: true })
    for (const cb of screen.getAllByRole('checkbox')) {
      expect((cb as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('checkboxes are enabled when not deploying', () => {
    renderReview({ validationWarnings: ackWarnings, isDeploying: false })
    for (const cb of screen.getAllByRole('checkbox')) {
      expect((cb as HTMLInputElement).disabled).toBe(false)
    }
  })
})

// ── INSTRUCTION-420 — sensor reporting advisory (never blocking) ──────────
describe('StepReview sensor-cadence advisory (INSTRUCTION-420)', () => {
  afterEach(() => {
    mockSysidData = null
  })

  it('renders the honest measuring state when no cadence data exists', () => {
    mockSysidData = null
    renderReview()
    const advisory = screen.getByTestId('sensor-cadence-advisory')
    expect(advisory).toHaveTextContent(/Measuring/)
    expect(advisory).toHaveTextContent(/Engineering page after the first night/)
  })

  it('renders per-room classes where data exists, with Blocked copy naming the fix', () => {
    mockSysidData = {
      rooms: {
        living_room: {
          u_kw_per_c: 0.2, c_kwh_per_c: 1.0, u_observations: 3,
          c_observations: 0, c_source: 'Prior', pc_fits: 0, solar_gain: 0,
          confidence: 'low',
          sensor_cadence: {
            class: 'blocked', median_step_c: 0.5, median_interval_s: 600,
            admissible_fraction: 0, event_count: 20, window_span_s: 12000,
          },
        },
        kitchen: {
          u_kw_per_c: 0.1, c_kwh_per_c: 0.8, u_observations: 200,
          c_observations: 30, c_source: 'PC', pc_fits: 4, solar_gain: 0.1,
          confidence: 'high',
          sensor_cadence: {
            class: 'ok', median_step_c: 0.01, median_interval_s: 60,
            admissible_fraction: 1, event_count: 50, window_span_s: 3000,
          },
        },
      },
    }
    renderReview()
    const advisory = screen.getByTestId('sensor-cadence-advisory')
    expect(advisory).toHaveTextContent(/living room/i)
    expect(advisory).toHaveTextContent('Blocked')
    // QG5 — the Blocked copy names the mechanism knobs.
    expect(advisory).toHaveTextContent(/reporting deadband/)
    expect(advisory).toHaveTextContent(/minimum-report-interval/)
    expect(advisory).toHaveTextContent(/device class/)
    expect(advisory).toHaveTextContent('OK')
  })

  it('advisory is informational — no deploy gating text, no ack entries', () => {
    mockSysidData = {
      rooms: {
        living_room: {
          u_kw_per_c: 0.2, c_kwh_per_c: 1.0, u_observations: 3,
          c_observations: 0, c_source: 'Prior', pc_fits: 0, solar_gain: 0,
          confidence: 'low',
          sensor_cadence: {
            class: 'blocked', median_step_c: 0.5, median_interval_s: 600,
            admissible_fraction: 0, event_count: 20, window_span_s: 12000,
          },
        },
      },
    }
    renderReview()
    // A Blocked room adds NO acknowledgement checkbox and NO outcome banner.
    expect(screen.queryByTestId('ack-outstanding-banner')).toBeNull()
    expect(screen.queryByTestId('deploy-outcome-region')).toBeNull()
    expect(
      screen.getByTestId('sensor-cadence-advisory')
    ).toHaveTextContent(/never blocks deployment/i)
  })
})
