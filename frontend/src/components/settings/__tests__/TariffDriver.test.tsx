import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: vi.fn().mockResolvedValue({}), saving: false }),
}))

import { TariffSettings } from '../TariffSettings'

const noop = () => {}

const octopusEnergy = {
  octopus: {
    api_key: 'sk_live_test',
    account_number: 'A-1234ABCD',
    zone_entity_id: 'climate.octopus_heat_pump_zone',
    rates: {
      current_day: 'event.current_day_rates',
      next_day: 'event.next_day_rates',
      current_day_export: 'event.export_current_day_rates',
      next_day_export: 'event.export_next_day_rates',
    },
  },
}

describe('TariffSettings driver branching', () => {
  it('HA driver: renders five EntityField in advanced section', () => {
    render(
      <TariffSettings energy={octopusEnergy} driver="ha" onRefetch={noop} />
    )
    // Expand advanced
    fireEvent.click(screen.getByText('Advanced Octopus Settings'))

    expect(screen.getByText('Zone Entity ID')).toBeInTheDocument()
    expect(screen.getByText('Current Day Rates')).toBeInTheDocument()
    expect(screen.getByText('Next Day Rates')).toBeInTheDocument()
    expect(screen.getByText('Current Day Export')).toBeInTheDocument()
    expect(screen.getByText('Next Day Export')).toBeInTheDocument()
  })

  it('HA driver: infers ha_integration mode when zone_entity_id is set', () => {
    render(
      <TariffSettings energy={octopusEnergy} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByText('HA Integration')).toBeInTheDocument()
  })

  it('HA driver: infers direct_api mode when no zone_entity_id', () => {
    render(
      <TariffSettings
        energy={{ octopus: { api_key: 'sk_live_test', account_number: 'A-1234' } }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Direct API')).toBeInTheDocument()
  })

  it('HA driver: Change mode button toggles mode selector', () => {
    render(
      <TariffSettings
        energy={{ octopus: { api_key: 'sk_live_test', account_number: 'A-1234' } }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Change mode')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Change mode'))
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Direct API')).toBeInTheDocument()
  })

  it('MQTT driver: renders no EntityField, shows notice', () => {
    render(
      <TariffSettings energy={octopusEnergy} driver="mqtt" onRefetch={noop} />
    )
    expect(screen.getByText(/HA Octopus Energy integration is unavailable on MQTT driver/)).toBeInTheDocument()
    // No Change mode button on MQTT
    expect(screen.queryByText('Change mode')).toBeNull()
    // Mode badge shows Direct API
    expect(screen.getByText('Direct API')).toBeInTheDocument()
  })

  it('MQTT driver: Direct API fields still render', () => {
    render(
      <TariffSettings energy={octopusEnergy} driver="mqtt" onRefetch={noop} />
    )
    expect(screen.getByPlaceholderText('sk_live_...')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('A-1234ABCD')).toBeInTheDocument()
  })

  it('MQTT driver: advanced section does not show entity fields', () => {
    render(
      <TariffSettings energy={octopusEnergy} driver="mqtt" onRefetch={noop} />
    )
    fireEvent.click(screen.getByText('Advanced Octopus Settings'))
    // EUID and weather comp should show, but not entity fields
    expect(screen.queryByText('Zone Entity ID')).toBeNull()
    expect(screen.queryByText('Rate Entities')).toBeNull()
  })
})
