import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockSave = vi.fn()

const mockHookReturn = {
  data: {
    comfort_temp: 'input_number.ct',
    flow_min_temp: '',
    flow_max_temp: '',
    antifrost_oat_threshold: '',
    shoulder_threshold: '',
    overtemp_protection: '',
  },
  loading: false,
  error: null as string | null,
  saving: false,
  save: mockSave,
  refetch: vi.fn(),
}

vi.mock('../../../hooks/useExternalSetpoints', () => ({
  useExternalSetpoints: () => mockHookReturn,
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { ExternalSetpointSettings } from '../ExternalSetpointSettings'

const noop = () => {}

describe('ExternalSetpointSettings driver branching', () => {
  it('MQTT driver: renders notice, no entity fields', () => {
    render(<ExternalSetpointSettings driver="mqtt" onRefetch={noop} />)

    expect(screen.getByText('External Setpoints')).toBeInTheDocument()
    expect(screen.getByText(/External setpoint entity binding is a Home Assistant driver feature/)).toBeInTheDocument()
    expect(screen.getByText(/publish setpoint values directly/)).toBeInTheDocument()
    // No entity fields
    expect(screen.queryByText(/Comfort Temperature/)).toBeNull()
    expect(screen.queryByText(/Flow Minimum/)).toBeNull()
    expect(screen.queryByText(/Save Changes/)).toBeNull()
  })

  it('HA driver: renders six entity fields', () => {
    render(<ExternalSetpointSettings driver="ha" onRefetch={noop} />)

    expect(screen.getByText(/Comfort Temperature/)).toBeInTheDocument()
    expect(screen.getByText(/Flow Minimum Temperature/)).toBeInTheDocument()
    expect(screen.getByText(/Flow Maximum Temperature/)).toBeInTheDocument()
    expect(screen.getByText(/Antifrost OAT Threshold/)).toBeInTheDocument()
    expect(screen.getByText(/Shoulder Shutdown Threshold/)).toBeInTheDocument()
    expect(screen.getByText(/Overtemp Protection/)).toBeInTheDocument()
  })

  it('HA driver: does not show MQTT notice', () => {
    render(<ExternalSetpointSettings driver="ha" onRefetch={noop} />)

    expect(screen.queryByText(/External setpoint entity binding is a Home Assistant driver feature/)).toBeNull()
  })
})
