/**
 * 88A — Prop-sync tests: verify that each settings component re-syncs local
 * state when its prop changes (via rerender), proving the useEffect sync works.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/* ── shared mocks ──────────────────────────────────────────────────── */

const mockPatch = vi.fn().mockResolvedValue({ updated: 'ok', restart_required: false, message: '' })
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: mockPatch, saving: false, error: null }),
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

/* ── component imports (after mocks) ──────────────────────────────── */

import { HeatSourceSettings } from '../HeatSourceSettings'
import { TariffSettings } from '../TariffSettings'
import { ControlSettings } from '../ControlSettings'
import { SolarBatterySettings } from '../SolarBatterySettings'
import { HotWaterSettings } from '../HotWaterSettings'
import { ThermalSettings } from '../ThermalSettings'
import { HistorianSettings } from '../HistorianSettings'
import { SourceSelectionSettings } from '../SourceSelectionSettings'
import { DataSharingSettings } from '../DataSharingSettings'
import { OutdoorWeatherSettings } from '../OutdoorWeatherSettings'

const noop = () => {}

describe('Prop-sync: components re-sync local state when props change', () => {
  it('HeatSourceSettings — efficiency updates on rerender', () => {
    const hsA = { type: 'heat_pump' as const, efficiency: 0.85 }
    const hsB = { type: 'heat_pump' as const, efficiency: 0.92 }

    const { rerender } = render(
      <HeatSourceSettings heatSource={hsA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('0.85')).toBeInTheDocument()

    rerender(<HeatSourceSettings heatSource={hsB} driver="ha" onRefetch={noop} />)
    expect(screen.getByDisplayValue('0.92')).toBeInTheDocument()
  })

  it('TariffSettings — fallback cheap rate updates on rerender', () => {
    const eA = { fallback_rates: { cheap: 0.05, standard: 0.15, peak: 0.30, export: 0.04 } }
    const eB = { fallback_rates: { cheap: 0.08, standard: 0.15, peak: 0.30, export: 0.04 } }

    const { rerender } = render(
      <TariffSettings energy={eA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('0.05')).toBeInTheDocument()

    rerender(<TariffSettings energy={eB} driver="ha" onRefetch={noop} />)
    expect(screen.getByDisplayValue('0.08')).toBeInTheDocument()
  })

  it('ControlSettings — nudge_budget updates on rerender', () => {
    const ctrlA = { nudge_budget: 2.5 }
    const ctrlB = { nudge_budget: 4.0 }

    const { rerender } = render(
      <ControlSettings control={ctrlA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('2.5')).toBeInTheDocument()

    rerender(<ControlSettings control={ctrlB} driver="ha" onRefetch={noop} />)
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
  })

  it('SolarBatterySettings — inverter efficiency updates on rerender', () => {
    const invA = { fallback_efficiency: 0.97 }
    const invB = { fallback_efficiency: 0.88 }
    const solarA = { production_entity: 'sensor.solar' }

    const { rerender } = render(
      <SolarBatterySettings solar={solarA} inverter={invA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('0.97')).toBeInTheDocument()

    rerender(
      <SolarBatterySettings solar={solarA} inverter={invB} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('0.88')).toBeInTheDocument()
  })

  it('HotWaterSettings — tank volume updates on rerender', () => {
    const tankA = { volume_litres: 200, target_temperature: 50 }
    const tankB = { volume_litres: 300, target_temperature: 55 }

    const { rerender } = render(
      <HotWaterSettings hwPlan="W" hwTank={tankA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('200')).toBeInTheDocument()

    rerender(
      <HotWaterSettings hwPlan="W" hwTank={tankB} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('300')).toBeInTheDocument()
  })

  it('ThermalSettings — peak_loss_kw updates on rerender', () => {
    const tA = { peak_loss_kw: 5.0 }
    const tB = { peak_loss_kw: 7.5 }

    const { rerender } = render(
      <ThermalSettings thermal={tA} rooms={[]} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()

    rerender(<ThermalSettings thermal={tB} rooms={[]} driver="ha" onRefetch={noop} />)
    expect(screen.getByDisplayValue('7.5')).toBeInTheDocument()
  })

  it('HistorianSettings — host updates on rerender', () => {
    const hA = { enabled: true, host: 'host-a', port: 8086, database: 'qsh', username: 'qsh' }
    const hB = { enabled: true, host: 'host-b', port: 8086, database: 'qsh', username: 'qsh' }

    const { rerender } = render(
      <HistorianSettings historian={hA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('host-a')).toBeInTheDocument()

    rerender(<HistorianSettings historian={hB} driver="ha" onRefetch={noop} />)
    expect(screen.getByDisplayValue('host-b')).toBeInTheDocument()
  })

  it('SourceSelectionSettings — min_dwell_minutes updates on rerender', () => {
    const ssA = { mode: 'auto' as const, preference: 0.5, min_dwell_minutes: 30, score_deadband_pct: 10, max_switches_per_day: 6 }
    const ssB = { mode: 'auto' as const, preference: 0.5, min_dwell_minutes: 60, score_deadband_pct: 10, max_switches_per_day: 6 }

    const { rerender } = render(
      <SourceSelectionSettings config={ssA} sourceNames={[]} onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()

    rerender(
      <SourceSelectionSettings config={ssB} sourceNames={[]} onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
  })

  it('DataSharingSettings — agreed toggle syncs on rerender', () => {
    const { rerender } = render(
      <DataSharingSettings telemetry={{ agreed: false }} driver="ha" onRefetch={noop} />
    )
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    rerender(
      <DataSharingSettings telemetry={{ agreed: true, region: 'London' }} driver="ha" onRefetch={noop} />
    )
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('OutdoorWeatherSettings — temperature entity updates on rerender', () => {
    const oA = { temperature: 'sensor.old_temp' }
    const oB = { temperature: 'sensor.new_temp' }

    const { rerender } = render(
      <OutdoorWeatherSettings outdoor={oA} driver="ha" onRefetch={noop} />
    )
    expect(screen.getByDisplayValue('sensor.old_temp')).toBeInTheDocument()

    rerender(<OutdoorWeatherSettings outdoor={oB} driver="ha" onRefetch={noop} />)
    expect(screen.getByDisplayValue('sensor.new_temp')).toBeInTheDocument()
  })
})
