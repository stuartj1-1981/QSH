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

vi.mock('../../../hooks/useConfig', () => ({
  useConfig: () => ({
    data: { control: { pid_target_topic: 'qsh/setpoint/pid_target' } },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

import { ExternalSetpointSettings } from '../ExternalSetpointSettings'

const noop = () => {}

describe('ExternalSetpointSettings driver branching', () => {
  it('MQTT driver: renders the topic panel, no entity fields (INSTRUCTION-400)', () => {
    render(<ExternalSetpointSettings driver="mqtt" onRefetch={noop} />)

    expect(screen.getByText('External Setpoints')).toBeInTheDocument()
    expect(screen.getByText('MQTT setpoint input topics')).toBeInTheDocument()
    expect(screen.getByText('qsh/setpoint/pid_target')).toBeInTheDocument()
    // The old dead-end copy is gone.
    expect(screen.queryByText(/until they exist/)).toBeNull()
    // No entity binding fields / Save button on the MQTT branch.
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

  it('HA driver: does not show the MQTT topic panel', () => {
    render(<ExternalSetpointSettings driver="ha" onRefetch={noop} />)

    expect(screen.queryByText('MQTT setpoint input topics')).toBeNull()
  })
})
