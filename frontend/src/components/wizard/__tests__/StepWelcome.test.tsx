import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepWelcome } from '../StepWelcome'

describe('StepWelcome', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('auto-hydrates state.config on mount when an existing config is detected', async () => {
    // Mount with existing config — fetch resolves a populated YAML. The
    // wizard must call onSetConfig with the response, AND highlight
    // "Edit Existing", in agreement with each other.
    const responseBody = {
      rooms: { living_room: { area_m2: 25.0 } },
      heat_source: { type: 'heat_pump' },
    }
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(responseBody),
    })
    vi.stubGlobal('fetch', mockFetch)

    const onSetConfig = vi.fn()
    render(<StepWelcome config={{}} onSetConfig={onSetConfig} />)

    await waitFor(() => {
      expect(onSetConfig).toHaveBeenCalledWith(responseBody)
    })
    expect(onSetConfig).toHaveBeenCalledTimes(1)

    // The "Edit Existing" tile is rendered (hasExisting=true).
    expect(screen.getByText('Edit Existing')).toBeDefined()
  })

  it('does not call onSetConfig and does not show the tile pair when no rooms exist', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({}),
    })
    vi.stubGlobal('fetch', mockFetch)

    const onSetConfig = vi.fn()
    render(<StepWelcome config={{}} onSetConfig={onSetConfig} />)

    // Wait until the fetch promise has settled.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    expect(onSetConfig).not.toHaveBeenCalled()
    expect(screen.queryByText('Edit Existing')).toBeNull()
    expect(screen.queryByText('Start Fresh')).toBeNull()
  })

  it('clicking Start Fresh after auto-hydrate clears state.config', async () => {
    const responseBody = {
      rooms: { living_room: { area_m2: 25.0 } },
    }
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(responseBody),
    })
    vi.stubGlobal('fetch', mockFetch)

    const onSetConfig = vi.fn()
    render(<StepWelcome config={{}} onSetConfig={onSetConfig} />)

    await waitFor(() => {
      expect(onSetConfig).toHaveBeenCalledWith(responseBody)
    })

    fireEvent.click(screen.getByText('Start Fresh'))

    // The most recent call clears the config.
    expect(onSetConfig).toHaveBeenLastCalledWith({})
  })

  it('does not crash and does not call onSetConfig on a network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', mockFetch)

    const onSetConfig = vi.fn()
    render(<StepWelcome config={{}} onSetConfig={onSetConfig} />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    expect(onSetConfig).not.toHaveBeenCalled()
    // The page itself still renders (the welcome heading is always present).
    expect(screen.getByText('Welcome to QSH Setup')).toBeDefined()
  })
})
