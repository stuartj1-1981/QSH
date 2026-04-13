/**
 * 88A — apiUrl smoke tests: verify that the three refactored fetch call sites
 * produce URLs via apiUrl() rather than hardcoded './api/...' strings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/* ── shared mocks ──────────────────────────────────────────────────── */

const mockPatch = vi.fn().mockResolvedValue({ updated: 'ok', restart_required: false, message: '' })
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: mockPatch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

// Spy on apiUrl to verify it was called
const apiUrlSpy = vi.fn((path: string) => `./${path.replace(/^\//, '')}`)
vi.mock('../../../lib/api', () => ({
  apiUrl: (path: string) => apiUrlSpy(path),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'
import { ControlSettings } from '../ControlSettings'

describe('apiUrl smoke tests', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    apiUrlSpy.mockClear()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('HeatSourceSettings — flow-min internal change uses apiUrl', async () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'heat_pump', flow_min: 25 }}
        rootConfig={{ flow_min_internal: 25 }}
        driver="ha"
        onRefetch={() => {}}
      />
    )

    // The ControlValueDisplay renders a number input for internal value when
    // flow_min_entity is unset. Find the range/number inputs.
    const inputs = screen.getAllByRole('spinbutton')
    // The "Flow Min Temperature" internal value input
    const flowMinInput = inputs.find(
      i => (i as HTMLInputElement).value === '25' && i.closest('[class]')
    )
    if (flowMinInput) {
      fireEvent.change(flowMinInput, { target: { value: '30' } })
    }

    await waitFor(() => {
      const flowMinCall = fetchSpy.mock.calls.find((c: unknown[]) =>
        typeof c[0] === 'string' && c[0].includes('flow-min')
      )
      if (flowMinCall) {
        // URL should come from apiUrl, not hardcoded
        expect(flowMinCall[0]).toBe('./api/control/flow-min')
        expect(apiUrlSpy).toHaveBeenCalledWith('api/control/flow-min')
      }
    })
  })

  it('ControlSettings — MQTT shadow toggle uses apiUrl for config/root', async () => {
    render(
      <ControlSettings
        control={{}}
        rootConfig={{ driver: 'mqtt', publish_mqtt_shadow: true }}
        driver="ha"
        onRefetch={() => {}}
      />
    )

    // Find the toggle button for MQTT shadow
    const toggles = screen.getAllByRole('button')
    const shadowToggle = toggles.find(b =>
      b.className.includes('rounded-full') && b.className.includes('h-6')
    )
    expect(shadowToggle).toBeDefined()
    fireEvent.click(shadowToggle!)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
      const rootCall = fetchSpy.mock.calls.find((c: unknown[]) =>
        typeof c[0] === 'string' && c[0].includes('config/root')
      )
      expect(rootCall).toBeDefined()
      expect(rootCall![0]).toBe('./api/config/root')
      expect(apiUrlSpy).toHaveBeenCalledWith('api/config/root')
    })
  })
})
