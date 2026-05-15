import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HotWaterSettings } from '../HotWaterSettings'

const noop = () => {}

describe('HotWaterSettings driver branching', () => {
  it('MQTT driver, dual probes: renders two TopicField inputs', () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50, sensor_top: 'temps/hwTopTemp', sensor_bottom: 'temps/hwBotTemp' }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Top Probe Topic')).toBeInTheDocument()
    expect(screen.getByText('Bottom Probe Topic')).toBeInTheDocument()
    expect(screen.getByDisplayValue('temps/hwTopTemp')).toBeInTheDocument()
    expect(screen.getByDisplayValue('temps/hwBotTemp')).toBeInTheDocument()
  })

  it('legacy HwTankYaml.water_heater_entity prop value is not rendered as a control in either driver (127B consolidation)', () => {
    // INSTRUCTION-236 re-introduces a "Water Heater Entity (primary)" control,
    // but it reads from heat_source.sensors.water_heater — NOT from
    // HwTankYaml.water_heater_entity. The 127B contract is that the tank-level
    // legacy field is not surfaced; assert by the prop's value, not by label
    // (the new field's label substring-matches the prior regex by coincidence).
    ;(['ha', 'mqtt'] as const).forEach((driver) => {
      const { unmount } = render(
        <HotWaterSettings
          hwPlan="W"
          hwTank={{ volume_litres: 200, target_temperature: 50, water_heater_entity: 'water_heater.hp' }}
          driver={driver}
          onRefetch={noop}
        />
      )
      expect(screen.queryByDisplayValue('water_heater.hp')).toBeNull()
      unmount()
    })
  })

  it('MQTT driver: schedule source hides HA entity option', () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwSchedule={{ source: 'fixed', fixed_start_time: '02:30' }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.queryByText('HA entity')).toBeNull()
    expect(screen.getByText('Fixed time')).toBeInTheDocument()
    expect(screen.getByText(/HA Schedule integration is unavailable/)).toBeInTheDocument()
  })

  it('HA driver: schedule source shows HA entity option', () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwSchedule={{ source: 'fixed', fixed_start_time: '02:30' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('HA entity')).toBeInTheDocument()
  })

  it('HA driver, dual probes: renders EntityField', () => {
    render(
      <HotWaterSettings
        hwPlan="W"
        hwTank={{ volume_litres: 200, target_temperature: 50, sensor_top: 'sensor.hw_top', sensor_bottom: 'sensor.hw_bot' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Top Sensor')).toBeInTheDocument()
    expect(screen.getByText('Bottom Sensor')).toBeInTheDocument()
  })
})
