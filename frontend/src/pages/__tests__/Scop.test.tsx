import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Scop } from '../Scop'

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('../../hooks/useScop', () => ({
  useScop: vi.fn(),
}))

vi.mock('../../hooks/useHistorian', () => ({
  useHistorianQuery: vi.fn().mockReturnValue({
    data: { points: [] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

import { useScop } from '../../hooks/useScop'

const mockUseScop = useScop as ReturnType<typeof vi.fn>

const loadingState = { data: null, loading: true, error: null }

const availableState = (mode: 'combined' | 'ch' | 'hw', scop: number | null) => ({
  data: {
    available: true,
    window: '30d',
    mode,
    window_start: '-30d',
    window_end: 'now()',
    scop,
    thermal_kwh: scop !== null ? 100.0 : 0,
    electrical_kwh: scop !== null ? 30.0 : 0,
    data_quality: { deploy_date_in_window: false },
  },
  loading: false,
  error: null,
})

const unavailableState = (mode: 'combined' | 'ch' | 'hw') => ({
  data: {
    available: false,
    message: 'SCOP is HP-specific. Active source is not a heat pump.',
    window: '30d',
    mode,
  },
  loading: false,
  error: null,
})

describe('Scop page', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders without crashing when all three SCOPs are loading', () => {
    mockUseScop.mockReturnValue(loadingState)

    render(<Scop />)

    expect(
      screen.getByText('SCOP — Seasonal Coefficient of Performance'),
    ).toBeInTheDocument()
  })

  it('renders three cards when data is available', () => {
    mockUseScop.mockImplementation((_w: string, mode: 'combined' | 'ch' | 'hw') =>
      availableState(mode, 3.5),
    )

    render(<Scop />)

    expect(screen.getByText('Combined')).toBeInTheDocument()
    expect(screen.getByText('CH')).toBeInTheDocument()
    expect(screen.getByText('HW')).toBeInTheDocument()
    // Three cards each showing 3.50 (formatScop output for 3.5)
    const values = screen.getAllByText('3.50')
    expect(values).toHaveLength(3)
  })

  it('displays "—" for null SCOP values', () => {
    mockUseScop.mockImplementation((_w: string, mode: 'combined' | 'ch' | 'hw') =>
      availableState(mode, null),
    )

    render(<Scop />)

    const dashes = screen.getAllByText('—')
    // Three card values of "—".
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('displays neutral message when available=false on all three calls', () => {
    mockUseScop.mockImplementation((_w: string, mode: 'combined' | 'ch' | 'hw') =>
      unavailableState(mode),
    )

    render(<Scop />)

    expect(
      screen.getByText(/SCOP is HP-specific/i),
    ).toBeInTheDocument()
    // Cards should not be rendered.
    expect(screen.queryByText('Combined')).not.toBeInTheDocument()
  })

  it('window picker default is 30d', () => {
    mockUseScop.mockReturnValue(loadingState)

    render(<Scop />)

    // The hook is called with window=30d for each mode (3 calls).
    expect(mockUseScop).toHaveBeenCalledWith('30d', 'combined')
    expect(mockUseScop).toHaveBeenCalledWith('30d', 'ch')
    expect(mockUseScop).toHaveBeenCalledWith('30d', 'hw')
  })

  it('window picker change persists to localStorage and triggers re-fetch', () => {
    mockUseScop.mockReturnValue(loadingState)

    render(<Scop />)

    fireEvent.click(screen.getByText('7d'))

    expect(localStorage.getItem('qsh-scop-window')).toBe('7d')
    // After click, hook should be called with the new window for each mode.
    expect(mockUseScop).toHaveBeenCalledWith('7d', 'combined')
    expect(mockUseScop).toHaveBeenCalledWith('7d', 'ch')
    expect(mockUseScop).toHaveBeenCalledWith('7d', 'hw')
  })

  it('displays deploy-date banner when data_quality.deploy_date_in_window=true', () => {
    mockUseScop.mockImplementation((_w: string, mode: 'combined' | 'ch' | 'hw') => ({
      data: {
        available: true,
        window: '30d',
        mode,
        scop: 3.5,
        thermal_kwh: 100,
        electrical_kwh: 30,
        data_quality: { deploy_date_in_window: true },
      },
      loading: false,
      error: null,
    }))

    render(<Scop />)

    expect(
      screen.getByText(/spans the 191A deploy date/i),
    ).toBeInTheDocument()
  })

  it('does not display deploy-date banner when flag is false or absent', () => {
    mockUseScop.mockImplementation((_w: string, mode: 'combined' | 'ch' | 'hw') =>
      availableState(mode, 3.5),
    )

    render(<Scop />)

    expect(
      screen.queryByText(/spans the 191A deploy date/i),
    ).not.toBeInTheDocument()
  })

  it('restores window from localStorage on mount', () => {
    localStorage.setItem('qsh-scop-window', '90d')
    mockUseScop.mockReturnValue(loadingState)

    render(<Scop />)

    expect(mockUseScop).toHaveBeenCalledWith('90d', 'combined')
  })
})
