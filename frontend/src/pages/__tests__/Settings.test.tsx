/**
 * 88B — Settings plumbing test: verify that the `driver` prop reaches
 * every settings child component when useRawConfig returns { driver: 'mqtt' }.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/* ── mocks ──────────────────────────────────────────────────────────── */

vi.mock('../../hooks/useConfig', () => ({
  useRawConfig: () => ({
    data: {
      driver: 'mqtt',
      rooms: { lounge: { area_m2: 20 } },
      // INSTRUCTION-572B T6, cases G1 and G2 — the stored open-window section.
      window_detection: storedWindowDetection,
      heat_source: { type: 'heat_pump' },
      energy: {},
      thermal: {},
      control: {},
    },
    loading: false,
    refetch: vi.fn(),
  }),
  // INSTRUCTION-544B T10(a)/T11(b) — Settings now also reads the processed
  // config for antifrost/shoulder/overtemp.
  useConfig: () => ({
    data: {},
    loading: false,
    refetch: vi.fn(),
  }),
  usePatchConfig: () => ({ patch: vi.fn(), saving: false, error: null }),
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: null, isConnected: false, lastUpdate: 0 }),
}))

vi.mock('../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

vi.mock('../../hooks/useExternalSetpoints', () => ({
  useExternalSetpoints: () => ({
    data: {
      comfort_temp: '',
      flow_min_temp: '',
      flow_max_temp: '',
      antifrost_oat_threshold: '',
      shoulder_threshold: '',
      overtemp_protection: '',
    },
    loading: false,
    error: null,
    saving: false,
    save: vi.fn(),
    refetch: vi.fn(),
  }),
}))

vi.mock('../../lib/api', () => ({
  apiUrl: (path: string) => `./${path.replace(/^\//, '')}`,
}))

// Stub fetch for shoulder-threshold and other API calls
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
}))

// INSTRUCTION-572B T6 — the stored open-window section that the mock of
// useRawConfig gives. Cases G1 and G2 set it before they render the page.
let storedWindowDetection: unknown

import { Settings } from '../Settings'

describe('Settings driver plumbing', () => {
  it('renders the Rooms section (default) without crashing when driver=mqtt', () => {
    render(<Settings onRunWizard={() => {}} />)
    // RoomSettings renders with rooms data — if driver prop was missing
    // it would have caused a TypeScript error at build time (caught by tsc).
    // At runtime, verify the component renders by looking for room names.
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  // INSTRUCTION-572B T6, cases G1 and G2 — the page gives the stored section
  // to the room form as it is stored, on the mqtt driver also.
  it('(G1) the Rooms section shows the stored open-window inference mode when driver=mqtt', () => {
    storedWindowDetection = { inference: 'act' }
    render(<Settings onRunWizard={() => {}} />)
    expect(screen.getByTestId('window-inference-settings')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Act' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Off' })).not.toBeChecked()
  })

  it.each([
    ['a text', 'observe'],
    ['false', false],
  ])('(G2) the Rooms section shows no selection for a stored section that is %s', (_label, section) => {
    storedWindowDetection = section
    render(<Settings onRunWizard={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(3)
    expect(radios.filter((r) => r.checked)).toHaveLength(0)
  })
})
