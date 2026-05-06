import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ReconnectingOverlay } from '../ReconnectingOverlay'

describe('ReconnectingOverlay', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders nothing when disconnectedSince is null', () => {
    const { container } = render(<ReconnectingOverlay disconnectedSince={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing during the 3 s grace period', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const { container } = render(<ReconnectingOverlay disconnectedSince={now} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "Reconnecting" copy after the grace period elapses', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    render(<ReconnectingOverlay disconnectedSince={now} />)
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
    expect(screen.queryByText('Restart in progress')).toBeNull()
  })

  it('escalates to "Restart in progress" after 10 s', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    render(<ReconnectingOverlay disconnectedSince={now} />)
    act(() => { vi.advanceTimersByTime(10500) })
    expect(screen.getByText('Restart in progress')).toBeInTheDocument()
  })

  it('disappears immediately when disconnectedSince is cleared', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const { rerender, container } = render(<ReconnectingOverlay disconnectedSince={now} />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
    rerender(<ReconnectingOverlay disconnectedSince={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('uses role=status with aria-live=polite for accessibility', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    render(<ReconnectingOverlay disconnectedSince={now} />)
    act(() => { vi.advanceTimersByTime(3500) })
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})
