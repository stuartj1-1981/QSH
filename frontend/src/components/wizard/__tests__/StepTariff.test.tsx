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

  it('selecting Fixed reveals p/kWh input', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    expect(screen.getByText('Electricity Rate (p/kWh)')).toBeDefined()
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

  it('persists discovered export_tariff as octopus_export_tariff_code (INSTRUCTION-410)', async () => {
    mockFetch({
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE',
      export_tariff: 'E-1R-OUTGOING-VAR-24-10-26-B',
      gas_tariff_code: null,
      additional_import_tariffs: [],
    })
    const onUpdate = vi.fn()
    render(<StepTariff config={LEGACY_OCTOPUS_CONFIG} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/Test Connection/i))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled()
      const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]
      const data = lastCall[1] as {
        electricity?: { octopus_tariff_code?: string; octopus_export_tariff_code?: string }
      }
      expect(data.electricity?.octopus_tariff_code).toBe('E-1R-AGILE')
      expect(data.electricity?.octopus_export_tariff_code).toBe('E-1R-OUTGOING-VAR-24-10-26-B')
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

// ── INSTRUCTION-303: fixed_rate seeded into committed state ────────────

describe('StepTariff — fixed_rate seeding (303)', () => {
  function lastEnergy(onUpdate: ReturnType<typeof vi.fn>) {
    const energyCalls = onUpdate.mock.calls.filter((c) => c[0] === 'energy')
    return energyCalls[energyCalls.length - 1]?.[1] as
      | { electricity?: { fixed_rate?: number }; gas?: { fixed_rate?: number } }
      | undefined
  }

  it('seeds default electricity fixed_rate on provider switch (no keystroke)', () => {
    const onUpdate = vi.fn()
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    expect(lastEnergy(onUpdate)?.electricity?.fixed_rate).toBe(0.245)
  })

  it('seeds default gas fixed_rate on provider switch (no keystroke)', () => {
    const onUpdate = vi.fn()
    // Gas starts on Octopus (no fixed_rate) so the switch genuinely seeds.
    const cfg = {
      energy: {
        gas: {
          provider: 'octopus' as const,
          octopus_api_key: 'sk_x',
          octopus_account_number: 'A-1',
        },
      },
      heat_source: { type: 'gas_boiler' as const },
    }
    render(<StepTariff config={cfg} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByTestId('provider-gas-provider-fixed'))
    expect(lastEnergy(onUpdate)?.gas?.fixed_rate).toBe(0.07)
  })

  it('seeds default electricity fixed_rate on mount for an edit-existing fixed config without a rate', () => {
    const onUpdate = vi.fn()
    const cfg = {
      energy: { electricity: { provider: 'fixed' as const } },
      heat_source: { type: 'heat_pump' as const },
    }
    render(<StepTariff config={cfg} onUpdate={onUpdate} />)
    const energyCalls = onUpdate.mock.calls.filter((c) => c[0] === 'energy')
    // Exactly one mount persist — the ref guard prevents re-seeding.
    expect(energyCalls).toHaveLength(1)
    const payload = energyCalls[0][1] as { electricity?: { fixed_rate?: number } }
    expect(payload.electricity?.fixed_rate).toBe(0.245)
  })

  it('does NOT seed on mount when the incoming fixed config already has a rate', () => {
    const onUpdate = vi.fn()
    const cfg = {
      energy: { electricity: { provider: 'fixed' as const, fixed_rate: 0.31 } },
      heat_source: { type: 'heat_pump' as const },
    }
    render(<StepTariff config={cfg} onUpdate={onUpdate} />)
    expect(onUpdate.mock.calls.filter((c) => c[0] === 'energy')).toHaveLength(0)
  })

  it('user-entered electricity rate wins over the seeded default', () => {
    const onUpdate = vi.fn()
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    const input = screen.getByLabelText(/Electricity Rate/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '30' } })
    expect(lastEnergy(onUpdate)?.electricity?.fixed_rate).toBe(0.30)
  })
})

