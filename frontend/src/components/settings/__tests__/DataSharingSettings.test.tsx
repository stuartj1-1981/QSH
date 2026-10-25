import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { DataSharingSettings } from '../DataSharingSettings'
import { apiUrl } from '../../../lib/api'
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
    // INSTRUCTION-570C: the page reads the swarm unit ID. The default read never
    // settles, so no test reads the network or sets state after it ends.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
  // -------------------------------------------------------------------------
  // INSTRUCTION-570C — the location level
  // -------------------------------------------------------------------------

  const DISTRICT = { agreed: true, region: 'London', location_level: 'district' as const, location_code: 'ZZ99' }

  function telemetryCalls() {
    return mockPatch.mock.calls.filter((c) => c[0] === 'telemetry')
  }

  it('a save sends the fragment as typed', async () => {
    render(<DataSharingSettings telemetry={DISTRICT} disclaimerAccepted={true} driver="ha" onRefetch={() => {}} />)
    fireEvent.change(screen.getByLabelText('First part of your postcode'), { target: { value: ' zz99 ' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(telemetryCalls()).toHaveLength(1))
    expect(telemetryCalls()[0][1]).toEqual({
      agreed: true,
      region: 'London',
      location_level: 'district',
      location_code: ' zz99 ',
    })
  })

  it('a save at the region level sends no location level', async () => {
    render(<DataSharingSettings telemetry={DISTRICT} disclaimerAccepted={true} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Region only' }))
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(telemetryCalls()).toHaveLength(1))
    expect(telemetryCalls()[0][1]).not.toHaveProperty('location_level')
  })

  it('a save with data sharing turned off sends neither location field', async () => {
    render(<DataSharingSettings telemetry={DISTRICT} disclaimerAccepted={true} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(telemetryCalls()).toHaveLength(1))
    const body = telemetryCalls()[0][1]
    expect(body).toEqual({ agreed: false, region: undefined })
    expect(body).not.toHaveProperty('location_level')
    expect(body).not.toHaveProperty('location_code')
  })

  it('a save in International mode sends the region only', async () => {
    render(
      <DataSharingSettings
        telemetry={{ ...DISTRICT, region: 'Northern France' }}
        disclaimerAccepted={true}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(telemetryCalls()).toHaveLength(1))
    expect(telemetryCalls()[0][1]).toEqual({ agreed: true, region: 'Northern France' })
  })

  it('International then UK leaves the region level and no postcode box', () => {
    render(<DataSharingSettings telemetry={DISTRICT} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByText('International'))
    fireEvent.click(screen.getByText('UK'))
    expect(screen.getByRole('radio', { name: 'Region only' })).toBeChecked()
    expect(screen.queryByLabelText('First part of your postcode')).toBeNull()
  })

  it('with data sharing off shows no level control', () => {
    render(
      <DataSharingSettings
        telemetry={{ agreed: false, location_level: 'district', location_code: 'ZZ99' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('shows the stored level after a refetch', () => {
    const { rerender } = render(
      <DataSharingSettings telemetry={{ ...DISTRICT, location_code: 'zz99' }} driver="ha" onRefetch={() => {}} />
    )
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('zz99')
    rerender(
      <DataSharingSettings
        telemetry={{ ...DISTRICT, location_level: 'sector', location_code: 'ZZ99 9' }}
        driver="ha"
        onRefetch={() => {}}
      />
    )
    expect(screen.getByRole('radio', { name: 'Postcode sector' })).toBeChecked()
    const box = screen.getByLabelText('First part of your postcode and the next digit') as HTMLInputElement
    expect(box.value).toBe('ZZ99 9')
  })

  // -------------------------------------------------------------------------
  // INSTRUCTION-570C — the swarm unit ID (parent R18)
  // -------------------------------------------------------------------------

  function stubStatus(body: unknown) {
    const stub = vi.fn().mockResolvedValue({ json: () => Promise.resolve(body) })
    vi.stubGlobal('fetch', stub)
    return stub
  }

  it('shows the swarm unit ID in full with data sharing off', async () => {
    const stub = stubStatus({ enabled: false, unit_id: 'unit-zz99-0001' })
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    expect(await screen.findByText('unit-zz99-0001')).toBeInTheDocument()
    expect(screen.getByText('Give this ID if you ask for a copy of your data or for its deletion.')).toBeInTheDocument()
    expect(stub).toHaveBeenCalledTimes(1)
    expect(stub.mock.calls[0][0]).toBe(apiUrl('api/swarm/status'))
  })

  it('shows the swarm unit ID with data sharing on', async () => {
    stubStatus({ enabled: true, unit_id: 'unit-zz99-0001' })
    render(<DataSharingSettings telemetry={{ agreed: true, region: 'London' }} driver="ha" onRefetch={() => {}} />)
    expect(await screen.findByText('unit-zz99-0001')).toBeInTheDocument()
  })

  it('shows no ID line and no failure for a unit with no swarm identity', async () => {
    const json = vi.fn().mockResolvedValue({ enabled: false, unit_id: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json }))
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    await waitFor(() => expect(json).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.queryByText(/Swarm unit ID:/)).toBeNull()
    expect(screen.queryByText(/could not be read/)).toBeNull()
  })

  it('says so when the swarm unit ID cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    render(<DataSharingSettings driver="ha" onRefetch={() => {}} />)
    expect(
      await screen.findByText('The swarm unit ID could not be read. Open this page again to see it.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Swarm unit ID:/)).toBeNull()
  })
})
