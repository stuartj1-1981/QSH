import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: vi.fn().mockResolvedValue({ updated: 'ok' }), saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const noop = () => {}
const baseHs = { type: 'heat_pump' as const, efficiency: 3.5 }

describe('HeatSourceSettings driver branching', () => {
  it('HA driver: renders flow control method select', () => {
    render(<HeatSourceSettings heatSource={baseHs} driver="ha" onRefetch={noop} />)
    const selects = screen.getAllByRole('combobox')
    // One of the selects should have the HA Service option
    const methodSelect = selects.find(s => {
      const options = Array.from(s.querySelectorAll('option'))
      return options.some(o => o.textContent === 'HA Service')
    })
    expect(methodSelect).toBeTruthy()
  })

  it('MQTT driver: hides flow control method select, shows read-only', () => {
    render(<HeatSourceSettings heatSource={baseHs} driver="mqtt" onRefetch={noop} />)
    expect(screen.getByText('MQTT')).toBeInTheDocument()
    // No select with HA Service option should exist
    const selects = screen.queryAllByRole('combobox')
    const methodSelect = selects.find(s => {
      const options = Array.from(s.querySelectorAll('option'))
      return options.some(o => o.textContent === 'HA Service')
    })
    expect(methodSelect).toBeFalsy()
  })

  it('MQTT driver: hides flow min/max entity overrides', () => {
    const hsWithEntities = {
      ...baseHs,
      flow_min_entity: 'input_number.flow_min',
      flow_max_entity: 'input_number.flow_max',
    }
    render(<HeatSourceSettings heatSource={hsWithEntities} driver="mqtt" onRefetch={noop} />)
    expect(screen.queryByText('Flow Min Entity')).toBeNull()
    expect(screen.queryByText('Flow Max Entity')).toBeNull()
  })

  it('MQTT driver: sensor section uses TopicField when expanded', () => {
    render(<HeatSourceSettings heatSource={baseHs} driver="mqtt" onRefetch={noop} />)
    // Expand sensors
    fireEvent.click(screen.getByText('Sensor Topics'))
    // Should have TopicField inputs (identifiable by placeholder text)
    expect(screen.getByPlaceholderText('heat_pump/flow_temp')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('heat_pump/power')).toBeInTheDocument()
  })

  it('HA driver: sensor section uses EntityField when expanded', () => {
    render(<HeatSourceSettings heatSource={baseHs} driver="ha" onRefetch={noop} />)
    // Expand sensors
    fireEvent.click(screen.getByText('Sensor Entities'))
    // Should have EntityField inputs (identifiable by placeholder text)
    expect(screen.getByPlaceholderText('sensor.hp_flow_temp')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('sensor.hp_power')).toBeInTheDocument()
  })

  it('MQTT driver: flow control details show TopicField', () => {
    render(<HeatSourceSettings heatSource={baseHs} driver="mqtt" onRefetch={noop} />)
    fireEvent.click(screen.getByText('Flow & On/Off Control Details'))
    expect(screen.getByPlaceholderText('heat_pump/flow_temp/set')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('heat_pump/mode/set')).toBeInTheDocument()
  })
})
