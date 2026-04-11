import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComfortScheduleEditor } from '../ComfortScheduleEditor'

const mockSchedule = {
  enabled: true,
  periods: [
    { from: '07:00', to: '22:00', temp: 20.0 },
    { from: '22:00', to: '07:00', temp: 17.0 },
  ],
  active_temp: 20.0,
}

const emptySchedule = {
  enabled: false,
  periods: [],
  active_temp: null,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ComfortScheduleEditor', () => {
  it('renders loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<ComfortScheduleEditor />)
    // Should show skeleton, not the editor
    expect(screen.queryByText('Comfort Schedule')).toBeNull()
  })

  it('fetches from correct API endpoint on mount', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSchedule,
    } as Response)

    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Comfort Schedule')).toBeDefined()
    })
    const getCall = fetchSpy.mock.calls[0]
    expect(getCall[0]).toContain('api/comfort-schedule')
  })

  it('renders schedule data after fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSchedule,
    } as Response)

    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Comfort Schedule')).toBeDefined()
    })
    expect(screen.getByText(/Active: 20.0°C/)).toBeDefined()
    // Both '07:00' and '22:00' appear twice (shared between period boundaries)
    expect(screen.getAllByDisplayValue('07:00').length).toBe(2)
    expect(screen.getAllByDisplayValue('22:00').length).toBe(2)
  })

  it('renders empty state when no periods', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => emptySchedule,
    } as Response)

    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Comfort Schedule')).toBeDefined()
    })
    expect(screen.getByText(/No periods defined/)).toBeDefined()
  })

  it('calls PATCH immediately on toggle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => emptySchedule,
    } as Response)

    const user = userEvent.setup()
    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Comfort Schedule')).toBeDefined()
    })

    await user.click(screen.getByRole('switch'))

    const patchCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'PATCH'
    )
    expect(patchCall).toBeDefined()
    expect(patchCall![0]).toContain('api/comfort-schedule/enabled')
  })

  it('reverts toggle on PATCH failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => emptySchedule,
    } as Response)

    const user = userEvent.setup()
    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Off')).toBeDefined()
    })

    fetchSpy.mockRejectedValueOnce(new Error('Network error'))

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(screen.getByText('Off')).toBeDefined()
    })
  })

  it('shows Save button after adding a period (not after toggle)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => emptySchedule,
    } as Response)

    const user = userEvent.setup()
    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Add period')).toBeDefined()
    })

    await user.click(screen.getByText('Add period'))

    expect(screen.getByText('Save Schedule')).toBeDefined()
  })

  it('calls PUT on save with correct method', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => mockSchedule,
    } as Response)

    const user = userEvent.setup()
    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Comfort Schedule')).toBeDefined()
    })

    const deleteButtons = screen.getAllByLabelText('Delete period')
    await user.click(deleteButtons[0])
    await user.click(screen.getByText('Save Schedule'))

    const putCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'PUT'
    )
    expect(putCall).toBeDefined()
    expect(putCall![0]).toContain('api/comfort-schedule')
  })

  it('removes period when delete button clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ...emptySchedule,
        periods: [{ from: '07:00', to: '22:00', temp: 20.0 }],
      }),
    } as Response)

    const user = userEvent.setup()
    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('07:00')).toBeDefined()
    })

    await user.click(screen.getByLabelText('Delete period'))

    expect(screen.queryByDisplayValue('07:00')).toBeNull()
    expect(screen.getByText(/No periods defined/)).toBeDefined()
  })

  it('hides Add button at MAX_PERIODS', async () => {
    const fullSchedule = {
      enabled: true,
      periods: Array.from({ length: 8 }, (_, i) => ({
        from: `${String(i * 3).padStart(2, '0')}:00`,
        to: `${String(i * 3 + 2).padStart(2, '0')}:59`,
        temp: 20.0,
      })),
      active_temp: 20.0,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => fullSchedule,
    } as Response)

    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText(/Maximum 8 periods/)).toBeDefined()
    })

    expect(screen.queryByText('Add period')).toBeNull()
  })

  it('has accessible toggle with aria-label', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => emptySchedule,
    } as Response)

    render(<ComfortScheduleEditor />)

    await waitFor(() => {
      expect(screen.getByText('Comfort Schedule')).toBeDefined()
    })

    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-label')).toBe('Enable comfort schedule')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
