import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeviceHealth } from '../DeviceHealth'

const MOCK_RESPONSE = {
  devices: {
    'sensor.living_trv_battery': { room: 'living', soc: 82, status: 'ok', weeks_remaining: '>12w' },
    'sensor.hall_trv_battery': { room: 'hall', soc: 14, status: 'low', weeks_remaining: '<4w' },
  },
  low_count: 1,
}

describe('DeviceHealth page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with mock data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<DeviceHealth />)

    expect(await screen.findByText('Device Health')).toBeInTheDocument()
    // Status badges map from the API status value (not recomputed).
    expect(await screen.findByText('OK')).toBeInTheDocument()
    expect(await screen.findByText('Low')).toBeInTheDocument()
    expect(screen.getByText('<4w')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<DeviceHealth />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows empty state when no devices configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ devices: {}, low_count: 0 }),
    } as Response)
    render(<DeviceHealth />)
    expect(await screen.findByText(/no battery devices configured/i)).toBeInTheDocument()
  })

  it('shows error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fail'))
    render(<DeviceHealth />)
    expect(await screen.findByText(/error/i)).toBeInTheDocument()
  })
})
