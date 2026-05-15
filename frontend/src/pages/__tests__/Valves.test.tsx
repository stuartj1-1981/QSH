import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Valves } from '../Valves'
import type { ManualEntry } from '../../types/api'

const mockUseManual = vi.fn()
vi.mock('../../hooks/useManual', () => ({
  useManual: () => mockUseManual(),
}))

const mockUseLive = vi.fn()
vi.mock('../../hooks/useLive', () => ({
  useLive: () => mockUseLive(),
}))

const AUTO_ENTRY: ManualEntry = {
  room: 'lounge',
  mode: 'AUTO',
  position_pct: null,
  set_by: 'startup_default',
  set_at: 0,
  hardware_type: 'direct_type1',
}

const MANUAL_ENTRY: ManualEntry = {
  room: 'lounge',
  mode: 'MANUAL',
  position_pct: 65,
  set_by: 'engineering_ui',
  set_at: 1715600000,
  hardware_type: 'direct_type1',
}

function _liveData(controlEnabled: boolean, rooms: Record<string, number>) {
  return {
    data: {
      type: 'cycle' as const,
      status: { control_enabled: controlEnabled },
      rooms: Object.fromEntries(
        Object.entries(rooms).map(([r, v]) => [r, { valve: v }]),
      ),
    },
    isConnected: true,
    lastUpdate: 0,
    disconnectedSince: null,
  }
}

describe('Valves page', () => {
  let setManual: ReturnType<typeof vi.fn>
  let setAuto: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setManual = vi.fn().mockResolvedValue(undefined)
    setAuto = vi.fn().mockResolvedValue(undefined)
    mockUseLive.mockReturnValue(_liveData(true, { lounge: 42 }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crash with empty entries', () => {
    mockUseManual.mockReturnValue({
      entries: [], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    expect(screen.getByText('Valves')).toBeInTheDocument()
    expect(screen.getByText(/No direct TRVs configured/i)).toBeInTheDocument()
  })

  it('renders one card per entry', () => {
    const e2: ManualEntry = { ...AUTO_ENTRY, room: 'bed1', hardware_type: 'direct_type2' }
    mockUseManual.mockReturnValue({
      entries: [AUTO_ENTRY, e2], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    mockUseLive.mockReturnValue(_liveData(true, { lounge: 42, bed1: 15 }))
    render(<Valves />)
    expect(screen.getByTestId('valve-card-lounge')).toBeInTheDocument()
    expect(screen.getByTestId('valve-card-bed1')).toBeInTheDocument()
  })

  it('AUTO pill is active by default', () => {
    mockUseManual.mockReturnValue({
      entries: [AUTO_ENTRY], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    const auto = screen.getByRole('button', { name: 'AUTO' })
    const man = screen.getByRole('button', { name: 'MAN' })
    expect(auto).toHaveAttribute('aria-pressed', 'true')
    expect(man).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking MAN pill shows slider', async () => {
    mockUseManual.mockReturnValue({
      entries: [MANUAL_ENTRY], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    expect(screen.getByTestId('valve-card-lounge-manual-controls')).toBeInTheDocument()
    expect(screen.getByLabelText('Manual position percent')).toBeInTheDocument()
  })

  it('Apply button calls setManual', async () => {
    mockUseManual.mockReturnValue({
      entries: [MANUAL_ENTRY], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    const apply = screen.getByRole('button', { name: 'Apply' })
    fireEvent.click(apply)
    await waitFor(() => {
      expect(setManual).toHaveBeenCalledWith('lounge', 65)
    })
  })

  it('Return AUTO button calls setAuto', async () => {
    mockUseManual.mockReturnValue({
      entries: [MANUAL_ENTRY], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    const ret = screen.getByRole('button', { name: 'Return AUTO' })
    fireEvent.click(ret)
    await waitFor(() => {
      expect(setAuto).toHaveBeenCalledWith('lounge')
    })
  })

  it('banner renders amber when shadow and manual are active', () => {
    mockUseLive.mockReturnValue(_liveData(false, { lounge: 42 }))
    mockUseManual.mockReturnValue({
      entries: [MANUAL_ENTRY], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    const banner = screen.getByTestId('valves-banner')
    expect(banner.className).toMatch(/amber/)
    expect(banner.textContent).toMatch(/Shadow mode is ON/i)
  })

  it('slider defaults to live position when toggling to MANUAL', async () => {
    // Start in AUTO. Live position is 42. Click MAN.
    mockUseManual.mockReturnValue({
      entries: [AUTO_ENTRY], loading: false, error: null,
      refresh: vi.fn(), setManual, setAuto,
    })
    render(<Valves />)
    const man = screen.getByRole('button', { name: 'MAN' })
    fireEvent.click(man)
    // setManual called with the live position (42, rounded).
    await waitFor(() => {
      expect(setManual).toHaveBeenCalledWith('lounge', 42)
    })
  })
})
