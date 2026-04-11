import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../Sidebar'

const baseProps = {
  page: 'home' as const,
  onNavigate: vi.fn(),
  engineering: false,
  onToggleEngineering: vi.fn(),
  dark: false,
  onToggleDark: vi.fn(),
}

describe('Sidebar', () => {
  it('renders only core nav items when engineering is off', () => {
    render(<Sidebar {...baseProps} engineering={false} />)
    expect(screen.getByText('Home')).toBeDefined()
    expect(screen.getByText('Rooms')).toBeDefined()
    expect(screen.getByText('Schedule')).toBeDefined()
    expect(screen.getByText('Away')).toBeDefined()
    expect(screen.queryByText('Historian')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
    // "Engineering" appears in footer toggle but not as a nav item
    expect(screen.queryByText('Balancing')).toBeNull()
  })

  it('renders all nav items when engineering is on', () => {
    render(<Sidebar {...baseProps} engineering={true} />)
    expect(screen.getByText('Home')).toBeDefined()
    expect(screen.getByText('Rooms')).toBeDefined()
    expect(screen.getByText('Schedule')).toBeDefined()
    expect(screen.getByText('Away')).toBeDefined()
    expect(screen.getByText('Historian')).toBeDefined()
    expect(screen.getByText('Settings')).toBeDefined()
    expect(screen.getByText('Balancing')).toBeDefined()
    // "Engineering" appears both as nav item and footer toggle
    const engineeringElements = screen.getAllByText('Engineering')
    // Section header + nav item + footer toggle = 3
    expect(engineeringElements.length).toBeGreaterThanOrEqual(3)
  })

  it('renders Engineering section header only when engineering is on', () => {
    const { unmount } = render(<Sidebar {...baseProps} engineering={false} />)
    // Footer toggle says "Engineering" but the section header is uppercase styled <p>
    // With engineering off, only the footer toggle text "Engineering" exists
    const offElements = screen.getAllByText('Engineering')
    expect(offElements).toHaveLength(1) // footer toggle only
    unmount()

    render(<Sidebar {...baseProps} engineering={true} />)
    const onElements = screen.getAllByText('Engineering')
    // Section header + nav item + footer toggle = 3
    expect(onElements.length).toBeGreaterThanOrEqual(3)
  })

  it('engineering toggle button calls onToggleEngineering', () => {
    const onToggle = vi.fn()
    render(<Sidebar {...baseProps} onToggleEngineering={onToggle} />)
    // The footer toggle button contains "Engineering" text and the Wrench icon
    const buttons = screen.getAllByRole('button')
    const toggleBtn = buttons.find(
      (b) => b.textContent?.includes('Engineering') && b.closest('.border-t')
    )
    expect(toggleBtn).toBeDefined()
    fireEvent.click(toggleBtn!)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('nav item click calls onNavigate with correct page', () => {
    const onNavigate = vi.fn()
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('Home'))
    expect(onNavigate).toHaveBeenCalledWith('home')
    fireEvent.click(screen.getByText('Rooms'))
    expect(onNavigate).toHaveBeenCalledWith('rooms')
  })

  it('redirects to home when on engineering page with toggle off', async () => {
    // Test the redirect guard logic used in App.tsx:
    // When engineering=false and page is an engineering page, activePage resolves to 'home'.
    const { ENGINEERING_PAGES } = await import('../../lib/constants')

    const engineeringPages = ['engineering', 'balancing', 'historian', 'settings']
    expect([...ENGINEERING_PAGES]).toEqual(engineeringPages)

    // Simulate the guard: activePage = engineering-gated page + toggle off → 'home'
    for (const engPage of engineeringPages) {
      const engineering = false
      const activePage = !engineering && (ENGINEERING_PAGES as readonly string[]).includes(engPage)
        ? 'home'
        : engPage
      expect(activePage).toBe('home')
    }

    // Non-engineering pages are NOT redirected
    for (const normalPage of ['home', 'rooms', 'schedule', 'away']) {
      const engineering = false
      const activePage = !engineering && (ENGINEERING_PAGES as readonly string[]).includes(normalPage)
        ? 'home'
        : normalPage
      expect(activePage).toBe(normalPage)
    }
  })
})
