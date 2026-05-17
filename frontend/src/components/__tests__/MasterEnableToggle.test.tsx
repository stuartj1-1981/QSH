import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MasterEnableToggle } from '../forecast/MasterEnableToggle'

describe('MasterEnableToggle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders ON state when value=true', () => {
    render(<MasterEnableToggle value={true} />)
    expect(screen.getByRole('button')).toHaveTextContent('ON')
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders OFF state when value=false', () => {
    render(<MasterEnableToggle value={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('OFF')
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('click triggers POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, json: async () => ({}),
    } as Response)
    const onChange = vi.fn()
    render(<MasterEnableToggle value={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST')
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/control\/forecast-master-enable$/)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('renders error state as alert on POST failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({}),
    } as Response)
    render(<MasterEnableToggle value={false} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('renders new beta-ready header copy', () => {
    render(<MasterEnableToggle value={true} />)
    // INSTRUCTION-243 Task 2: twin-element pattern — one mobile-only
    // (sm:hidden) heading and one desktop-only (hidden sm:block) heading
    // both render "Enable Forecast"; CSS hides one per viewport.
    expect(screen.getAllByText('Enable Forecast').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Master Enable/)).toBeNull()
    expect(screen.queryByText(/Forecast Extension/)).toBeNull()
  })

  it('strapline copy does not reference internal jargon', () => {
    render(<MasterEnableToggle value={true} />)
    expect(screen.queryByText(/consenting controllers/)).toBeNull()
    expect(screen.queryByText(/legacy QSH/)).toBeNull()
  })
})
