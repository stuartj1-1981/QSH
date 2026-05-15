import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

// INSTRUCTION-227C Task 6 — mock useSysid so the new observed-kWp row
// has predictable data. Set the return value per-test to exercise each
// of the four states from the 227B envelope contract.
const mockUseSysid = vi.fn((): { data: unknown; error: string | null } => ({
  data: null,
  error: null,
}))
vi.mock('../../../hooks/useSysid', () => ({
  useSysid: () => mockUseSysid(),
}))

import { SolarBatterySettings } from '../SolarBatterySettings'

const noop = () => {}

describe('SolarBatterySettings driver branching', () => {
  describe('Solar section', () => {
    it('HA driver: renders EntityField for solar production', () => {
      render(
        <SolarBatterySettings
          solar={{ production_entity: 'sensor.solar_power' }}
          driver="ha"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Solar Production Entity')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sensor.solar_power')).toBeInTheDocument()
      expect(screen.queryByText('Solar Production Topic')).toBeNull()
    })

    it('MQTT driver: renders TopicField for solar production', () => {
      render(
        <SolarBatterySettings
          solar={{ production_topic: 'solar/production_w' }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Solar Production Topic')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('solar/production_w')).toBeInTheDocument()
      expect(screen.queryByText('Solar Production Entity')).toBeNull()
    })
  })

  describe('Battery section', () => {
    it('HA driver: renders EntityField for battery SoC', () => {
      // soc_entity is set, so hasBattery starts true — content is already expanded
      render(
        <SolarBatterySettings
          battery={{ soc_entity: 'sensor.battery_soc' }}
          driver="ha"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Battery SoC Entity')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sensor.battery_soc')).toBeInTheDocument()
      expect(screen.queryByText('Battery SoC Topic')).toBeNull()
    })

    it('MQTT driver: renders TopicField for battery SoC', () => {
      render(
        <SolarBatterySettings
          battery={{ soc_topic: 'battery/soc_pct' }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Battery SoC Topic')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('battery/soc_pct')).toBeInTheDocument()
      expect(screen.queryByText('Battery SoC Entity')).toBeNull()
    })
  })

  describe('Grid section', () => {
    it('HA driver: renders EntityField for grid power', () => {
      // Battery must be expanded for grid to show — soc_entity triggers hasBattery=true
      render(
        <SolarBatterySettings
          battery={{ soc_entity: 'sensor.battery_soc' }}
          grid={{ power_entity: 'sensor.grid_power' }}
          driver="ha"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Grid Power Entity')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sensor.grid_power')).toBeInTheDocument()
      expect(screen.queryByText('Grid Power Topic')).toBeNull()
    })

    it('MQTT driver: renders TopicField for grid power', () => {
      render(
        <SolarBatterySettings
          battery={{ soc_topic: 'battery/soc_pct' }}
          grid={{ power_topic: 'grid/import_w' }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Grid Power Topic')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('grid/import_w')).toBeInTheDocument()
      expect(screen.queryByText('Grid Power Entity')).toBeNull()
    })
  })
})


// ── INSTRUCTION-227C Task 6 — observed solar capacity row ────────────


describe('SolarBatterySettings observed solar capacity (INSTRUCTION-227C)', () => {
  beforeEach(() => {
    mockUseSysid.mockReset()
    mockUseSysid.mockReturnValue({ data: null, error: null })
  })

  it('shows "—" placeholder when value is null (sysid state 1 or 2)', () => {
    mockUseSysid.mockReturnValue({
      data: { rooms: {}, installation_solar_capacity_kw: null },
      error: null,
    })
    render(
      <SolarBatterySettings
        solar={{ production_entity: 'sensor.solar_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    const row = screen.getByTestId('solar-observed-capacity-row')
    expect(row.textContent).toContain('Solar production capacity (observed)')
    expect(row.textContent).toContain('—')
  })

  it('shows value with "(learning — N/50)" suffix when immature (state 3)', () => {
    mockUseSysid.mockReturnValue({
      data: {
        rooms: {},
        installation_solar_capacity_kw: {
          value: 3.2,
          observations: 12,
          mature: false,
          last_updated_ts: 1700000000.0,
        },
      },
      error: null,
    })
    render(
      <SolarBatterySettings
        solar={{ production_entity: 'sensor.solar_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    const row = screen.getByTestId('solar-observed-capacity-row')
    expect(row.textContent).toContain('3.2 kW')
    expect(row.textContent).toContain('learning')
    expect(row.textContent).toContain('12/50')
  })

  it('shows value without learning suffix when mature (state 4)', () => {
    mockUseSysid.mockReturnValue({
      data: {
        rooms: {},
        installation_solar_capacity_kw: {
          value: 4.5,
          observations: 50,
          mature: true,
          last_updated_ts: 1700000000.0,
        },
      },
      error: null,
    })
    render(
      <SolarBatterySettings
        solar={{ production_entity: 'sensor.solar_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    const row = screen.getByTestId('solar-observed-capacity-row')
    expect(row.textContent).toContain('4.5 kW')
    expect(row.textContent).not.toContain('learning')
    expect(row.textContent).not.toContain('/50')
  })

  it('row is hidden when "I have solar panels" is unchecked', () => {
    // No solar config → checkbox unchecked → solar inner block hidden.
    render(<SolarBatterySettings driver="ha" onRefetch={noop} />)
    expect(screen.queryByTestId('solar-observed-capacity-row')).toBeNull()
  })
})
