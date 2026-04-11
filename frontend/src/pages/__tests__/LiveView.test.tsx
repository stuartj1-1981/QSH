import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveView } from '../LiveView'

// Mock the engine — avoid Canvas 2D context issues in jsdom
vi.mock('../../lib/liveViewEngine', () => {
  return {
    LiveViewEngine: class {
      start = vi.fn()
      stop = vi.fn()
      setData = vi.fn()
      setDark = vi.fn()
      resize = vi.fn()
      destroy = vi.fn()
    },
  }
})

// Mock useLiveViewData — control return values per test
const mockUseLiveViewData = vi.fn()
vi.mock('../../hooks/useLiveViewData', () => ({
  useLiveViewData: () => mockUseLiveViewData(),
}))

describe('LiveView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockUseLiveViewData.mockReset()
  })

  it('renders canvas element with role="img" and aria-label', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    const canvas = document.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.getAttribute('role')).toBe('img')
    expect(canvas!.getAttribute('aria-label')).toContain('Live system topology')
  })

  it('renders without crashing when useLiveViewData returns null', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: false })
    expect(() => render(<LiveView />)).not.toThrow()
  })

  it('shows connecting overlay when isConnected is false', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: false })
    render(<LiveView />)
    expect(screen.getByText('Connecting...')).toBeInTheDocument()
  })

  it('hides connecting overlay when isConnected is true', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument()
  })

  it('renders sr-only state summary when data is present', () => {
    mockUseLiveViewData.mockReturnValue({
      data: {
        rooms: [{ id: 'lounge', name: 'lounge', temp: 20, target: 21, valve: 50, area: 15, u: 0.15, status: 'ok' }],
        hp: { power_kw: 4.2, capacity_kw: 8, cop: 3.5, flow_temp: 35, return_temp: 30, outdoor_temp: 5 },
        state: { season: 'winter', strategy: 'heating', hwState: null, cyclePause: null, label: 'Winter (Heating)' },
        source: { type: 'heat_pump', name: 'heat_pump', isMultiSource: false },
        dhw: { hwPlan: 'W', hasCylinder: true },
      },
      isConnected: true,
    })
    render(<LiveView />)
    const srText = screen.getByText(/System state: Winter \(Heating\)/)
    expect(srText).toBeInTheDocument()
    expect(srText.textContent).toContain('1 rooms')
    expect(srText.textContent).toContain('4.2 kW')
  })

  it('renders sr-only "Waiting for system data" when data is null', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    expect(screen.getByText('Waiting for system data.')).toBeInTheDocument()
  })
})
