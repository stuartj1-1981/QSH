import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DataSharingSettings } from '../DataSharingSettings'
import type { StatusResponse } from '../../../types/api'

const mockPatch = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: mockPatch, saving: false, error: null }),
}))

// INSTRUCTION-255: DataSharingSettings now reads useStatus() to surface the
// last permanent telemetry-push failure. Tests inject a configurable status
// payload via this mock.
let mockStatus: Partial<StatusResponse> | null = null
vi.mock('../../../hooks/useStatus', () => ({
  useStatus: () => ({ data: mockStatus, error: null }),
}))

describe('DataSharingSettings', () => {
  beforeEach(() => {
    mockPatch.mockReset()
    mockPatch.mockResolvedValue({ updated: 'test', restart_required: true, message: 'ok' })
    mockStatus = null
  })

  it('renders with no telemetry config — toggle OFF, region hidden, disclaimer unchecked', () => {
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Select your region')).toBeNull()
    expect(screen.getByText('QSH runs without sending fleet data.')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('renders with existing opted-in config', () => {
    render(
      <DataSharingSettings
        telemetry={{ agreed: true, region: 'London', install_id: 'abc12345-6789' }}
        disclaimerAccepted={true}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('toggle ON shows region selector', () => {
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByText('Select your region')).toBeInTheDocument()
  })

  it('toggle OFF hides region selector', () => {
    render(<DataSharingSettings telemetry={{ agreed: true, region: 'London' }} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('Select your region')).toBeNull()
  })

  it('region required when agreed — shows error, no API call', async () => {
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('Save Changes'))
    expect(await screen.findByText('Please select or enter your region')).toBeInTheDocument()
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('disclaimer required when agreed — shows error', async () => {
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    // Toggle on
    fireEvent.click(screen.getByRole('switch'))
    // Select a region
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'London' } })
    // Don't check disclaimer → save
    fireEvent.click(screen.getByText('Save Changes'))
    expect(await screen.findByText('Please accept the disclaimer to enable data sharing')).toBeInTheDocument()
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('successful save calls patch twice', async () => {
    const onRefetch = vi.fn()
    render(
      <DataSharingSettings
        telemetry={{ agreed: true, region: 'London' }}
        disclaimerAccepted={true}
        driver="ha"
        onRefetch={onRefetch}
      />
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledTimes(2)
      expect(mockPatch).toHaveBeenCalledWith('telemetry', { agreed: true, region: 'London' })
      expect(mockPatch).toHaveBeenCalledWith('disclaimer_accepted', true)
    })
    expect(onRefetch).toHaveBeenCalled()
  })

  it('restart notice shown after save', async () => {
    render(
      <DataSharingSettings
        telemetry={{ agreed: true, region: 'London' }}
        disclaimerAccepted={true}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Save Changes'))
    expect(await screen.findByText(/pipeline will restart/)).toBeInTheDocument()
  })

  it('opted-out save skips validation — patch called with agreed: false', async () => {
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('telemetry', { agreed: false, region: undefined })
      expect(mockPatch).toHaveBeenCalledWith('disclaimer_accepted', false)
    })
  })

  it('install ID displayed when present (behind Show details)', () => {
    render(
      <DataSharingSettings
        telemetry={{ agreed: true, region: 'London', install_id: 'abc12345-6789-defg' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Show details'))
    expect(screen.getByText('Install ID: abc12345...')).toBeInTheDocument()
  })

  it('"Not yet registered" shown when no api_token', () => {
    render(
      <DataSharingSettings
        telemetry={{ agreed: true, region: 'London', install_id: 'abc12345-6789' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Show details'))
    expect(screen.getByText('Status: Not yet registered')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // INSTRUCTION-255 — last-permanent-failure diagnostic block
  // -------------------------------------------------------------------------

  it('does not render last-failure block when field is null', () => {
    mockStatus = { telemetry_last_permanent_failure: null }
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Last telemetry push failure')).toBeNull()
  })

  it('renders last-failure block with status code and detail when field is present', () => {
    mockStatus = {
      telemetry_last_permanent_failure: {
        timestamp: 1779265902.558,
        status_code: 400,
        detail: 'heat_sources[0].name invalid: leading underscore reserved',
        date: '2026-05-20',
      },
    }
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    expect(screen.getByText('Last telemetry push failure')).toBeInTheDocument()
    expect(
      screen.getByText(/Status: 400 — heat_sources\[0\]\.name invalid/),
    ).toBeInTheDocument()
  })

  it('renders timestamp as a human-readable date', () => {
    const ts = 1779265902.558 // 20 May 2026 ~08:31:42 UTC
    mockStatus = {
      telemetry_last_permanent_failure: {
        timestamp: ts,
        status_code: 422,
        detail: 'schema_version 2 required',
        date: '2026-05-20',
      },
    }
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    const rendered = new Date(ts * 1000).toLocaleString()
    // The rendered string lives inside a sibling text node alongside the
    // 'Date dropped' prefix; locate by substring rather than exact match.
    expect(screen.getByText(new RegExp(rendered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
  })
})
