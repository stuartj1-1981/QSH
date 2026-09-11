import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoreSettingsPanel } from '../StoreSettingsPanel'

const RAW_CONFIG = {
  historian: {
    enabled: true,
    host: 'a0d7b954-influxdb',
    port: 8086,
    database: 'qsh',
    username: 'qsh',
    password: '***REDACTED***',
    store: {
      shadow: true,
      cutover: 'manual',
      cutover_force: false,
      retention_days: 10,
      local_cache_days: 20,
      external_path: '/share/qsdb',
      parity_report: false,
    },
  },
}

function mockFetchRouter() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('config/raw') && method === 'GET') {
      return { ok: true, status: 200, json: async () => RAW_CONFIG } as Response
    }
    if (url.includes('config/historian') && method === 'PATCH') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ updated: 'historian', restart_required: true, message: 'ok' }),
      } as Response
    }
    if (url.includes('config/test-store')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          duckdb: { available: true, version: '1.0.0' },
          root: { path: '/share/qsdb', exists: true, writable: true, free_bytes: 1000 },
          migration: { state: 'shadow' },
          external_path: { form_ok: true, reachable: true },
        }),
      } as Response
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled())
}

describe('StoreSettingsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the restart warning always', async () => {
    mockFetchRouter()
    render(<StoreSettingsPanel backfillState={null} />)
    await waitForLoaded()
    expect(screen.getByText(/Saving restarts the pipeline/)).toBeDefined()
  })

  it('with backfill_state pulling, save requires a second confirmation and the first click calls nothing', async () => {
    const fetchSpy = mockFetchRouter()
    const user = userEvent.setup()
    render(<StoreSettingsPanel backfillState="pulling" />)
    await waitForLoaded()

    const callsBeforeClick = fetchSpy.mock.calls.length
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    // No PATCH issued by the first click — only the initial GET has fired.
    const patchCalls = fetchSpy.mock.calls.filter(
      (c) => String(c[0]).includes('config/historian') && (c[1] as RequestInit | undefined)?.method === 'PATCH',
    )
    expect(patchCalls.length).toBe(0)
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeClick)
    expect(screen.getByText(/in flight/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /confirm save/i })).toBeDefined()

    await user.click(screen.getByRole('button', { name: /confirm save/i }))

    await waitFor(() => {
      const afterPatchCalls = fetchSpy.mock.calls.filter(
        (c) =>
          String(c[0]).includes('config/historian') && (c[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(afterPatchCalls.length).toBe(1)
    })
  })

  it('shadow and cutover render as text and not as inputs', async () => {
    mockFetchRouter()
    render(<StoreSettingsPanel backfillState={null} />)
    await waitForLoaded()

    expect(screen.getByText('true')).toBeDefined()
    expect(screen.getByText('manual')).toBeDefined()
    // Only one checkbox on the panel: parity_report. shadow is not one.
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(1)
  })

  it('cutover_force does not appear in the DOM at all', async () => {
    mockFetchRouter()
    const { container } = render(<StoreSettingsPanel backfillState={null} />)
    await waitForLoaded()

    expect(container.textContent).not.toMatch(/cutover_force/)
  })

  it('saving without a mid-migration state sends the PATCH directly on one click', async () => {
    const fetchSpy = mockFetchRouter()
    const user = userEvent.setup()
    render(<StoreSettingsPanel backfillState={null} />)
    await waitForLoaded()

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      const patchCalls = fetchSpy.mock.calls.filter(
        (c) =>
          String(c[0]).includes('config/historian') && (c[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patchCalls.length).toBe(1)
    })
  })
})
