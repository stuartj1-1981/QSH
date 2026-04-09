import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWizard } from '../useWizard'

describe('useWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to HA branch with 12 steps', () => {
    const { result } = renderHook(() => useWizard())
    expect(result.current.totalSteps).toBe(12)
    expect(result.current.stepName).toBe('welcome')
  })

  it('HA branch step sequence skips MQTT Broker', () => {
    const { result } = renderHook(() => useWizard())
    expect(result.current.steps).not.toContain('mqtt_broker')
    expect(result.current.totalSteps).toBe(12)
  })

  it('MQTT branch includes MQTT Broker step with 13 steps', () => {
    // Mock validation endpoint
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [], warnings: [] }),
    } as Response)

    const { result } = renderHook(() => useWizard())

    // Set driver to mqtt
    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })

    expect(result.current.totalSteps).toBe(13)
    expect(result.current.steps).toContain('mqtt_broker')
  })

  it('connection method persists across navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [], warnings: [] }),
    } as Response)

    const { result } = renderHook(() => useWizard())

    // Set driver to mqtt
    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })

    // Navigate forward from welcome
    await act(async () => {
      await result.current.next()
    })

    expect(result.current.config.driver).toBe('mqtt')

    // Navigate back
    act(() => {
      result.current.back()
    })

    expect(result.current.config.driver).toBe('mqtt')
  })

  it('step labels match step count', () => {
    const { result } = renderHook(() => useWizard())
    expect(result.current.stepLabels).toHaveLength(result.current.totalSteps)
  })

  it('MQTT step labels include MQTT Broker', () => {
    const { result } = renderHook(() => useWizard())

    act(() => {
      result.current.updateConfig('driver', 'mqtt')
    })

    expect(result.current.stepLabels).toContain('MQTT Broker')
    expect(result.current.stepLabels).toHaveLength(13)
  })
})
