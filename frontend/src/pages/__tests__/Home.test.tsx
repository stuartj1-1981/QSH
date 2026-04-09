import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Home } from '../Home'

// Mock all the hooks used by Home
vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: null, isConnected: false }),
}))

let mockStatusData: Record<string, unknown> | null = null
vi.mock('../../hooks/useStatus', () => ({
  useStatus: () => ({ data: mockStatusData, error: null }),
}))

vi.mock('../../hooks/useHistory', () => ({
  useHistory: () => ({ data: [] }),
}))

vi.mock('../../hooks/useAway', () => ({
  useAwayState: () => ({ data: null, refetch: vi.fn() }),
  useSetAway: () => ({ setAway: vi.fn() }),
}))

vi.mock('../../hooks/useSourceSelection', () => ({
  useSourceSelection: () => ({ data: null, setMode: vi.fn(), setPreference: vi.fn() }),
}))

// Mock recharts
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
}))

describe('Home migration banner', () => {
  afterEach(() => {
    mockStatusData = null
  })

  it('banner shown when migration_pending is true', () => {
    mockStatusData = { migration_pending: true }
    render(<Home engineering={false} />)
    expect(screen.getByText(/Fleet data sharing and beta disclaimer/)).toBeInTheDocument()
  })

  it('banner not shown when migration_pending is false', () => {
    mockStatusData = { migration_pending: false }
    render(<Home engineering={false} />)
    expect(screen.queryByText(/Fleet data sharing and beta disclaimer/)).toBeNull()
  })

  it('banner not shown when migration_pending is absent', () => {
    mockStatusData = {}
    render(<Home engineering={false} />)
    expect(screen.queryByText(/Fleet data sharing and beta disclaimer/)).toBeNull()
  })

  it('Go to Settings link calls onNavigate("settings")', () => {
    mockStatusData = { migration_pending: true }
    const onNavigate = vi.fn()
    render(<Home engineering={false} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('Go to Settings →'))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })
})
