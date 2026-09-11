import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlConsole } from '../SqlConsole'

function mockFetchOnce(status: number, body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

async function runQuery(user: ReturnType<typeof userEvent.setup>, sql = 'SELECT 1') {
  const textarea = screen.getByPlaceholderText(/SELECT \* FROM/)
  await user.type(textarea, sql)
  await user.click(screen.getByRole('button', { name: /run/i }))
}

describe('SqlConsole', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the grid on a 200', async () => {
    mockFetchOnce(200, {
      columns: ['t', 'v'],
      rows: [[1, 2.5]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 12,
      snapshot_age_s: 3,
      sealed_days: 5,
    })
    const user = userEvent.setup()
    render(<SqlConsole />)
    await runQuery(user)

    await waitFor(() => expect(screen.getByText('row_count: 1')).toBeDefined())
    expect(screen.getByText('elapsed_ms: 12')).toBeDefined()
    expect(screen.getByText('t')).toBeDefined()
    expect(screen.getByText('v')).toBeDefined()
    expect(screen.getByText('2.5')).toBeDefined()
    expect(screen.queryByText(/Truncated at 10,000/)).toBeNull()
  })

  it('renders the truncated banner distinctly from a complete result', async () => {
    mockFetchOnce(200, {
      columns: ['t'],
      rows: [[1]],
      row_count: 10000,
      truncated: true,
      elapsed_ms: 500,
      snapshot_age_s: null,
      sealed_days: 5,
    })
    const user = userEvent.setup()
    render(<SqlConsole />)
    await runQuery(user)

    await waitFor(() => expect(screen.getByText(/Truncated at 10,000/)).toBeDefined())
  })

  it('renders its own message for a 400', async () => {
    mockFetchOnce(400, { error: 'only SELECT statements are admitted' })
    const user = userEvent.setup()
    render(<SqlConsole />)
    await runQuery(user, 'DROP TABLE x')

    await waitFor(() =>
      expect(screen.getByText(/Not admitted: only SELECT statements are admitted/)).toBeDefined(),
    )
  })

  it('renders its own message for a 429, distinct from the 400 case', async () => {
    mockFetchOnce(429, { error: 'one query at a time' })
    const user = userEvent.setup()
    render(<SqlConsole />)
    await runQuery(user)

    await waitFor(() => expect(screen.getByText(/Busy: one query at a time/)).toBeDefined())
    expect(screen.queryByText(/Not admitted/)).toBeNull()
  })

  it('renders its own message for a 504, distinct from the 400 and 429 cases', async () => {
    mockFetchOnce(504, { error: 'query exceeded 30s and was interrupted' })
    const user = userEvent.setup()
    render(<SqlConsole />)
    await runQuery(user)

    await waitFor(() => expect(screen.getByText(/Timed out: query exceeded 30s/)).toBeDefined())
    expect(screen.queryByText(/Not admitted/)).toBeNull()
    expect(screen.queryByText(/Busy:/)).toBeNull()
  })

  it('submits on Cmd/Ctrl+Enter', async () => {
    mockFetchOnce(200, {
      columns: ['t'],
      rows: [[1]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 1,
    })
    const user = userEvent.setup()
    render(<SqlConsole />)
    const textarea = screen.getByPlaceholderText(/SELECT \* FROM/)
    await user.type(textarea, 'SELECT 1')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(screen.getByText('row_count: 1')).toBeDefined())
  })

  it('does not submit on plain typing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<SqlConsole />)
    const textarea = screen.getByPlaceholderText(/SELECT \* FROM/)
    await user.type(textarea, 'SELECT 1')

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('CSV export builds a blob containing all rows, not the visible page', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => [i])
    mockFetchOnce(200, {
      columns: ['n'],
      rows,
      row_count: 250,
      truncated: false,
      elapsed_ms: 5,
    })
    const user = userEvent.setup()
    render(<SqlConsole />)
    await runQuery(user)

    await waitFor(() => expect(screen.getByText('row_count: 250')).toBeDefined())

    let capturedBlob: Blob | null = null
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => {
        capturedBlob = obj as Blob
        return 'blob:mock'
      })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: /csv/i }))

    expect(clickSpy).toHaveBeenCalled()
    expect(capturedBlob).not.toBeNull()
    const text = await (capturedBlob as unknown as Blob).text()
    const lines = text.trim().split('\n')
    // Header + 250 data rows — the whole result, not the 200-row visible page.
    expect(lines.length).toBe(251)

    createObjectURLSpy.mockRestore()
  })
})
