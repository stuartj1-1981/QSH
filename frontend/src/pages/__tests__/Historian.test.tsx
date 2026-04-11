import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Historian } from '../Historian'

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
}))

describe('Historian page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['outdoor_temp'] }],
        fields: ['outdoor_temp'],
        tags: { room: [] },
      }),
    } as Response)

    render(<Historian />)
    expect(screen.getByText('Historian')).toBeInTheDocument()
  })

  it('shows not-configured message when historian unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: false,
        message: 'Historian not configured.',
        measurements: [],
        fields: [],
        tags: {},
      }),
    } as Response)

    render(<Historian />)

    // Wait for the "not configured" message to appear
    const message = await screen.findByText(/not configured/i)
    expect(message).toBeInTheDocument()
  })

  it('renders measurement selector', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp'] },
          { name: 'qsh_room', fields: ['temperature'] },
        ],
        fields: ['outdoor_temp'],
        tags: { room: [] },
      }),
    } as Response)

    render(<Historian />)

    const label = await screen.findByText('Measurement')
    expect(label).toBeInTheDocument()
  })
})
