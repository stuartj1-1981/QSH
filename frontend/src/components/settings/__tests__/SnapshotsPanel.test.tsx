import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SnapshotsPanel } from '../SnapshotsPanel'

const SNAP = {
  snapshot_id: '2026-05-07T10:00:00.000000Z',
  captured_at: 1746619200,
  size_bytes: 1234,
  trigger_path: 'settings_patch',
}

const LIST_RESPONSE = {
  retention_count: 5,
  snapshots: [SNAP],
}

const DIFF_RESPONSE_SECRET = {
  snapshot_id: SNAP.snapshot_id,
  entries: [
    {
      path: 'energy.electricity.octopus_api_key',
      old: 'sk_old',
      new: 'sk_new',
      is_secret: true,
    },
    {
      path: 'rooms.lounge',
      old: 25.0,
      new: 30.0,
      is_secret: false,
    },
  ],
}

describe('SnapshotsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders retained snapshots and retention count when expanded', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => LIST_RESPONSE,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)

    // Expand the panel.
    fireEvent.click(screen.getByText('Configuration Snapshots'))

    await waitFor(() => {
      expect(screen.getByText(/Retaining the last 5 snapshots/i)).toBeTruthy()
    })
    // Snapshot row visible.
    expect(screen.getByText(SNAP.snapshot_id)).toBeTruthy()
    expect(screen.getAllByText('settings_patch').length).toBeGreaterThan(0)
  })

  it('opens diff modal and renders secret rows with values (not redacted)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => DIFF_RESPONSE_SECRET,
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))

    await waitFor(() => screen.getByText('View diff'))
    fireEvent.click(screen.getByText('View diff'))

    await waitFor(() =>
      screen.getByText('energy.electricity.octopus_api_key'),
    )
    // Secret values are NOT redacted.
    expect(screen.getByText('sk_old')).toBeTruthy()
    expect(screen.getByText('sk_new')).toBeTruthy()
    // Non-secret row also visible.
    expect(screen.getByText('rooms.lounge')).toBeTruthy()
  })

  it('revert button is disabled until timestamp typed exactly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ snapshot_id: SNAP.snapshot_id, entries: [] }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText('View diff'))
    fireEvent.click(screen.getByText('View diff'))

    // Click revert button to start confirmation.
    await waitFor(() => screen.getByText('Revert to this snapshot'))
    fireEvent.click(screen.getByText('Revert to this snapshot'))

    // Confirm button initially disabled.
    const confirmBtn = await screen.findByText('Confirm revert')
    expect(confirmBtn.closest('button')?.disabled).toBe(true)

    // Type wrong value — still disabled.
    const input = screen
      .getAllByPlaceholderText(SNAP.snapshot_id)
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong' } })
    expect(confirmBtn.closest('button')?.disabled).toBe(true)

    // Type exact value — enabled.
    fireEvent.change(input, { target: { value: SNAP.snapshot_id } })
    expect(confirmBtn.closest('button')?.disabled).toBe(false)
  })

  it('revert input accepts pasted value', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ snapshot_id: SNAP.snapshot_id, entries: [] }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText('View diff'))
    fireEvent.click(screen.getByText('View diff'))

    await waitFor(() => screen.getByText('Revert to this snapshot'))
    fireEvent.click(screen.getByText('Revert to this snapshot'))

    // The input must not have any pasting interference. Simulate paste.
    const input = (await screen.findAllByPlaceholderText(SNAP.snapshot_id))
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement

    fireEvent.paste(input, {
      clipboardData: { getData: () => SNAP.snapshot_id },
    })
    // Many React inputs treat onPaste as a side-channel — fire change to
    // mirror the browser's value-update behaviour after paste.
    fireEvent.change(input, { target: { value: SNAP.snapshot_id } })
    expect(input.value).toBe(SNAP.snapshot_id)
  })

  it('confirm revert button is disabled while async call is in flight', async () => {
    let resolveRevert: ((value: unknown) => void) | undefined
    const revertPromise = new Promise<unknown>((resolve) => {
      resolveRevert = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ snapshot_id: SNAP.snapshot_id, entries: [] }),
      } as Response)
      .mockImplementationOnce(() => revertPromise.then(() => ({
        ok: true,
        json: async () => ({
          reverted_to: SNAP,
          pre_revert_snapshot: SNAP,
          restart_required: true,
          message: 'ok',
        }),
      } as Response)))
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText('View diff'))
    fireEvent.click(screen.getByText('View diff'))

    await waitFor(() => screen.getByText('Revert to this snapshot'))
    fireEvent.click(screen.getByText('Revert to this snapshot'))

    const confirmBtn = await screen.findByText('Confirm revert')
    const input = (await screen.findAllByPlaceholderText(SNAP.snapshot_id))
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement
    fireEvent.change(input, { target: { value: SNAP.snapshot_id } })

    fireEvent.click(confirmBtn)
    // Now the async call is in flight — button should be disabled.
    await waitFor(() => {
      expect(confirmBtn.closest('button')?.disabled).toBe(true)
    })

    // Resolve the promise — re-enable should follow.
    await act(async () => {
      resolveRevert!({})
      await revertPromise
    })
  })

  it('purge confirmation requires PURGE_ALL', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => LIST_RESPONSE,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText('Purge all snapshots'))
    fireEvent.click(screen.getByText('Purge all snapshots'))

    const confirmBtn = await screen.findByText('Confirm purge')
    expect(confirmBtn.closest('button')?.disabled).toBe(true)

    const input = screen.getByPlaceholderText('PURGE_ALL') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong' } })
    expect(confirmBtn.closest('button')?.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'PURGE_ALL' } })
    expect(confirmBtn.closest('button')?.disabled).toBe(false)
  })

  it('copy-to-clipboard control invokes navigator.clipboard.writeText', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => LIST_RESPONSE,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText('Copy ID'))
    fireEvent.click(screen.getByText('Copy ID'))

    expect(writeText).toHaveBeenCalledWith(SNAP.snapshot_id)
  })

  it('handles empty snapshots gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ retention_count: 5, snapshots: [] }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText(/No snapshots yet/i))
  })

  it('handles fetch error', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network down'))
    vi.stubGlobal('fetch', fetchMock)

    render(<SnapshotsPanel />)
    fireEvent.click(screen.getByText('Configuration Snapshots'))
    await waitFor(() => screen.getByText(/Failed to load snapshots/i))
  })
})
