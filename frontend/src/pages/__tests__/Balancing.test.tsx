import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Balancing } from '../Balancing'

const MOCK_RESPONSE = {
  reference_rate: 0.0042,
  rooms: {
    lounge: {
      normalised_rate: 0.005,
      imbalance_ratio: 0.19,
      consecutive_imbalanced: 0,
      observations: 8,
      stability: 0.12,
      recommendation_pending: false,
      recommendation_text: '',
      recommendations_given: 0,
      balance_offset: 0,
      control_mode: 'direct',
      balance_status: 'automatic',
      notification_disabled: false,
    },
    bedroom: {
      normalised_rate: 0.004,
      imbalance_ratio: -0.05,
      consecutive_imbalanced: 0,
      observations: 6,
      stability: 0.15,
      recommendation_pending: true,
      recommendation_text: 'Bedroom is slightly under-heating. Try opening the lockshield valve by 1/4 turn.',
      recommendations_given: 1,
      balance_offset: 0,
      control_mode: 'indirect',
      balance_status: 'balanced',
      notification_disabled: false,
    },
  },
  imbalanced_count: 0,
  total_observations: 14,
}

describe('Balancing page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with mock data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    const heading = await screen.findByText('Balancing')
    expect(heading).toBeInTheDocument()

    // Room names rendered
    expect(await screen.findByText('Lounge')).toBeInTheDocument()
    expect(await screen.findByText('Bedroom')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<Balancing />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fail'))
    render(<Balancing />)
    const err = await screen.findByText(/error/i)
    expect(err).toBeInTheDocument()
  })

  it('shows pending recommendations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    const recs = await screen.findAllByText(/lockshield valve/i)
    expect(recs.length).toBeGreaterThan(0)
  })

  it('direct zones show auto instead of toggle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    const autoLabel = await screen.findByText('auto')
    expect(autoLabel).toBeInTheDocument()
  })

  it('toggle fires PATCH', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ room: 'bedroom', notification_disabled: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      } as Response)

    render(<Balancing />)

    // Wait for page to render
    await screen.findByText('Bedroom')

    // Find and click the toggle button (the one that's not 'auto' text)
    const toggles = screen.getAllByRole('button').filter(
      (btn) => btn.title === 'Notifications enabled' || btn.title === 'Notifications disabled'
    )
    expect(toggles.length).toBeGreaterThan(0)

    fireEvent.click(toggles[0])

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (call) => (call[1] as RequestInit)?.method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
    })
  })
})
