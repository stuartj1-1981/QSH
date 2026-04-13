import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlSettings } from '../ControlSettings'

const mockPatch = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: mockPatch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

describe('ControlSettings', () => {
  beforeEach(() => {
    mockPatch.mockReset()
    mockPatch.mockResolvedValue({ updated: 'control', restart_required: true, message: 'ok' })
  })

  it('renders entity field for Active Control with "(using internal value)" when blank', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ dfan_control_internal: true }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.getByText('Active Control')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('input_boolean.dfan_control')).toBeInTheDocument()
    expect(screen.getAllByText('(using internal value)').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/When ON, QSH controls your heat source/)).toBeInTheDocument()
  })

  it('renders entity field for PID Target with "(using internal value)" when blank', () => {
    render(
      <ControlSettings
        control={{}}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.getByText('PID Target Temperature (°C)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('input_number.pid_target_temperature')).toBeInTheDocument()
    // Two "(using internal value)" texts: one for dfan, one for pid
    expect(screen.getAllByText('(using internal value)')).toHaveLength(2)
  })

  it('shows entity value when dfan entity is configured', () => {
    render(
      <ControlSettings
        control={{ dfan_control_entity: 'input_boolean.dfan_control' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    const input = screen.getByDisplayValue('input_boolean.dfan_control')
    expect(input).toBeInTheDocument()
    // Should show external description instead
    expect(screen.getByText(/QSH reads the bound entity state each cycle/)).toBeInTheDocument()
  })

  it('shows entity value when pid_target entity is configured', () => {
    render(
      <ControlSettings
        control={{ pid_target_entity: 'input_number.pid_target_temperature' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    const input = screen.getByDisplayValue('input_number.pid_target_temperature')
    expect(input).toBeInTheDocument()
    // Only dfan should show "(using internal value)" since pid has entity
    expect(screen.getAllByText('(using internal value)')).toHaveLength(1)
  })

  it('does not render toggle switch or "Use external HA entity instead" links', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ dfan_control_internal: true }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.queryByText(/Use external HA entity instead/)).toBeNull()
  })

  it('no deprecated label on dfan_control', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ dfan_control_internal: true }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.queryByText(/deprecated/i)).toBeNull()
    expect(screen.queryByText(/legacy/i)).toBeNull()
  })

  it('renders nudge budget input unchanged', () => {
    render(
      <ControlSettings
        control={{ nudge_budget: 2.5 }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.getByText('Nudge Budget')).toBeInTheDocument()
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(2.5)
  })

  it('renders shadow toggle for MQTT driver', () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'mqtt', publish_mqtt_shadow: true }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.getByText('Publish MQTT Shadow Topics')).toBeInTheDocument()
    expect(screen.getByText(/publishes shadow metrics/)).toBeInTheDocument()
  })

  it('does not render shadow toggle for HA driver', () => {
    render(
      <ControlSettings
        control={{ nudge_budget: 3.0 }}
        rootConfig={{ driver: 'ha' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.queryByText('Publish MQTT Shadow Topics')).not.toBeInTheDocument()
    expect(screen.queryByText('Create Dashboard Entities')).not.toBeInTheDocument()
  })

  it('allows typing entity ID into Active Control field', () => {
    render(
      <ControlSettings
        control={{}}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    const input = screen.getByPlaceholderText('input_boolean.dfan_control')
    fireEvent.change(input, { target: { value: 'input_boolean.my_control' } })
    expect(input).toHaveValue('input_boolean.my_control')
  })
})
