import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CutoverPanel } from '../CutoverPanel'
import type { StoreStats } from '../../../types/api'

function stats(overrides: Partial<StoreStats>): StoreStats {
  return {
    migration_state: null,
    backfill_state: null,
    backend_config: 'qsdb',
    backend_effective: 'influxdb',
    unreconciled_days: null,
    source_ok: null,
    source_last_error: null,
    ...overrides,
  }
}

describe('CutoverPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers the control in every pre-cutover state', () => {
    for (const state of ['shadow', 'backfill', 'reconciled']) {
      const { unmount } = render(<CutoverPanel stats={stats({ migration_state: state })} />)
      expect(screen.getByRole('button', { name: /cut over/i })).toBeDefined()
      unmount()
    }
  })

  it('is absent after cutover', () => {
    render(<CutoverPanel stats={stats({ migration_state: 'cutover' })} />)
    expect(screen.queryByRole('button', { name: /cut over/i })).toBeNull()
    expect(screen.getByText('Already cut over.')).toBeDefined()
  })

  it('the first click confirms and sends nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<CutoverPanel stats={stats({ migration_state: 'shadow', unreconciled_days: 3 })} />)

    await user.click(screen.getByRole('button', { name: /cut over/i }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm cutover/i })).toBeDefined()
  })

  it('the second click sends {} — asserted on the request body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'cutover', gap_days: 0, forced: false }),
    } as Response)
    const user = userEvent.setup()
    render(<CutoverPanel stats={stats({ migration_state: 'reconciled', unreconciled_days: 0 })} />)

    await user.click(screen.getByRole('button', { name: /cut over/i }))
    await user.click(screen.getByRole('button', { name: /confirm cutover/i }))

    await waitFor(() => expect(screen.getByText('state: cutover')).toBeDefined())

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toContain('api/historian/migration/cutover')
    const body = JSON.parse(call[1].body as string)
    expect(body).toEqual({})
    // OB-1 — force never appears in the request body.
    expect(Object.prototype.hasOwnProperty.call(body, 'force')).toBe(false)
  })

  it('renders unreconciled_days and source_last_error on a 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        detail: { error: 'cutover refused', unreconciled_days: 4, source_last_error: 'timeout' },
      }),
    } as Response)
    const user = userEvent.setup()
    render(<CutoverPanel stats={stats({ migration_state: 'backfill', unreconciled_days: 4 })} />)

    await user.click(screen.getByRole('button', { name: /cut over/i }))
    await user.click(screen.getByRole('button', { name: /confirm cutover/i }))

    await waitFor(() => expect(screen.getByText('unreconciled_days: 4')).toBeDefined())
    expect(screen.getByText('source_last_error: timeout')).toBeDefined()
    expect(screen.getByText(/command-line act/)).toBeDefined()
  })
})
