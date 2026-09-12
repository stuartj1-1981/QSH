/** INSTRUCTION-524B T6(c) — the panel, fifteen cases. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { HistorianYaml, Driver } from '../../../types/config'
import type { HistorianSetupResponse } from '../../../types/api'

const mockPatch = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: mockPatch, saving: false, error: null }),
}))

/** What the mocked hook serves, and what `fetchNow()` resolves to. */
const state: {
  data: HistorianSetupResponse | null
  fresh: HistorianSetupResponse | null | undefined
  refresh: ReturnType<typeof vi.fn>
  fetchNow: ReturnType<typeof vi.fn>
} = { data: null, fresh: undefined, refresh: vi.fn(), fetchNow: vi.fn() }

vi.mock('../../../hooks/useHistorianSetup', () => ({
  useHistorianSetup: () => ({
    data: state.data,
    loading: false,
    error: null,
    refresh: state.refresh,
    fetchNow: state.fetchNow,
  }),
}))

import { HistorianSettings } from '../HistorianSettings'

function setup(over: Partial<HistorianSetupResponse> = {}): HistorianSetupResponse {
  return {
    store_available: true,
    store_record: false,
    record_state: null,
    historian: true,
    store_open: false,
    active: false,
    backend_config: 'influxdb',
    backend_effective: null,
    enabled: false,
    ...over,
  }
}

const noop = () => {}

function draw(section: HistorianYaml | undefined, s: HistorianSetupResponse | null, driver: Driver = 'ha') {
  state.data = s
  // By default the pre-save read returns the same state the card was drawn
  // from, which is the ordinary case.
  if (state.fresh === undefined) state.fetchNow.mockResolvedValue(s)
  return render(<HistorianSettings historian={section} driver={driver} onRefetch={noop} />)
}

const modeOf = () => screen.getByTestId('historian-mode').getAttribute('data-mode')
const saveButton = () => screen.getByRole('button', { name: /Save Changes/ })
const button = (name: string) => screen.queryByRole('button', { name })

beforeEach(() => {
  mockPatch.mockReset().mockResolvedValue({ updated: 'ok' })
  state.refresh = vi.fn()
  state.fetchNow = vi.fn()
  state.fresh = undefined
})

/* ── 1–3: the write that fixes Doug ────────────────────────────────── */

it('1 — Doug: a disabled section with no record ticks to the built-in store', async () => {
  draw({ enabled: false }, setup())
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(state.fetchNow).toHaveBeenCalled()
  expect(mockPatch).toHaveBeenCalledWith('historian', {
    enabled: true,
    backend: 'qsdb',
    store: { shadow: false },
  })
})

it('2 — an absent section writes the same body', async () => {
  draw(undefined, setup())
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch).toHaveBeenCalledWith('historian', {
    enabled: true,
    backend: 'qsdb',
    store: { shadow: false },
  })
})

it('3 — a none record with no backend key is fresh, and the body carries backend', async () => {
  draw({ enabled: false }, setup({ record_state: 'none' }))
  expect(modeOf()).toBe('fresh')

  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch.mock.calls[0][1]).toMatchObject({ backend: 'qsdb' })
})

/* ── 4: the M1 window ──────────────────────────────────────────────── */

it('4 — an unread record writes nothing and disables Save', () => {
  draw({ enabled: true }, setup({ store_record: true, record_state: 'unread' }))

  expect(modeOf()).toBe('unknown')
  expect(screen.getByText(/has not read the built-in store yet/)).toBeInTheDocument()
  expect(button('Use the built-in store only')).not.toBeInTheDocument()
  expect(saveButton()).toBeDisabled()
  expect(mockPatch).not.toHaveBeenCalled()
})

/* ── 5–8: migrating ────────────────────────────────────────────────── */

it('5 — migrating and active: unticking writes enabled false only', async () => {
  draw({ enabled: true }, setup({ record_state: 'backfill', active: true }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch).toHaveBeenCalledWith('historian', { enabled: false })
})

it('6 — migrating on a parked qsdb section: ticking also un-parks it', async () => {
  draw(
    { enabled: false, backend: 'qsdb', store: { shadow: false } },
    setup({ record_state: 'shadow' }),
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch).toHaveBeenCalledWith('historian', {
    enabled: true,
    backend: 'qsdb',
    store: { shadow: true },
  })
})

it('7 — parked on either backend offers Resume, and RESUME is what it writes', async () => {
  const first = draw({ enabled: true, backend: 'qsdb' }, setup({ record_state: 'backfill' }))
  expect(screen.getByText(/paused by historian.store.shadow/)).toBeInTheDocument()
  fireEvent.click(button('Resume the move')!)
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch).toHaveBeenCalledWith('historian', {
    enabled: true,
    backend: 'qsdb',
    store: { shadow: true },
  })
  first.unmount()

  mockPatch.mockClear()
  draw(
    { enabled: true, store: { shadow: false } },
    setup({ record_state: 'backfill', active: true }),
  )
  expect(screen.getByText(/InfluxDB still records your history/)).toBeInTheDocument()
  fireEvent.click(button('Resume the move')!)
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  const body = mockPatch.mock.calls[0][1] as HistorianYaml
  expect(body.store?.shadow).toBe(true)
  expect(body.backend).toBeUndefined()
})

