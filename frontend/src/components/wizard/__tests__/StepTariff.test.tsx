/**
 * INSTRUCTION-150E Task 7b — StepTariff (provider-aware wizard step).
 *
 * Covers V5 E-M1 (EDF radio gated on backend capability, NOT current
 * config), V2 B-M2 (Octopus Test Connection persists tariff codes), V2
 * E-M3 (EDF region change → debounced test-edf-region call), and the
 * legacy 90E direction-handling tests (Test Connection result rendering).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CycleMessage } from '../../../types/api'

const liveMock = vi.hoisted(() => ({ data: null as CycleMessage | null }))
vi.mock('../../../hooks/useLive', () => ({
  useLive: () => ({ data: liveMock.data, isConnected: true, lastUpdate: 0 }),
}))

import { StepTariff } from '../StepTariff'

const HP_ONLY_CONFIG = {
  energy: {},
  heat_source: { type: 'heat_pump' as const },
}

const BOILER_CONFIG = {
  energy: {},
  heat_source: { type: 'gas_boiler' as const },
}

const HYBRID_CONFIG = {
  energy: {},
  heat_sources: [
    { type: 'heat_pump' as const },
    { type: 'gas_boiler' as const },
  ],
}

const LEGACY_OCTOPUS_CONFIG = {
  energy: {
    octopus: { api_key: 'sk_live_xxx', account_number: 'A-1234' },
  },
  heat_source: { type: 'heat_pump' as const },
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(json),
    json: async () => json,
  } as Response)
}

beforeEach(() => {
  liveMock.data = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StepTariff — electricity provider radio', () => {
  it('renders Octopus + Fixed by default (HP-only install, EDF unsupported)', () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'fixed', 'fallback'],
    }
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('provider-electricity-provider-octopus')).toBeDefined()
    expect(screen.getByTestId('provider-electricity-provider-fixed')).toBeDefined()
    expect(screen.queryByTestId('provider-electricity-provider-edf_freephase')).toBeNull()
  })

  it('EDF radio gated off when capability absent (V5 E-M1)', () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity'],
    }
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    expect(screen.queryByTestId('provider-electricity-provider-edf_freephase')).toBeNull()
  })

  it('EDF radio visible when capability present, even when current provider is Octopus (V1 Catch-22 regression)', () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
      tariff_providers_status: {
        electricity: {
          fuel: 'electricity',
          provider_kind: 'octopus_electricity',
          last_refresh_at: 1745236800,
          stale: false,
          last_price: 0.245,
          source_url: null,
          last_error: null,
          tariff_label: 'Octopus Agile',
        },
      },
    }
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={vi.fn()} />)
    // The radio is present even though no provider currently has provider_kind: 'edf_freephase'.
    expect(screen.getByTestId('provider-electricity-provider-edf_freephase')).toBeDefined()
  })

  it('selecting EDF radio reveals region picker, hides Octopus credentials', () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-edf_freephase'))
    expect(screen.getByLabelText('EDF region')).toBeDefined()
    expect(screen.queryByPlaceholderText('sk_live_...')).toBeNull()
  })

  it('selecting Fixed reveals £/kWh input', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    expect(screen.getByText(/Electricity Rate/i)).toBeDefined()
  })
})

describe('StepTariff — gas section visibility', () => {
  it('renders gas section when install has a gas boiler', () => {
    render(<StepTariff config={BOILER_CONFIG} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('tariff-gas-section')).toBeDefined()
  })

  it('renders gas section for hybrid install (HP + gas boiler)', () => {
    render(<StepTariff config={HYBRID_CONFIG} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('tariff-gas-section')).toBeDefined()
    expect(screen.getByTestId('tariff-electricity-section')).toBeDefined()
  })

  it('does NOT render gas section for HP-only install', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    expect(screen.queryByTestId('tariff-gas-section')).toBeNull()
  })
})

describe('StepTariff — Octopus test connection', () => {
  it('Test Connection POSTs to api/wizard/test-octopus', async () => {
    const fetchSpy = mockFetch({
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE',
      gas_tariff_code: null,
    })
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Test Connection/i))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('api/wizard/test-octopus')
  })

  it('test response populates gas_tariff_code in gas section when both meters present', async () => {
    mockFetch({
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE',
      gas_tariff_code: 'G-1R-TRACKER',
      additional_import_tariffs: [],
    })
    const cfg = {
      energy: {
        octopus: { api_key: 'sk_live_xxx', account_number: 'A-1234' },
      },
      heat_source: { type: 'gas_boiler' as const },
    }
    render(<StepTariff config={cfg} onUpdate={vi.fn()} />)
    // Gas section: switch from default Fixed to Octopus Tracker.
    fireEvent.click(screen.getByTestId('provider-gas-provider-octopus'))
    // Two Test Connection buttons (electricity + gas). After 164 each card
    // owns its own testResult — the gas-card banner only renders the gas
    // tariff code when the user clicks the GAS card's button.
    const buttons = screen.getAllByText(/Test Connection/i)
    fireEvent.click(buttons[1])
    await waitFor(() =>
      expect(screen.getByText(/Connected\. Gas tariff: G-1R-TRACKER/)).toBeDefined(),
    )
  })

  it('persists discovered tariff_code on the electricity provider after success (V2 B-M2)', async () => {
    mockFetch({
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE',
      gas_tariff_code: null,
      additional_import_tariffs: [],
    })
    const onUpdate = vi.fn()
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/Test Connection/i))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled()
      const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]
      const data = lastCall[1] as { electricity?: { octopus_tariff_code?: string } }
      expect(data.electricity?.octopus_tariff_code).toBe('E-1R-AGILE')
    })
  })
})

describe('StepTariff — legacy 90E direction handling (regression)', () => {
  it('renders import + export rows when both present', async () => {
    mockFetch({
      success: true,
      message: 'Connected. Import tariff: E-1R-AGILE-FLEX-22-11-25-A',
      tariff_code: 'E-1R-AGILE-FLEX-22-11-25-A',
      export_tariff: 'E-1R-OUTGOING-FIX-12M-19-05-13-A',
      additional_import_tariffs: [],
      gas_tariff_code: null,
    })
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Test Connection/i))
    // After 164 the electricity-card banner renders the backend's message
    // verbatim (which itself names the import tariff). The dedicated
    // "Import tariff" row label is gone — the banner carries the code.
    await waitFor(() =>
      expect(
        screen.getByText(/Connected\. Import tariff: E-1R-AGILE-FLEX-22-11-25-A/),
      ).toBeDefined(),
    )
    expect(screen.getByText(/Export tariff \(informational/i)).toBeDefined()
    expect(screen.getByText('E-1R-OUTGOING-FIX-12M-19-05-13-A')).toBeDefined()
  })

  it('shows actionable error for export-only account', async () => {
    mockFetch({
      success: false,
      message: 'No import tariff found',
      tariff_code: null,
      export_tariff: 'E-1R-OUTGOING-FIX-12M-A',
      additional_import_tariffs: [],
      gas_tariff_code: null,
    })
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Test Connection/i))
    await waitFor(() =>
      expect(screen.getByText(/No import tariff found/i)).toBeDefined(),
    )
    expect(screen.getByText(/Only an export \(Outgoing\) tariff/i)).toBeDefined()
    expect(screen.queryByText('Import tariff')).toBeNull()
  })

  it('shows multi-MPAN warning when additional_import_tariffs populated', async () => {
    mockFetch({
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-ECO7-DAY-A',
      additional_import_tariffs: ['E-1R-ECO7-NIGHT-A'],
      export_tariff: null,
      gas_tariff_code: null,
    })
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Test Connection/i))
    await waitFor(() =>
      expect(screen.getByText(/Multiple import tariffs detected/i)).toBeDefined(),
    )
    expect(screen.getByText('E-1R-ECO7-NIGHT-A')).toBeDefined()
  })
})

describe('StepTariff — EDF region picker (V2 E-M3)', () => {
  it('lists regions A through P', () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-edf_freephase'))
    const select = screen.getByLabelText('EDF region') as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value).filter((v) => v !== '')
    expect(options).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'])
  })

  it('region change triggers test-edf-region call after debounce', async () => {
    vi.useFakeTimers()
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    const fetchSpy = mockFetch({ success: true, message: 'Region available' })
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-edf_freephase'))
    fireEvent.change(screen.getByLabelText('EDF region'), { target: { value: 'C' } })
    // Before debounce — no call yet.
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('test-edf-region'))).toBeUndefined()
    // After debounce — call fires.
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('test-edf-region'))
    expect(call).toBeDefined()
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.region).toBe('C')
    vi.useRealTimers()
  })

  it('region test failure surfaces error message', async () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    mockFetch({ success: false, message: 'Region not supported' })
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-edf_freephase'))
    fireEvent.change(screen.getByLabelText('EDF region'), { target: { value: 'P' } })
    // Use real timers + waitFor so the 500 ms debounce + fetch + setState
    // chain settles naturally.
    await waitFor(
      () => expect(screen.getByText(/Region not supported/i)).toBeDefined(),
      { timeout: 2000 },
    )
  })
})

describe('StepTariff — Fixed rate validation', () => {
  it('Fixed rate input has min/max/step constraints', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    const input = screen.getByLabelText(/Electricity Rate/i) as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.min).toBe('0.01')
    expect(input.max).toBe('2')
    expect(input.step).toBe('0.001')
  })
})

// ── INSTRUCTION-158C: ha_entity option + sentinel handling ─────────────

describe('StepTariff — ha_entity radio (158C)', () => {
  it('renders ha_entity radio option', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('provider-electricity-provider-ha_entity')).toBeDefined()
  })

  it('selecting ha_entity shows rates entity input', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-ha_entity'))
    const input = screen.getByPlaceholderText(/current_day_rates/) as HTMLInputElement
    expect(input).toBeDefined()
    expect(input.value).toBe('')
  })

  it('legacy hydrate to ha_entity', () => {
    const legacyConfig = {
      energy: {
        octopus: { rates: { current_day: 'event.X' } },
      },
      heat_source: { type: 'heat_pump' as const },
    }
    render(<StepTariff config={legacyConfig} onUpdate={vi.fn()} />)
    const radio = screen.getByTestId('provider-electricity-provider-ha_entity')
    expect(radio.getAttribute('aria-checked')).toBe('true')
    const input = screen.getByPlaceholderText(/current_day_rates/) as HTMLInputElement
    expect(input.value).toBe('event.X')
  })

  it('save omits sentinel api_key', () => {
    const onUpdate = vi.fn()
    const sentinelConfig = {
      energy: {
        electricity: {
          provider: 'octopus' as const,
          octopus_api_key: '***REDACTED***',
          octopus_account_number: 'A-1234',
        },
      },
      heat_source: { type: 'heat_pump' as const },
    }
    render(<StepTariff config={sentinelConfig} onUpdate={onUpdate} />)
    // Trigger a persist by changing the account number — this fires the
    // updateElectricity path that builds the next state via stripSentinels.
    const acctInput = screen.getByPlaceholderText('A-1234ABCD') as HTMLInputElement
    fireEvent.change(acctInput, { target: { value: 'A-NEW' } })
    expect(onUpdate).toHaveBeenCalled()
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]
    expect(lastCall[0]).toBe('energy')
    const payload = lastCall[1]
    expect(payload.electricity.octopus_api_key).toBeUndefined()
    expect(payload.electricity.octopus_account_number).toBe('A-NEW')
  })
})

// ── INSTRUCTION-164: per-fuel tariff Test Connection / persistence ─────

describe('StepTariff — dual-source per-fuel Test Connection (164)', () => {
  function lastEnergyPayload(onUpdate: ReturnType<typeof vi.fn>) {
    const energyCalls = onUpdate.mock.calls.filter((c) => c[0] === 'energy')
    return energyCalls[energyCalls.length - 1]?.[1] as
      | {
          electricity?: { provider?: string; octopus_tariff_code?: string }
          gas?: { octopus_tariff_code?: string; provider?: string }
        }
      | undefined
  }

  it('dual_source_both_octopus_persists_both_tariff_codes', async () => {
    mockFetch({
      success: true,
      message: 'Connected. Import tariff: E-1R-AGILE-24-10-01-H',
      tariff_code: 'E-1R-AGILE-24-10-01-H',
      gas_tariff_code: 'G-1R-SILVER-25-04-15-H',
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    const cfg = {
      energy: {
        electricity: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
      },
      heat_sources: [
        { type: 'heat_pump' as const },
        { type: 'gas_boiler' as const },
      ],
    }
    render(<StepTariff config={cfg} onUpdate={onUpdate} />)
    const elecSection = screen.getByTestId('tariff-electricity-section')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => {
      const payload = lastEnergyPayload(onUpdate)
      expect(payload?.electricity?.octopus_tariff_code).toBe('E-1R-AGILE-24-10-01-H')
      expect(payload?.gas?.octopus_tariff_code).toBe('G-1R-SILVER-25-04-15-H')
    })
  })

  it('dual_source_elec_non_octopus_gas_octopus_persists_gas_only', async () => {
    mockFetch({
      success: false,
      message: 'No import tariff found on this Octopus account.',
      tariff_code: null,
      gas_tariff_code: 'G-1R-SILVER-25-04-15-H',
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    const cfg = {
      energy: {
        electricity: { provider: 'fixed' as const, fixed_rate: 0.27 },
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_gas_only',
          octopus_account_number: 'A-GAS',
        },
      },
      heat_sources: [
        { type: 'heat_pump' as const },
        { type: 'gas_boiler' as const },
      ],
    }
    render(<StepTariff config={cfg} onUpdate={onUpdate} />)
    const gasSection = screen.getByTestId('tariff-gas-section')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/Connected\. Gas tariff: G-1R-SILVER-25-04-15-H/),
      ).toBeDefined(),
    )
    // V2 H1: gas card never leaks electricity wording.
    expect(within(gasSection).queryByText(/E-1R/)).toBeNull()
    // V2 M2: electricity tariff code is unchanged from input config (not
    // written when data.tariff_code is null).
    const payload = lastEnergyPayload(onUpdate)
    expect(payload?.gas?.octopus_tariff_code).toBe('G-1R-SILVER-25-04-15-H')
    expect(payload?.electricity?.octopus_tariff_code).toBeUndefined()
    expect(payload?.electricity?.provider).toBe('fixed')
  })

  it('dual_source_per_fuel_credentials_isolated', async () => {
    const fetchSpy = mockFetch({
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE',
      gas_tariff_code: 'G-1R-TRACKER',
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const user = userEvent.setup()
    const cfg = {
      energy: {
        electricity: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_elec',
          octopus_account_number: 'A-ELEC',
        },
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_gas',
          octopus_account_number: 'A-GAS',
        },
      },
      heat_sources: [
        { type: 'heat_pump' as const },
        { type: 'gas_boiler' as const },
      ],
    }
    render(<StepTariff config={cfg} onUpdate={vi.fn()} />)
    const gasSection = screen.getByTestId('tariff-gas-section')
    const elecSection = screen.getByTestId('tariff-electricity-section')

    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const gasBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(gasBody.api_key).toBe('sk_gas')
    expect(gasBody.account_number).toBe('A-GAS')

    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const elecBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)
    expect(elecBody.api_key).toBe('sk_elec')
    expect(elecBody.account_number).toBe('A-ELEC')
  })

  it('dual_source_test_results_isolated', async () => {
    mockFetch({
      success: true,
      message: 'Found electricity tariff E-1R-AGILE-24-10-01-H',
      tariff_code: 'E-1R-AGILE-24-10-01-H',
      gas_tariff_code: 'G-1R-SILVER-25-04-15-H',
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const user = userEvent.setup()
    const cfg = {
      energy: {
        electricity: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
      },
      heat_sources: [
        { type: 'heat_pump' as const },
        { type: 'gas_boiler' as const },
      ],
    }
    render(<StepTariff config={cfg} onUpdate={vi.fn()} />)
    const elecSection = screen.getByTestId('tariff-electricity-section')
    const gasSection = screen.getByTestId('tariff-gas-section')

    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(elecSection).getByText(/Found electricity tariff E-1R-AGILE-24-10-01-H/),
      ).toBeDefined(),
    )
    expect(
      within(gasSection).queryByText(/Found electricity tariff/),
    ).toBeNull()
    expect(
      within(gasSection).queryByText(/Connected\. Gas tariff/),
    ).toBeNull()

    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/Connected\. Gas tariff: G-1R-SILVER-25-04-15-H/),
      ).toBeDefined(),
    )
    expect(
      within(elecSection).getByText(/Found electricity tariff E-1R-AGILE-24-10-01-H/),
    ).toBeDefined()
  })

  it('gas_card_message_uses_gas_tariff_code', async () => {
    mockFetch({
      success: true,
      message: 'Found electricity tariff E-1R-AGILE-24-10-01-H',
      tariff_code: 'E-1R-AGILE-24-10-01-H',
      gas_tariff_code: 'G-1R-SILVER-25-04-15-H',
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const user = userEvent.setup()
    const cfg = {
      energy: {
        electricity: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
      },
      heat_sources: [
        { type: 'heat_pump' as const },
        { type: 'gas_boiler' as const },
      ],
    }
    render(<StepTariff config={cfg} onUpdate={vi.fn()} />)
    const gasSection = screen.getByTestId('tariff-gas-section')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(within(gasSection).getByText(/G-1R-SILVER-25-04-15-H/)).toBeDefined(),
    )
    // Defect 1 regression pin.
    expect(within(gasSection).queryByText(/E-1R-AGILE/)).toBeNull()
  })

  it('gas_card_red_banner_when_no_gas_meter', async () => {
    mockFetch({
      success: true,
      message: 'Found electricity tariff E-1R-AGILE-24-10-01-H',
      tariff_code: 'E-1R-AGILE-24-10-01-H',
      gas_tariff_code: null,
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    const cfg = {
      energy: {
        electricity: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-DUAL',
        },
      },
      heat_sources: [
        { type: 'heat_pump' as const },
        { type: 'gas_boiler' as const },
      ],
    }
    render(<StepTariff config={cfg} onUpdate={onUpdate} />)
    const gasSection = screen.getByTestId('tariff-gas-section')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    // V2 H1: gas card shows the local "no gas tariff" message — never the
    // electricity success wording.
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/No gas tariff discovered on this account/),
      ).toBeDefined(),
    )
    expect(within(gasSection).queryByText(/E-1R/)).toBeNull()
    // V2 M2 carry-over: gas tariff NOT written; electricity tariff WAS
    // written from data.tariff_code as the cross-fuel side effect.
    const payload = lastEnergyPayload(onUpdate)
    expect(payload?.gas?.octopus_tariff_code).toBeUndefined()
    expect(payload?.electricity?.octopus_tariff_code).toBe('E-1R-AGILE-24-10-01-H')
  })
})
