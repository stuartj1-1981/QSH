import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Statistics } from '../Statistics'

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
}))

vi.mock('../../hooks/useStatistics', () => ({
  useStatistics: vi.fn(),
}))

import { useStatistics } from '../../hooks/useStatistics'

const mockUseStatistics = useStatistics as ReturnType<typeof vi.fn>

describe('Statistics page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders not-configured message when historian unavailable', () => {
    mockUseStatistics.mockReturnValue({
      available: false,
      loading: false,
      error: null,
      kpis: null,
      trendData: [],
      refetch: vi.fn(),
    })

    render(<Statistics />)
    expect(screen.getByText(/not configured/i)).toBeInTheDocument()
  })

  it('renders KPI card values', () => {
    mockUseStatistics.mockReturnValue({
      available: true,
      loading: false,
      error: null,
      kpis: {
        totalEnergy_kWh: 42.5,
        totalCost_pence: 1275,
        avgCop: 3.14,
        peakPower_kW: 6.78,
      },
      trendData: [{ t: 1000, cop: 3.0, hp_power_kw: 2.0, tariff_rate: 0.30 }],
      refetch: vi.fn(),
    })

    render(<Statistics />)
    expect(screen.getByText('42.5')).toBeInTheDocument()
    expect(screen.getByText('1275')).toBeInTheDocument()
    expect(screen.getByText('3.14')).toBeInTheDocument()
    expect(screen.getByText('6.78')).toBeInTheDocument()
  })

  it('renders "--" when KPIs are null', () => {
    mockUseStatistics.mockReturnValue({
      available: true,
      loading: false,
      error: null,
      kpis: null,
      trendData: [],
      refetch: vi.fn(),
    })

    render(<Statistics />)
    const dashes = screen.getAllByText('--')
    expect(dashes.length).toBe(4)
  })

  it('renders time range presets', () => {
    mockUseStatistics.mockReturnValue({
      available: true,
      loading: false,
      error: null,
      kpis: null,
      trendData: [],
      refetch: vi.fn(),
    })

    render(<Statistics />)
    expect(screen.getByText('Last 24h')).toBeInTheDocument()
    expect(screen.getByText('Last 7d')).toBeInTheDocument()
    expect(screen.getByText('Last 30d')).toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('renders error banner', () => {
    mockUseStatistics.mockReturnValue({
      available: true,
      loading: false,
      error: 'Connection timeout',
      kpis: null,
      trendData: [],
      refetch: vi.fn(),
    })

    render(<Statistics />)
    expect(screen.getByText('Connection timeout')).toBeInTheDocument()
  })

  it('does not crash on empty trendData', () => {
    mockUseStatistics.mockReturnValue({
      available: true,
      loading: false,
      error: null,
      kpis: null,
      trendData: [],
      refetch: vi.fn(),
    })

    render(<Statistics />)
    expect(screen.getByText('No data for selected time range.')).toBeInTheDocument()
  })
})
