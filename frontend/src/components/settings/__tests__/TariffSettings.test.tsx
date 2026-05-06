/**
 * INSTRUCTION-150E Task 7c — TariffSettings (settings page mirror of the
 * wizard step) tests.
 *
 * Covers:
 *   - Provider radios per fuel
 *   - EDF gating on backend capability flag (V5 E-M1)
 *   - Provider Status panel rendering tariff_label directly (V5 C-2)
 *   - Stale + last_error indicators
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CycleMessage, ProviderStatus } from '../../../types/api'

const liveMock = vi.hoisted(() => ({ data: null as CycleMessage | null }))
const patchMock = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))

vi.mock('../../../hooks/useLive', () => ({
  useLive: () => ({ data: liveMock.data, isConnected: true, lastUpdate: 0 }),
}))

import { TariffSettings } from '../TariffSettings'

const noop = () => {}

const ELECTRICITY_OK: ProviderStatus = {
  fuel: 'electricity',
  provider_kind: 'octopus_electricity',
  last_refresh_at: 1745236800,
  stale: false,
  last_price: 0.245,
  source_url: null,
  last_error: null,
  tariff_label: 'Octopus Agile',
}

const GAS_OK: ProviderStatus = {
  fuel: 'gas',
  provider_kind: 'octopus_gas',
  last_refresh_at: 1745236800,
  stale: false,
  last_price: 0.071,
  source_url: null,
  last_error: null,
  tariff_label: 'Octopus Tracker (Gas)',
}

beforeEach(() => {
  liveMock.data = null
  patchMock.mockReset()
  patchMock.mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TariffSettings — provider radios', () => {
  it('renders electricity Octopus + Fixed by default', () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByTestId('provider-electricity-provider-octopus')).toBeDefined()
    expect(screen.getByTestId('provider-electricity-provider-fixed')).toBeDefined()
    expect(screen.queryByTestId('provider-electricity-provider-edf_freephase')).toBeNull()
  })

  it('EDF radio appears when backend capability flag includes edf_freephase (V5 E-M1)', () => {
    liveMock.data = {
      type: 'cycle',
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByTestId('provider-electricity-provider-edf_freephase')).toBeDefined()
  })

  it('renders gas section for boiler installs', () => {
    render(
      <TariffSettings
        energy={{}}
        heatSource={{ type: 'gas_boiler' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getByTestId('settings-gas')).toBeDefined()
  })

  it('hides gas section for HP-only installs', () => {
    render(
      <TariffSettings
        energy={{}}
        heatSource={{ type: 'heat_pump' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.queryByTestId('settings-gas')).toBeNull()
  })
})

describe('TariffSettings — Provider Status panel', () => {
  it('renders panel with tariff_label for each fuel (V5 C-2 pass-through)', () => {
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: ELECTRICITY_OK, gas: GAS_OK },
    }
    render(
      <TariffSettings
        energy={{}}
        heatSource={{ type: 'gas_boiler' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getByText('Octopus Agile')).toBeDefined()
    expect(screen.getByText('Octopus Tracker (Gas)')).toBeDefined()
  })

  it('falls back to PROVIDER_KIND_DISPLAY when tariff_label is null', () => {
    const fallbackElec: ProviderStatus = {
      ...ELECTRICITY_OK,
      provider_kind: 'fallback',
      tariff_label: null,
    }
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: fallbackElec },
    }
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByText('Not configured')).toBeDefined()
  })

  it('shows stale indicator for stale provider', () => {
    const stale: ProviderStatus = { ...ELECTRICITY_OK, stale: true }
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: stale },
    }
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByTestId('stale-electricity')).toBeDefined()
  })

  it('shows last_error message when present', () => {
    const errored: ProviderStatus = {
      ...ELECTRICITY_OK,
      last_error: 'Octopus API returned 500',
    }
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: errored },
    }
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByText('Octopus API returned 500')).toBeDefined()
  })

  it('renders empty-state notice when byFuel is empty', () => {
    liveMock.data = null
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByText(/No live tariff data yet/i)).toBeDefined()
  })
})

// ── INSTRUCTION-158C: ha_entity option + sentinel handling ─────────────

describe('TariffSettings — ha_entity radio (158C)', () => {
  it('renders ha_entity option in electricity radio', () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByTestId('provider-electricity-provider-ha_entity')).toBeDefined()
  })

  it('selecting ha_entity shows the rates entity input', () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    const radio = screen.getByTestId('provider-electricity-provider-ha_entity')
    fireEvent.click(radio)
    const input = screen.getByPlaceholderText(/current_day_rates/) as HTMLInputElement
    expect(input).toBeDefined()
    expect(input.value).toBe('')
  })

  it('hydrates legacy energy.octopus.rates.current_day as ha_entity', () => {
    render(
      <TariffSettings
        energy={{ octopus: { rates: { current_day: 'event.X' } } }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const radio = screen.getByTestId('provider-electricity-provider-ha_entity')
    expect(radio.getAttribute('aria-checked')).toBe('true')
    const input = screen.getByPlaceholderText(/current_day_rates/) as HTMLInputElement
    expect(input.value).toBe('event.X')
  })

  it('full octopus credentials win over legacy rates entity in hydrate', () => {
    render(
      <TariffSettings
        energy={{
          octopus: {
            api_key: 'sk',
            account_number: 'A-1',
            rates: { current_day: 'event.X' },
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const haRadio = screen.getByTestId('provider-electricity-provider-ha_entity')
    const octRadio = screen.getByTestId('provider-electricity-provider-octopus')
    expect(octRadio.getAttribute('aria-checked')).toBe('true')
    expect(haRadio.getAttribute('aria-checked')).toBe('false')
  })
})

describe('TariffSettings — sentinel handling on save (158C)', () => {
  it('save omits octopus_api_key when value equals sentinel', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: '***REDACTED***',
            octopus_account_number: 'A-1234',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    expect(patchMock).toHaveBeenCalledWith('energy', expect.anything())
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.octopus_api_key).toBeUndefined()
    expect(payload.electricity.octopus_account_number).toBe('A-1234')
  })

  it('save includes octopus_api_key when user typed a real value', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: '***REDACTED***',
            octopus_account_number: 'A-1234',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const apiKeyInput = screen.getByPlaceholderText('sk_live_...') as HTMLInputElement
    fireEvent.change(apiKeyInput, { target: { value: 'sk_live_new' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.octopus_api_key).toBe('sk_live_new')
  })

  it('save omits octopus_account_number when value equals sentinel (V2 Finding 9)', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_real',
            octopus_account_number: '***REDACTED***',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.octopus_api_key).toBe('sk_real')
    expect(payload.electricity.octopus_account_number).toBeUndefined()
  })

  it('save includes octopus_account_number when user typed a real value (V2 Finding 9)', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_real',
            octopus_account_number: '***REDACTED***',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const acctInput = screen.getByPlaceholderText('A-1234ABCD') as HTMLInputElement
    fireEvent.change(acctInput, { target: { value: 'A-NEW1234' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.octopus_account_number).toBe('A-NEW1234')
  })

  it('save omits both sentinels when both fields are unchanged (V2 Finding 9)', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: '***REDACTED***',
            octopus_account_number: '***REDACTED***',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.octopus_api_key).toBeUndefined()
    expect(payload.electricity.octopus_account_number).toBeUndefined()
    expect(payload.electricity.provider).toBe('octopus')
  })

  it('save with ha_entity provider sends rates_entity', async () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    fireEvent.click(screen.getByTestId('provider-electricity-provider-ha_entity'))
    const input = screen.getByPlaceholderText(/current_day_rates/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'event.Y' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.provider).toBe('ha_entity')
    expect(payload.electricity.rates_entity).toBe('event.Y')
  })
})

// ── INSTRUCTION-159C: dual-source rates_entity_next UX ─────────────────

describe('TariffSettings — ha_entity dual-source inputs (159C)', () => {
  it('renders both HA entity inputs and persists next-day on Save', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'ha_entity',
            rates_entity: 'event.current',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Both inputs are present once provider=ha_entity.
    const current = screen.getByPlaceholderText(/current_day_rates/i) as HTMLInputElement
    const next = screen.getByPlaceholderText(/next_day_rates/i) as HTMLInputElement
    expect(current).toBeDefined()
    expect(next).toBeDefined()
    expect(next.value).toBe('')

    fireEvent.change(next, { target: { value: 'event.next_day' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.provider).toBe('ha_entity')
    expect(payload.electricity.rates_entity).toBe('event.current')
    expect(payload.electricity.rates_entity_next).toBe('event.next_day')
  })

  it('clearing next-day field drops the YAML key (V2 normalisation)', async () => {
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'ha_entity',
            rates_entity: 'event.current',
            rates_entity_next: 'event.preexisting',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const next = screen.getByPlaceholderText(/next_day_rates/i) as HTMLInputElement
    expect(next.value).toBe('event.preexisting')

    // Clearing the field via empty-string change must normalise to undefined
    // so the YAML key is dropped rather than persisted as "".
    fireEvent.change(next, { target: { value: '' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await Promise.resolve()
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.rates_entity_next).toBeUndefined()
    expect(payload.electricity.rates_entity).toBe('event.current')
  })
})

// ── INSTRUCTION-164: per-fuel tariff Test Connection / persistence ─────

describe('TariffSettings — dual-source per-fuel Test Connection (164)', () => {
  function mockFetch(json: unknown, ok = true, status = 200) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok,
      status,
      text: async () => JSON.stringify(json),
      json: async () => json,
    } as Response)
  }

  const DUAL_SOURCE_HEAT = [
    { type: 'heat_pump' as const },
    { type: 'gas_boiler' as const },
  ]

  it('dual_source_both_octopus_persists_both_tariff_codes', async () => {
    mockFetch({
      success: true,
      message: 'Connected. Import tariff: E-1R-AGILE-24-10-01-H',
      tariff_code: 'E-1R-AGILE-24-10-01-H',
      gas_tariff_code: 'G-1R-SILVER-25-04-15-H',
      additional_import_tariffs: [],
      export_tariff: null,
    })
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Click Test Connection in the electricity card.
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(within(elecSection).getByText(/E-1R-AGILE-24-10-01-H/)).toBeDefined(),
    )
    // Save and inspect the PATCH payload — both per-fuel tariff codes
    // must be present, proving persistence is independent of the visible
    // banner card.
    await user.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const payload = patchMock.mock.calls[0][1]
    expect(payload.electricity.octopus_tariff_code).toBe('E-1R-AGILE-24-10-01-H')
    expect(payload.gas.octopus_tariff_code).toBe('G-1R-SILVER-25-04-15-H')
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
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: { provider: 'fixed', fixed_rate: 0.27 },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_gas_only',
            octopus_account_number: 'A-GAS',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const gasSection = screen.getByTestId('settings-gas')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/Connected\. Gas tariff: G-1R-SILVER-25-04-15-H/),
      ).toBeDefined(),
    )
    // Save and inspect the PATCH payload. gas tariff persisted despite
    // data.success === false; electricity tariff NOT written because
    // data.tariff_code is null (V2 M2 negative cross-fuel pin).
    await user.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const payload = patchMock.mock.calls[0][1]
    expect(payload.gas.octopus_tariff_code).toBe('G-1R-SILVER-25-04-15-H')
    expect(payload.electricity.octopus_tariff_code).toBeUndefined()
    expect(payload.electricity.provider).toBe('fixed')
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
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_elec',
            octopus_account_number: 'A-ELEC',
          },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_gas',
            octopus_account_number: 'A-GAS',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const gasSection = screen.getByTestId('settings-gas')
    const elecSection = screen.getByTestId('settings-electricity')

    // INSTRUCTION-174: each Test Connection now also fires a follow-up
    // POST to /api/wizard/persist-octopus-tariff-codes. Filter calls by URL
    // so this test stays focused on the credential-isolation contract.
    const testOctopusCalls = () =>
      fetchSpy.mock.calls.filter((c) => String(c[0]).includes('test-octopus'))

    // Click gas first — must use gas's own credential pair.
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() => expect(testOctopusCalls().length).toBe(1))
    const gasBody = JSON.parse((testOctopusCalls()[0][1] as RequestInit).body as string)
    expect(gasBody.api_key).toBe('sk_gas')
    expect(gasBody.account_number).toBe('A-GAS')

    // Click electricity — must use electricity's own credential pair.
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => expect(testOctopusCalls().length).toBe(2))
    const elecBody = JSON.parse((testOctopusCalls()[1][1] as RequestInit).body as string)
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
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    const gasSection = screen.getByTestId('settings-gas')

    // Click electricity Test — only electricity card's banner appears.
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(elecSection).getByText(/Found electricity tariff E-1R-AGILE-24-10-01-H/),
      ).toBeDefined(),
    )
    // Gas card has no banner yet.
    expect(
      within(gasSection).queryByText(/Found electricity tariff/),
    ).toBeNull()
    expect(
      within(gasSection).queryByText(/Connected\. Gas tariff/),
    ).toBeNull()

    // Click gas Test — gas card now has its own banner.
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/Connected\. Gas tariff: G-1R-SILVER-25-04-15-H/),
      ).toBeDefined(),
    )
    // Electricity card's banner unchanged — still the original message.
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
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const gasSection = screen.getByTestId('settings-gas')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/G-1R-SILVER-25-04-15-H/),
      ).toBeDefined(),
    )
    // Defect 1 regression pin: gas card banner does NOT contain the
    // electricity tariff code.
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
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const gasSection = screen.getByTestId('settings-gas')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    // V2 H1: gas card shows the local "no gas tariff" message — never the
    // electricity success wording.
    await waitFor(() =>
      expect(
        within(gasSection).getByText(/No gas tariff discovered on this account/),
      ).toBeDefined(),
    )
    expect(within(gasSection).queryByText(/E-1R/)).toBeNull()

    // Save: gas tariff NOT written; electricity tariff WAS written from
    // data.tariff_code as the intentional cross-fuel side effect.
    await user.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(patchMock).toHaveBeenCalled())
    const payload = patchMock.mock.calls[0][1]
    expect(payload.gas.octopus_tariff_code).toBeUndefined()
    expect(payload.electricity.octopus_tariff_code).toBe('E-1R-AGILE-24-10-01-H')
  })
})

// ── INSTRUCTION-174: testOctopus auto-persist ─────────────────────────

describe('TariffSettings — testOctopus auto-persist (INSTRUCTION-174)', () => {
  const DUAL_SOURCE_HEAT = [
    { type: 'heat_pump' as const },
    { type: 'gas_boiler' as const },
  ]

  type FetchResponseSpec = {
    ok?: boolean
    status?: number
    body?: unknown
    /** Raw non-JSON body. `json()` will throw — matches what `fetch` does
     *  when a server returns a stack-trace or other plain-text error. */
    rawText?: string
  }

  function makeResponse(spec: FetchResponseSpec): Response {
    const ok = spec.ok ?? true
    const status = spec.status ?? 200
    if (spec.rawText !== undefined) {
      const raw = spec.rawText
      return {
        ok,
        status,
        text: async () => raw,
        json: async () => {
          throw new Error('Unexpected token in JSON')
        },
      } as unknown as Response
    }
    const body = spec.body
    return {
      ok,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response
  }

  function mockFetchSequence(specs: FetchResponseSpec[]) {
    const spy = vi.spyOn(globalThis, 'fetch')
    for (const spec of specs) {
      spy.mockResolvedValueOnce(makeResponse(spec))
    }
    return spy
  }

  // Case 1
  it('auto-persist fires when electricity code is discovered', async () => {
    const spy = mockFetchSequence([
      {
        body: {
          success: true,
          message: 'ok',
          tariff_code: 'E-1R-X-X',
          gas_tariff_code: null,
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: true, gas: false },
          restart_required: true,
          message: 'Persisted tariff code(s) for electricity — pipeline restarting',
        },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))

    // First call: test-octopus
    expect(spy.mock.calls[0][0]).toContain('api/wizard/test-octopus')
    // Second call: persist endpoint with the discovered electricity code only.
    expect(spy.mock.calls[1][0]).toContain('api/wizard/persist-octopus-tariff-codes')
    const persistInit = spy.mock.calls[1][1] as RequestInit
    expect(persistInit.method).toBe('POST')
    const body = JSON.parse(persistInit.body as string)
    expect(body).toEqual({
      electricity_tariff_code: 'E-1R-X-X',
      gas_tariff_code: null,
    })
  })

  // Case 2
  it('auto-persist fires when gas code is discovered (gas-installed, gas.provider=octopus)', async () => {
    const spy = mockFetchSequence([
      {
        body: {
          success: true,
          message: 'ok',
          tariff_code: null,
          gas_tariff_code: 'G-1R-Y-Y',
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: false, gas: true },
          restart_required: true,
          message: 'ok',
        },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: { provider: 'fixed', fixed_rate: 0.27 },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_g',
            octopus_account_number: 'A-G',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const gasSection = screen.getByTestId('settings-gas')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    const persistInit = spy.mock.calls[1][1] as RequestInit
    const body = JSON.parse(persistInit.body as string)
    expect(body).toEqual({
      electricity_tariff_code: null,
      gas_tariff_code: 'G-1R-Y-Y',
    })
  })

  // Case 3
  it('auto-persist does NOT fire when neither code is returned', async () => {
    const spy = mockFetchSequence([
      {
        body: {
          success: false,
          message: '401 Unauthorised',
          tariff_code: null,
          gas_tariff_code: null,
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    // Idle — no second call.
    expect(spy.mock.calls[0][0]).toContain('api/wizard/test-octopus')
    expect(spy.mock.calls.find((c) => String(c[0]).includes('persist-octopus'))).toBeUndefined()
  })

  // Case 4
  it('auto-persist failure surfaces in test result message but preserves success flag', async () => {
    mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-1R-X-X',
          gas_tariff_code: null,
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        ok: false,
        status: 500,
        body: { detail: 'db unavailable' },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(within(elecSection).getByText(/auto-persist failed: db unavailable/)).toBeDefined(),
    )
    // Success tick still shown — credential test itself succeeded.
    // (The OctopusFields banner uses success colour when tariff_code truthy.)
    expect(within(elecSection).queryByText(/E-1R-X-X|Connected/)).toBeDefined()
  })

  // Case 5
  it('restart-required appended to message', async () => {
    mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-1R-X-X',
          gas_tariff_code: null,
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: true, gas: false },
          restart_required: true,
          message: 'Persisted tariff code(s) for electricity — pipeline restarting',
        },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(within(elecSection).getByText(/pipeline restarting/)).toBeDefined(),
    )
  })

  // Case 6
  it('both codes in a single Test Connection result in a single persist call with both fields', async () => {
    const spy = mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-1R-X-X',
          gas_tariff_code: 'G-1R-Y-Y',
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: true, gas: true },
          restart_required: true,
          message: 'ok',
        },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-DUAL',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    // Exactly one persist call with both codes in the body.
    const persistCalls = spy.mock.calls.filter((c) =>
      String(c[0]).includes('persist-octopus-tariff-codes'),
    )
    expect(persistCalls.length).toBe(1)
    const body = JSON.parse((persistCalls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      electricity_tariff_code: 'E-1R-X-X',
      gas_tariff_code: 'G-1R-Y-Y',
    })
  })

  // Case 7 (V2 DESIGN)
  it('mixed provider — gas code is NOT forwarded when gas.provider !== "octopus"', async () => {
    // Sub-case A: electricity=octopus, gas=fixed — click electricity Test.
    // (GasProviderKind only allows 'octopus' or 'fixed' — 'fixed' stands in
    //  for any non-Octopus gas provider for the gate logic.)
    const spy = mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-X',
          gas_tariff_code: 'G-Y',
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: true, gas: false },
          restart_required: true,
          message: 'ok',
        },
      },
    ])
    const user = userEvent.setup()
    const { unmount } = render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
          gas: {
            provider: 'fixed',
            fixed_rate: 0.07,
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    const bodyA = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string)
    expect(bodyA).toEqual({
      electricity_tariff_code: 'E-X',
      gas_tariff_code: null,
    })
    unmount()
    spy.mockRestore()

    // Sub-case B: electricity=fixed, gas=octopus — click gas Test.
    const spy2 = mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-X',
          gas_tariff_code: 'G-Y',
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: false, gas: true },
          restart_required: true,
          message: 'ok',
        },
      },
    ])
    render(
      <TariffSettings
        energy={{
          electricity: { provider: 'fixed', fixed_rate: 0.27 },
          gas: {
            provider: 'octopus',
            octopus_api_key: 'sk_g',
            octopus_account_number: 'A-G',
          },
        }}
        heatSources={DUAL_SOURCE_HEAT}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const gasSection = screen.getByTestId('settings-gas')
    await user.click(within(gasSection).getByText(/Test Connection/i))
    await waitFor(() => expect(spy2).toHaveBeenCalledTimes(2))
    const bodyB = JSON.parse((spy2.mock.calls[1][1] as RequestInit).body as string)
    expect(bodyB).toEqual({
      electricity_tariff_code: null,
      gas_tariff_code: 'G-Y',
    })
  })

  // Case 8 (V2 MEDIUM)
  it('restart-flag-failure shape surfaces manual-restart hint', async () => {
    mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-X',
          gas_tariff_code: null,
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        body: {
          persisted: { electricity: true, gas: false },
          restart_required: false,
          message:
            'Persisted tariff code(s) for electricity but restart flag could not be written — restart manually for changes to take effect',
        },
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(within(elecSection).getByText(/restart manually/)).toBeDefined(),
    )
    expect(within(elecSection).queryByText(/pipeline restarting/)).toBeNull()
  })

  // Case 9 (V2 LOW)
  it('error body redaction — server-internals not leaked to UI', async () => {
    const trace =
      'Traceback (most recent call last):\n  File "/srv/qsh/api/routes/wizard.py", line 1080, in persist...'
    mockFetchSequence([
      {
        body: {
          success: true,
          message: 'Connected',
          tariff_code: 'E-X',
          gas_tariff_code: null,
          additional_import_tariffs: [],
          export_tariff: null,
        },
      },
      {
        ok: false,
        status: 500,
        rawText: trace,
      },
    ])
    const user = userEvent.setup()
    render(
      <TariffSettings
        energy={{
          electricity: {
            provider: 'octopus',
            octopus_api_key: 'sk_x',
            octopus_account_number: 'A-1',
          },
        }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const elecSection = screen.getByTestId('settings-electricity')
    await user.click(within(elecSection).getByText(/Test Connection/i))
    await waitFor(() =>
      expect(
        within(elecSection).getByText(/auto-persist failed — see server log/),
      ).toBeDefined(),
    )
    // Stack-trace fragments must not appear anywhere in the rendered output.
    expect(within(elecSection).queryByText(/Traceback/)).toBeNull()
    expect(within(elecSection).queryByText(/\/srv\//)).toBeNull()
  })
})