it('8 — the source is gone: the cutover advice is shown and Resume is not', () => {
  draw({ enabled: true }, setup({ record_state: 'shadow' }))

  expect(screen.getByText(/did not answer when QSH last started/)).toBeInTheDocument()
  expect(screen.getByText(/cutover_force/)).toBeInTheDocument()
  expect(button('Resume the move')).not.toBeInTheDocument()
})

/* ── 9–10: builtin and legacy ──────────────────────────────────────── */

it('9 — cut over but not recording: the repair button writes BUILTIN', async () => {
  draw(
    { enabled: true },
    setup({ record_state: 'cutover', store_open: true, backend_effective: 'qsdb' }),
  )
  fireEvent.click(button('Use the built-in store only')!)
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch).toHaveBeenCalledWith('historian', {
    enabled: true,
    backend: 'qsdb',
    store: { shadow: false },
  })
})

it('10 — legacy offers the move; the same section not active is fresh instead', async () => {
  const first = draw(
    { enabled: true, store: { shadow: false } },
    setup({ active: true, backend_effective: 'influxdb' }),
  )
  expect(modeOf()).toBe('legacy')
  fireEvent.click(button('Move to the built-in store')!)
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  const body = mockPatch.mock.calls[0][1] as HistorianYaml
  expect(body.store?.shadow).toBe(true)
  expect(body.backend).toBeUndefined()
  first.unmount()

  draw({ enabled: true, store: { shadow: false } }, setup())
  expect(modeOf()).toBe('fresh')
  expect(button('Move to the built-in store')).not.toBeInTheDocument()
  expect(button('Use the built-in store only')).toBeInTheDocument()
})

/* ── 11–12: the states that permit little or nothing ───────────────── */

it('11 — the setup fetch failed: Save and the checkbox are both disabled', () => {
  draw({ enabled: true }, null)

  expect(modeOf()).toBe('unknown')
  expect(saveButton()).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(mockPatch).not.toHaveBeenCalled()
})

it('12 — unavailable: it can be turned off, and that is all it writes', async () => {
  draw({ enabled: true }, setup({ store_available: false }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())

  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  expect(mockPatch).toHaveBeenCalledWith('historian', { enabled: false })
})

/* ── 13: the state moved under the card ────────────────────────────── */

describe('13 — the pre-save read decides, not the state the card was drawn from', () => {
  it('a state that moved sends nothing and says so', async () => {
    state.data = setup()
    // The card is drawn `fresh`; by the time Save is pressed a migration
    // has started, so the mode the user acted on no longer holds.
    state.fetchNow.mockResolvedValue(setup({ record_state: 'shadow' }))
    render(<HistorianSettings historian={{ enabled: false }} driver="ha" onRefetch={noop} />)
    expect(modeOf()).toBe('fresh')

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(screen.getByText(/The historian state changed/)).toBeInTheDocument(),
    )
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('a state that cannot be read sends nothing and says so', async () => {
    state.data = setup()
    state.fetchNow.mockResolvedValue(null)
    render(<HistorianSettings historian={{ enabled: false }} driver="ha" onRefetch={noop} />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(screen.getByText(/cannot read the historian state now/)).toBeInTheDocument(),
    )
    expect(mockPatch).not.toHaveBeenCalled()
  })
})

/* ── 14–15: the driver, and the absence of InfluxDB ────────────────── */

it('14 — both drivers send deep-equal bodies', async () => {
  const ha = draw({ enabled: false }, setup(), 'ha')
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  const haBody = mockPatch.mock.calls[0][1]
  ha.unmount()

  mockPatch.mockClear()
  state.fetchNow = vi.fn()
  draw({ enabled: false }, setup(), 'mqtt')
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(saveButton())
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))

  expect(mockPatch.mock.calls[0][1]).toEqual(haBody)
})

it('15 — no InfluxDB field, no Test Connection, no text input', () => {
  draw({ enabled: true, host: 'a0d7b954-influxdb', port: 8086 }, setup())

  expect(screen.queryByText(/InfluxDB logging/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Test Connection/)).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('Historian')).toBeInTheDocument()
})