describe('StepTariff — Fixed rate validation', () => {
  it('Fixed rate input has min/max/step constraints', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    const input = screen.getByLabelText(/Electricity Rate/i) as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.min).toBe('1')
    expect(input.max).toBe('200')
    expect(input.step).toBe('0.01')
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

// ── INSTRUCTION-577D: the Time of Use provider and its band editor ──────

describe('StepTariff — time of use (577D)', () => {
  function lastElectricity(onUpdate: ReturnType<typeof vi.fn>) {
    const energyCalls = onUpdate.mock.calls.filter((c) => c[0] === 'energy')
    return (energyCalls[energyCalls.length - 1]?.[1] as {
      electricity?: { provider?: string; bands?: { start: string; rate: number }[] }
    } | undefined)?.electricity
  }

  it('seeds one band on the switch and persists each edit', () => {
    const onUpdate = vi.fn()
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-time_of_use'))
    expect(lastElectricity(onUpdate)).toMatchObject({
      provider: 'time_of_use',
      bands: [{ start: '00:00', rate: 0.245 }],
    })
    fireEvent.click(screen.getByLabelText('Split band 1'))
    expect(lastElectricity(onUpdate)?.bands).toEqual([
      { start: '00:00', rate: 0.245 },
      { start: '12:00', rate: 0.245 },
    ])
  })

  it('seeds one band on mount for a time_of_use config with no bands', () => {
    const onUpdate = vi.fn()
    render(
      <StepTariff
        config={{ energy: { electricity: { provider: 'time_of_use' } }, heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    expect(lastElectricity(onUpdate)?.bands).toEqual([{ start: '00:00', rate: 0.245 }])
  })

  it('seeds one band at the default on mount for a refused band list and a fixed rate of 0', () => {
    const onUpdate = vi.fn()
    // YAML reads an unquoted 23:00 as the number 1380, which the backend refuses.
    const refused = [{ start: 1380, rate: 0.08 }] as unknown as { start: string; rate: number }[]
    render(
      <StepTariff
        config={{
          energy: { electricity: { provider: 'time_of_use', fixed_rate: 0, bands: refused } },
          heat_source: { type: 'heat_pump' },
        }}
        onUpdate={onUpdate}
      />,
    )
    expect(lastElectricity(onUpdate)?.bands).toEqual([{ start: '00:00', rate: 0.245 }])
    expect((screen.getByLabelText('Band 1 rate') as HTMLInputElement).value).toBe('24.5')
  })

  it('seeds one band at the fixed rate on the switch from Fixed', () => {
    const onUpdate = vi.fn()
    render(
      <StepTariff
        config={{ energy: { electricity: { provider: 'fixed', fixed_rate: 0.27 } }, heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByTestId('provider-electricity-provider-time_of_use'))
    expect(lastElectricity(onUpdate)?.bands).toEqual([{ start: '00:00', rate: 0.27 }])
  })

  it('seeds one band at the default rate on the switch when the fixed rate is 0', () => {
    const onUpdate = vi.fn()
    render(
      <StepTariff
        config={{ energy: { electricity: { provider: 'fixed', fixed_rate: 0 } }, heat_source: { type: 'heat_pump' } }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByTestId('provider-electricity-provider-time_of_use'))
    expect(lastElectricity(onUpdate)?.bands).toEqual([{ start: '00:00', rate: 0.245 }])
  })

  it('sorts a band list kept from an earlier choice on the switch', () => {
    const onUpdate = vi.fn()
    render(
      <StepTariff
        config={{
          energy: {
            electricity: {
              provider: 'fixed',
              fixed_rate: 0.27,
              bands: [
                { start: '23:00', rate: 0.08 },
                { start: '06:00', rate: 0.3 },
              ],
            },
          },
          heat_source: { type: 'heat_pump' },
        }}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByTestId('provider-electricity-provider-time_of_use'))
    expect(lastElectricity(onUpdate)?.bands).toEqual([
      { start: '06:00', rate: 0.3 },
      { start: '23:00', rate: 0.08 },
    ])
  })

  it('hydrates a saved band list sorted by start', () => {
    render(
      <StepTariff
        config={{
          energy: {
            electricity: {
              provider: 'time_of_use',
              bands: [
                { start: '23:00', rate: 0.08 },
                { start: '06:00', rate: 0.3 },
              ],
            },
          },
          heat_source: { type: 'heat_pump' },
        }}
        onUpdate={vi.fn()}
      />,
    )
    expect((screen.getByLabelText('Band 1 start') as HTMLSelectElement).value).toBe('06:00')
    expect(screen.getByTestId('tou-total').textContent).toBe('Total 24 h in 2 bands')
  })
})

// ── INSTRUCTION-577F: the Fixed rate inputs take pence ──────────────────

describe('StepTariff — the Fixed rate in pence (577F)', () => {
  function lastEnergy(onUpdate: ReturnType<typeof vi.fn>) {
    const energyCalls = onUpdate.mock.calls.filter((c) => c[0] === 'energy')
    return energyCalls[energyCalls.length - 1]?.[1] as
      | Record<string, { fixed_rate?: number } | undefined>
      | undefined
  }

  it('shows each Fixed rate in p/kWh and persists it in £/kWh', () => {
    const onUpdate = vi.fn()
    render(
      <StepTariff
        config={{
          energy: {
            electricity: { provider: 'fixed', fixed_rate: 0.245 },
            gas: { provider: 'fixed', fixed_rate: 0.07 },
            lpg: { provider: 'fixed', fixed_rate: 0.1 },
            oil: { provider: 'fixed', fixed_rate: 0.08 },
          },
          heat_sources: [
            { type: 'heat_pump' },
            { type: 'gas_boiler' },
            { type: 'lpg_boiler' },
            { type: 'oil_boiler' },
          ],
        }}
        onUpdate={onUpdate}
      />,
    )
    const cases = [
      { fuel: 'Electricity', key: 'electricity', shown: '24.5', typed: '27.5', saved: 0.275 },
      { fuel: 'Gas', key: 'gas', shown: '7', typed: '6.24', saved: 0.0624 },
      { fuel: 'LPG', key: 'lpg', shown: '10', typed: '9.9', saved: 0.099 },
      { fuel: 'Oil', key: 'oil', shown: '8', typed: '7.1', saved: 0.071 },
    ]
    for (const c of cases) {
      const input = screen.getByLabelText(`${c.fuel} Rate (p/kWh)`) as HTMLInputElement
      expect(input.tagName).toBe('INPUT')
      expect(input.value).toBe(c.shown)
      fireEvent.change(input, { target: { value: c.typed } })
      expect(lastEnergy(onUpdate)?.[c.key]?.fixed_rate).toBe(c.saved)
    }
  })

  it('shows a hint under each Fixed rate below 1p/kWh, and states £/kWh on the Fallback Rates', () => {
    const onUpdate = vi.fn()
    const sources = [
      { type: 'heat_pump' as const },
      { type: 'gas_boiler' as const },
      { type: 'lpg_boiler' as const },
      { type: 'oil_boiler' as const },
    ]
    const { rerender } = render(
      <StepTariff
        config={{
          energy: {
            electricity: { provider: 'fixed', fixed_rate: 0.00245 },
            gas: { provider: 'fixed', fixed_rate: 0.0099 },
            lpg: { provider: 'fixed', fixed_rate: 0.01 },
            oil: { provider: 'fixed', fixed_rate: 0 },
          },
          heat_sources: sources,
        }}
        onUpdate={onUpdate}
      />,
    )
    const hint = (fuel: string) => {
      const id = screen.getByLabelText(`${fuel} Rate (p/kWh)`).getAttribute('aria-describedby')
      return id === null ? null : (document.getElementById(id)?.textContent ?? '')
    }
    expect(hint('Electricity')).toContain('Below 1p/kWh')
    expect(hint('Gas')).toContain('Below 1p/kWh')
    expect(hint('LPG')).toBeNull()
    expect(hint('Oil')).toBeNull()
    expect(screen.getAllByText(/Below 1p\/kWh/)).toHaveLength(2)
    expect(screen.getAllByText('(£/kWh)', { exact: false })).toHaveLength(4)
    // The hint changes no rate: nothing is persisted on render.
    expect(lastEnergy(onUpdate)).toBeUndefined()
    rerender(
      <StepTariff
        config={{
          energy: {
            electricity: { provider: 'fixed', fixed_rate: 0.00245 },
            gas: { provider: 'fixed', fixed_rate: 0.0099 },
            lpg: { provider: 'fixed', fixed_rate: 0.245 },
            oil: { provider: 'fixed', fixed_rate: -0.05 },
          },
          heat_sources: sources,
        }}
        onUpdate={onUpdate}
      />,
    )
    expect(hint('LPG')).toBeNull()
    expect(hint('Oil')).toBeNull()
    fireEvent.change(screen.getByLabelText('Electricity Rate (p/kWh)'), { target: { value: '24.5' } })
    expect(hint('Electricity')).toBeNull()
    expect(screen.getAllByText(/Below 1p\/kWh/)).toHaveLength(1)
  })

  it('persists a Fixed rate and a band rate below 1p/kWh: the hint blocks nothing', () => {
    const onFixed = vi.fn()
    const first = render(
      <StepTariff
        config={{ energy: { electricity: { provider: 'fixed', fixed_rate: 0.245 } }, heat_source: { type: 'heat_pump' } }}
        onUpdate={onFixed}
      />,
    )
    fireEvent.change(screen.getByLabelText('Electricity Rate (p/kWh)'), { target: { value: '0.08' } })
    expect(lastEnergy(onFixed)?.electricity?.fixed_rate).toBe(0.0008)
    first.unmount()
    const onBand = vi.fn()
    render(
      <StepTariff
        config={{
          energy: {
            electricity: {
              provider: 'time_of_use',
              bands: [
                { start: '06:00', rate: 0.3 },
                { start: '23:00', rate: 0.08 },
              ],
            },
          },
          heat_source: { type: 'heat_pump' },
        }}
        onUpdate={onBand}
      />,
    )
    fireEvent.change(screen.getByLabelText('Band 2 rate'), { target: { value: '0.08' } })
    const bands = (lastEnergy(onBand)?.electricity as { bands?: { rate: number }[] } | undefined)?.bands
    expect(bands?.[1].rate).toBe(0.0008)
  })

  it('says in the tooltip of the Fixed rate that the value is in pence', () => {
    render(<StepTariff config={HP_ONLY_CONFIG} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-fixed'))
    const label = screen.getByText('Electricity Rate (p/kWh)')
    fireEvent.click(within(label.parentElement as HTMLElement).getByLabelText('Help'))
    expect(screen.getByRole('tooltip').textContent).toContain('must be in pence per kWh')
  })
})
