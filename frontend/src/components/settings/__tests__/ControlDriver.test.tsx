import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: vi.fn().mockResolvedValue({}), saving: false }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { ControlSettings } from '../ControlSettings'

const noop = () => {}

describe('ControlSettings driver branching', () => {
  it('HA driver: renders EntityField for dfan and pid', () => {
    render(
      <ControlSettings
        control={{ dfan_control_entity: 'input_boolean.dfan_control' }}
        rootConfig={{ driver: 'ha' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Active Control')).toBeInTheDocument()
    expect(screen.getByText('PID Target Temperature (°C)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('input_boolean.dfan_control')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('input_number.pid_target_temperature')).toBeInTheDocument()
    // No TopicField labels
    expect(screen.queryByText('Active Control Topic')).toBeNull()
    expect(screen.queryByText(/PID Target Temperature Topic/)).toBeNull()
  })

  it('MQTT driver: renders TopicField for dfan and pid', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'mqtt' }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Active Control Topic')).toBeInTheDocument()
    expect(screen.getByText('PID Target Temperature Topic (°C)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('control/dfan_control')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('control/pid_target')).toBeInTheDocument()
    // No EntityField labels
    expect(screen.queryByText('Active Control')).toBeNull()
    expect(screen.queryByText('PID Target Temperature (°C)')).toBeNull()
  })

  it('MQTT driver: shows MQTT-specific help text', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'mqtt' }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText(/Boolean topic/)).toBeInTheDocument()
  })

  it('MQTT driver: shows shadow toggle', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'mqtt', publish_mqtt_shadow: true }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Publish MQTT Shadow Topics')).toBeInTheDocument()
  })

  it('HA driver: does not show shadow toggle', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'ha' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.queryByText('Publish MQTT Shadow Topics')).toBeNull()
  })

  it('MQTT driver: shows "(using internal value)" when topics are empty', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'mqtt' }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getAllByText('(using internal value)')).toHaveLength(2)
  })
})
