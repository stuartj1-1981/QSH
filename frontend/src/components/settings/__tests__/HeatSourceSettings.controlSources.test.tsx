/**
 * INSTRUCTION-438 WS-C (D8/QG8) — live-data tests for the control-source
 * visibility pipe. Before 438 the four ControlValueDisplay call sites in
 * HeatSourceSettings permanently passed `controlSource={undefined}`, so the
 * component's external-connected and external-unavailable states were
 * unreachable through the app. These tests feed real /api/status shapes
 * through the useStatus → HeatSourceSettings → SourceCard →
 * ControlValueDisplay pipe and pin both previously-unreachable states, plus
 * the pre-bridge rendering when the backend offers no resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ControlSource } from '../../../types/api'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

const statusData: { control_sources?: ControlSource[] } = {}

vi.mock('../../../hooks/useStatus', () => ({
  useStatus: () => ({ data: statusData, error: null }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const noop = () => {}
const baseHs = { type: 'heat_pump' as const, efficiency: 3.5 }

beforeEach(() => {
  patch.mockReset()
  delete statusData.control_sources
})

describe('HeatSourceSettings — control-source provenance (INSTRUCTION-438 D8)', () => {
  it('external-connected flow_min renders the live value with its topic badge', () => {
    statusData.control_sources = [
      {
        key: 'flow_min',
        value: 32.5,
        source: 'external',
        external_id: 'qsh/control/flow_min',
        external_raw: '32.5',
      },
    ]
    render(
      <HeatSourceSettings heatSource={baseHs} driver="mqtt" onRefetch={noop} />,
    )
    expect(screen.getByText('32.5 °C')).toBeInTheDocument()
    expect(screen.getByText('via qsh/control/flow_min')).toBeInTheDocument()
  })

  it('external-configured-but-unavailable flow_max renders the fallback state', () => {
    statusData.control_sources = [
      {
        key: 'flow_max',
        value: 50,
        source: 'internal',
        external_id: 'qsh/control/flow_max',
        external_raw: '',
      },
    ]
    render(
      <HeatSourceSettings heatSource={baseHs} driver="mqtt" onRefetch={noop} />,
    )
    expect(screen.getByText('(fallback)')).toBeInTheDocument()
    expect(
      screen.getByText('qsh/control/flow_max unavailable'),
    ).toBeInTheDocument()
  })

  it('empty control_sources keeps the pre-bridge internal editors', () => {
    statusData.control_sources = []
    render(
      <HeatSourceSettings heatSource={baseHs} driver="mqtt" onRefetch={noop} />,
    )
    expect(screen.getByText('Flow Min Temperature')).toBeInTheDocument()
    expect(screen.getByText('Flow Max Temperature')).toBeInTheDocument()
    expect(screen.queryByText(/via /)).toBeNull()
    expect(screen.queryByText('(fallback)')).toBeNull()
  })

  it('absent control_sources key (pre-438 backend) keeps the internal editors', () => {
    render(
      <HeatSourceSettings heatSource={baseHs} driver="ha" onRefetch={noop} />,
    )
    expect(screen.getByText('Flow Min Temperature')).toBeInTheDocument()
    expect(screen.queryByText(/via /)).toBeNull()
  })
})
