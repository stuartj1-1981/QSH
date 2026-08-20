/**
 * INSTRUCTION-478B — RoomDetail predictive-occupancy surface: the per-zone
 * block (sensor class, licensed state, outcome counters, next window, enable
 * toggle) and the `occupancy_source === 'predicted'` badge override.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomDetail } from '../RoomDetail'
import type { RoomState } from '../../types/api'

const baseRoom: RoomState = {
  temp: 20.0,
  target: 21.0,
  valve: 50,
  occupancy: 'occupied',
  status: 'heating',
  facing: 0.5,
  area_m2: 20,
  ceiling_m: 2.4,
}

const noop = () => {}

const REPORT_WITH_LOUNGE = {
  rooms: {
    lounge: {
      predictive_enabled: true,
      sensor_class: 'motion' as const,
      licensed: true,
      counters: {
        pred_obs_total: 100,
        pred_obs_skipped_away: 5,
        pred_obs_skipped_fallback: 0,
        pred_obs_skipped_partial: 2,
        pred_slots_mature: 40,
        pred_windows_licensed: 3,
        hits: 2,
        false_preheats: 1,
        missed_arrivals: 0,
      },
      next_window: { start_ts: 1735689600, end_ts: 1735693200, confidence: 0.82 },
      active_hold: false,
    },
  },
  gate_stats: {
    pred_obs_total: 100,
    pred_obs_skipped_away: 5,
    pred_obs_skipped_fallback: 0,
    pred_obs_skipped_partial: 2,
    pred_slots_mature: 40,
    pred_windows_licensed: 3,
    hits: 2,
    false_preheats: 1,
    missed_arrivals: 0,
  },
}

const RAW_CONFIG = {
  rooms: {
    lounge: { area_m2: 20, predictive_occupancy: true, occupancy_class: 'motion' },
  },
}

const HISTORY_RESPONSE = { rooms: {} }

/**
 * RoomDetail composes useRoomHistory (api/history/rooms) alongside
 * usePredictive (api/predictive, api/config/raw, and PATCH api/config/rooms)
 * — several hooks fire fetch concurrently, so responses are routed by URL
 * rather than by call order (call order is an internal-hook-composition
 * detail, not a test-worthy contract).
 */
function mockFetchByUrl(routes: Record<string, unknown>) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return { ok: true, json: async () => body } as Response
      }
    }
    return { ok: true, json: async () => ({}) } as Response
  })
  return spy
}

describe('RoomDetail predictive occupancy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the predictive block with mock data', async () => {
    mockFetchByUrl({
      './api/predictive': REPORT_WITH_LOUNGE,
      './api/config/raw': RAW_CONFIG,
      './api/history/rooms': HISTORY_RESPONSE,
    })

    render(<RoomDetail name="lounge" room={baseRoom} engineering={false} onClose={noop} />)

    await waitFor(() => {
      expect(screen.getByTestId('predictive-block')).toBeInTheDocument()
    })
    expect(screen.getByText('motion')).toBeInTheDocument()
    expect(screen.getByText('yes')).toBeInTheDocument()
  })

  it('hides the block entirely when the room is absent from the report', async () => {
    mockFetchByUrl({
      './api/predictive': REPORT_WITH_LOUNGE,
      './api/config/raw': RAW_CONFIG,
      './api/history/rooms': HISTORY_RESPONSE,
    })

    render(<RoomDetail name="bedroom" room={baseRoom} engineering={false} onClose={noop} />)

    await waitFor(() => {
      expect(screen.queryByTestId('predictive-block')).toBeNull()
    })
  })

  it('hides the block without crashing on the unwired-backend shape', async () => {
    mockFetchByUrl({
      './api/predictive': { error: 'Predictive occupancy not yet initialised', rooms: {} },
      './api/config/raw': RAW_CONFIG,
      './api/history/rooms': HISTORY_RESPONSE,
    })

    render(<RoomDetail name="lounge" room={baseRoom} engineering={false} onClose={noop} />)

    await waitFor(() => {
      expect(screen.queryByTestId('predictive-block')).toBeNull()
    })
  })

  it('toggling the enable checkbox PATCHes the rooms config section', async () => {
    const user = userEvent.setup()
    const spy = mockFetchByUrl({
      './api/predictive': REPORT_WITH_LOUNGE,
      './api/config/raw': RAW_CONFIG,
      './api/history/rooms': HISTORY_RESPONSE,
      './api/config/rooms': { updated: 'rooms', restart_required: true, message: 'Restart required' },
    })

    render(<RoomDetail name="lounge" room={baseRoom} engineering={false} onClose={noop} />)

    await waitFor(() => {
      expect(screen.getByTestId('predictive-block')).toBeInTheDocument()
    })

    const toggle = screen.getByLabelText('Enable predictive occupancy')
    await user.click(toggle)

    await waitFor(() => {
      const patchCall = spy.mock.calls.find((c) => c[0] === './api/config/rooms')
      expect(patchCall).toBeDefined()
    })
    const patchCall = spy.mock.calls.find((c) => c[0] === './api/config/rooms')!
    const opts = patchCall[1] as RequestInit
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body as string)
    expect(body.data.lounge.predictive_occupancy).toBe(false)
  })

  it('renders the Clock icon and "Predicted (awaiting arrival)" label for occupancy_source === "predicted"', async () => {
    mockFetchByUrl({
      './api/predictive': REPORT_WITH_LOUNGE,
      './api/config/raw': RAW_CONFIG,
      './api/history/rooms': HISTORY_RESPONSE,
    })

    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'predicted' }}
        engineering={false}
        onClose={noop}
      />,
    )

    expect(screen.getByText('Predicted (awaiting arrival)')).toBeInTheDocument()
    expect(screen.queryByText('Occupied')).toBeNull()
  })
})
