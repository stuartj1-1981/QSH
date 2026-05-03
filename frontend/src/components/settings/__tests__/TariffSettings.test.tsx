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
import { render, screen, fireEvent } from '@testing-library/react'
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
