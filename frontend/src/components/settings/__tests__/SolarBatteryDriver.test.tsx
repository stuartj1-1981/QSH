import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
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
