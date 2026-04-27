import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { StepReview } from '../StepReview'
import { renderHook } from '@testing-library/react'
import { useWizard } from '../../../hooks/useWizard'

// Minimum config that makes StepReview render without runtime errors.
const baseConfig = {
  driver: 'ha' as const,
  rooms: { living_room: { area_m2: 25.0 } },
  heat_source: { type: 'heat_pump' as const },
}

describe('StepReview destructive deploy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders amber destructive banner with removed sections and Force Deploy button when onDeploy returns destructive error', async () => {
    const onDeploy = vi.fn().mockResolvedValue({
      kind: 'destructive',
      removed_sections: ['energy', 'mqtt', 'historian'],
      existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt', 'historian'],
      incoming_sections: ['rooms', 'heat_source'],
    })
    const onForceDeploy = vi.fn()

    render(
      <StepReview
        config={baseConfig}
        validationWarnings={[]}
        isDeploying={false}
        onDeploy={onDeploy}
        onForceDeploy={onForceDeploy}
      />
    )

    fireEvent.click(screen.getByText('Deploy Configuration'))

    await waitFor(() => {
      expect(screen.getByText('Destructive deploy refused')).toBeDefined()
    })
    expect(screen.getByRole('alert').textContent).toMatch(/energy, mqtt, historian/)
    expect(screen.getByText('Force Deploy')).toBeDefined()
  })

  it('Force Deploy button calls onForceDeploy and surfaces the success path', async () => {
    const onDeploy = vi.fn().mockResolvedValue({
      kind: 'destructive',
      removed_sections: ['energy'],
      existing_sections: ['rooms', 'heat_source', 'energy'],
      incoming_sections: ['rooms', 'heat_source'],
    })
    const onForceDeploy = vi.fn().mockResolvedValue({
      deployed: true,
      yaml_path: '/config/qsh.yaml',
      message: 'Configuration saved.',
      warnings: [],
    })

    render(
      <StepReview
        config={baseConfig}
        validationWarnings={[]}
        isDeploying={false}
        onDeploy={onDeploy}
        onForceDeploy={onForceDeploy}
      />
    )

    fireEvent.click(screen.getByText('Deploy Configuration'))
    await waitFor(() => {
      expect(screen.getByText('Force Deploy')).toBeDefined()
    })

    fireEvent.click(screen.getByText('Force Deploy'))
    await waitFor(() => {
      expect(onForceDeploy).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(screen.getByText('Configuration Deployed!')).toBeDefined()
    })
  })
})

describe('useWizard.deploy 409 handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('translates a 409 destructive response into a kind:destructive object', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 409,
      json: () =>
        Promise.resolve({
          detail: {
            message: 'Refusing destructive deploy',
            removed_sections: ['energy', 'mqtt'],
            existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt'],
            incoming_sections: ['rooms', 'heat_source'],
          },
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    let deployResult: unknown
    await act(async () => {
      deployResult = await result.current.deploy()
    })

    expect(deployResult).toEqual({
      kind: 'destructive',
      removed_sections: ['energy', 'mqtt'],
      existing_sections: ['rooms', 'heat_source', 'energy', 'mqtt'],
      incoming_sections: ['rooms', 'heat_source'],
    })

    // The POST body is config + force=false on the regular deploy.
    const fetchCall = mockFetch.mock.calls[0]
    const body = JSON.parse(fetchCall[1].body as string)
    expect(body.force).toBe(false)
  })

  it('forceDeploy posts force=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          deployed: true,
          yaml_path: '/config/qsh.yaml',
          message: 'ok',
          warnings: [],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() => useWizard())
    await act(async () => {
      await result.current.forceDeploy()
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.force).toBe(true)
  })
})
