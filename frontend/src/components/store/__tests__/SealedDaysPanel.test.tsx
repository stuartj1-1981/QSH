import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SealedDaysPanel } from '../SealedDaysPanel'
import { useSealedDays } from '../../../hooks/useStore'

vi.mock('../../../hooks/useStore', () => ({
  useSealedDays: vi.fn(),
}))

const mockedUseSealedDays = vi.mocked(useSealedDays)

function row(day: string) {
  return {
    measurement: 'qsh_system',
    day,
    location: 'local' as const,
    path: '/x',
    cache_path: null,
    rows: 1000,
    sha256: 'abc',
  }
}

describe('SealedDaysPanel', () => {
  beforeEach(() => {
    mockedUseSealedDays.mockReset()
  })

  it('renders a page of rows', () => {
    mockedUseSealedDays.mockReturnValue({
      data: { historian: true, store: true, days: [row('2026-09-01'), row('2026-09-02')], total: 2, truncated: false },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<SealedDaysPanel />)
    expect(screen.getByText('2026-09-01')).toBeDefined()
    expect(screen.getByText('2026-09-02')).toBeDefined()
  })

  it('shows the "showing X–Y of N" line', () => {
    mockedUseSealedDays.mockReturnValue({
      data: { historian: true, store: true, days: [row('2026-09-01')], total: 250, truncated: true },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<SealedDaysPanel />)
    expect(screen.getByText('showing 1–1 of 250')).toBeDefined()
  })

  it('renders the empty state, not an empty table, when the manifest is empty', () => {
    mockedUseSealedDays.mockReturnValue({
      data: { historian: true, store: true, days: [], total: 0, truncated: false },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<SealedDaysPanel />)
    expect(screen.getByText('No sealed days.')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('paging calls the hook with the right offset', () => {
    mockedUseSealedDays.mockReturnValue({
      data: { historian: true, store: true, days: [row('2026-09-01')], total: 250, truncated: true },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<SealedDaysPanel />)
    fireEvent.click(screen.getByText('Next'))

    // The panel re-renders with the new offset threaded into the hook call.
    const lastCall = mockedUseSealedDays.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(100)
  })
})
