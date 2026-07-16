import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

/**
 * INSTRUCTION-414 — the wizard-chrome integration hole named in Rule 1: no test
 * exercised the FOOTER deploy path, which is why the outcome-swallow shipped.
 * These tests drive the real hook (useWizard), the real chrome (WizardShell),
 * and the real terminal step (StepReview) through to a deploy — the exact seam
 * that shipped broken. The non-review step BODIES are stubbed to `null`: they
 * are irrelevant to the footer-deploy wiring under test and several crash on
 * the empty bootstrap config, which would only test their internals, not the
 * seam. Navigation still runs through the real hook + real footer button.
 */
vi.mock('../../components/wizard/StepRestoreBackup', () => ({ StepRestoreBackup: () => null }))
vi.mock('../../components/wizard/StepWelcome', () => ({ StepWelcome: () => null }))
vi.mock('../../components/wizard/StepConnectionMethod', () => ({ StepConnectionMethod: () => null }))
vi.mock('../../components/wizard/StepHeatSource', () => ({ StepHeatSource: () => null }))
vi.mock('../../components/wizard/StepMqttBroker', () => ({ StepMqttBroker: () => null }))
vi.mock('../../components/wizard/StepSensors', () => ({ StepSensors: () => null }))
vi.mock('../../components/wizard/StepRooms', () => ({ StepRooms: () => null }))
vi.mock('../../components/wizard/StepAuxOutputs', () => ({ StepAuxOutputs: () => null }))
vi.mock('../../components/wizard/StepTariff', () => ({ StepTariff: () => null }))
vi.mock('../../components/wizard/StepSchedules', () => ({ StepSchedules: () => null }))
vi.mock('../../components/wizard/StepThermal', () => ({ StepThermal: () => null }))
vi.mock('../../components/wizard/StepBuilding', () => ({ StepBuilding: () => null }))
vi.mock('../../components/wizard/StepHotWater', () => ({ StepHotWater: () => null }))
vi.mock('../../components/wizard/StepTelemetryAgreement', () => ({ StepTelemetryAgreement: () => null }))
vi.mock('../../components/wizard/StepDisclaimer', () => ({ StepDisclaimer: () => null }))

// Imported after the mocks are declared (vi.mock is hoisted regardless).
import { Wizard } from '../Wizard'

// A fetch mock that answers every wizard validate as "valid" (so the footer
// Next advances through every step) and routes the deploy call to a supplied
// responder.
function installFetch(deployResponder: () => unknown) {
  const mock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/deploy')) {
      return deployResponder()
    }
    // validate
    return { ok: true, json: async () => ({ valid: true, errors: [], warnings: [] }) }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const deployUrlCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.filter((c) => String(c[0]).includes('/deploy'))

// Click the footer primary (labelled Next on every step except review, Deploy
// on review) until the review step is reached.
async function driveToReview() {
  // HA branch: 15 steps, review is index 14 → 14 forward clicks.
  for (let i = 0; i < 14; i++) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
  }
  // On review, the footer primary is labelled "Deploy". State is already
  // flushed by the act() above, so no waitFor is needed (waitFor polls via
  // timers and would deadlock the fake-timer test below).
  expect(screen.getByRole('button', { name: /^deploy$/i })).toBeDefined()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Wizard footer deploy path (INSTRUCTION-414)', () => {
  it('QG1 (Alun replay) — footer Deploy on a 422 renders the deploy-error banner with the detail verbatim, no redirect', async () => {
    const detail =
      "heat_sources[0] ('Boiler') flow_min=35.0 is outside the appliance flow capability [50.0, 80.0]."
    installFetch(() => ({
      ok: false,
      status: 422,
      json: async () => ({ detail }),
    }))
    const onComplete = vi.fn()
    render(<Wizard onComplete={onComplete} onExit={vi.fn()} />)

    await driveToReview()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^deploy$/i }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('deploy-error-banner')).toBeDefined()
    })
    expect(screen.getByTestId('deploy-error-banner').textContent).toContain(detail)
    expect(screen.queryByText('Configuration Deployed!')).toBeNull()
    expect(onComplete).not.toHaveBeenCalled()
    // The footer button re-enables once isDeploying falls.
    expect(
      (screen.getByRole('button', { name: /^deploy$/i }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('QG5 — a network failure renders the amber network banner', async () => {
    installFetch(() => {
      throw new Error('unreachable')
    })
    render(<Wizard onComplete={vi.fn()} onExit={vi.fn()} />)

    await driveToReview()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^deploy$/i }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('deploy-network-banner')).toBeDefined()
    })
  })

  it('QG4 — a double-click on the footer Deploy issues exactly one deploy fetch (ref guard)', async () => {
    const mock = installFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        deployed: true,
        yaml_path: '/config/qsh.yaml',
        message: 'ok',
        warnings: [],
      }),
    }))
    render(<Wizard onComplete={vi.fn()} onExit={vi.fn()} />)

    await driveToReview()
    await act(async () => {
      const btn = screen.getByRole('button', { name: /^deploy$/i })
      fireEvent.click(btn)
      fireEvent.click(btn)
    })

    expect(deployUrlCalls(mock)).toHaveLength(1)
  })

  it('QG4 — a successful deploy shows the success screen, seals all three egress channels, then redirects at 3s', async () => {
    vi.useFakeTimers()
    try {
      installFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
          deployed: true,
          yaml_path: '/config/qsh.yaml',
          message: 'Configuration saved.',
          warnings: [],
        }),
      }))
      const onComplete = vi.fn()
      render(<Wizard onComplete={onComplete} onExit={vi.fn()} />)

      await driveToReview()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^deploy$/i }))
      })

      // Success screen replaces the review body.
      expect(screen.getByText('Configuration Deployed!')).toBeDefined()

      // All three egress channels are sealed from resolution onward.
      const primary = screen.getByRole('button', { name: /^deploy$/i }) as HTMLButtonElement
      const back = screen.getByRole('button', { name: /back/i }) as HTMLButtonElement
      expect(primary.disabled).toBe(true)
      expect(back.disabled).toBe(true)
      expect(screen.queryByTitle('Exit wizard')).toBeNull()

      // Redirect fires at 3 s.
      expect(onComplete).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      expect(onComplete).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
