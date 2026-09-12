/**
 * INSTRUCTION-524C T6(a) — the wizard's historian step.
 *
 * The tick/untick restoration case is review finding L5, carried by
 * DISPATCH-NOTE-524C-2026-09-11.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { QshConfigYaml, HistorianYaml } from '../../../types/config'
import type { HistorianSetupResponse } from '../../../types/api'

const state: { data: HistorianSetupResponse | null; refresh: ReturnType<typeof vi.fn> } = {
  data: null,
  refresh: vi.fn(),
}

vi.mock('../../../hooks/useHistorianSetup', () => ({
  useHistorianSetup: () => ({
    data: state.data,
    loading: false,
    error: null,
    refresh: state.refresh,
    fetchNow: vi.fn(),
  }),
}))

import { StepHistorian } from '../StepHistorian'

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

const onUpdate = vi.fn()

function draw(
  historian: HistorianYaml | undefined,
  s: HistorianSetupResponse | null,
  driver: 'ha' | 'mqtt' = 'ha',
) {
  state.data = s
  const config = { driver, ...(historian ? { historian } : {}) } as Partial<QshConfigYaml>
  return render(<StepHistorian config={config} onUpdate={onUpdate} />)
}

const checkbox = () => screen.getByRole('checkbox')
const lastArg = () => onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]

beforeEach(() => {
  onUpdate.mockReset()
  state.refresh = vi.fn()
})

describe.each(['ha', 'mqtt'] as const)('driver %s — the driver is not an input to the rule', (driver) => {
  it('1 — a fresh install is untouched and unticked', () => {
    draw(undefined, setup(), driver)
    expect(checkbox()).not.toBeChecked()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('2 — ticking writes the built-in store', () => {
    draw(undefined, setup(), driver)
    fireEvent.click(checkbox())
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith('historian', {
      enabled: true,
      backend: 'qsdb',
      store: { shadow: false },
    })
  })

  it('4 — unticking a hydrated built-in section writes enabled false, not undefined', () => {
    draw({ enabled: true, backend: 'qsdb', store: { shadow: false } }, setup({ record_state: 'none' }), driver)
    fireEvent.click(checkbox())
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(lastArg()).toEqual({
      enabled: false,
      backend: 'qsdb',
      store: { shadow: false },
    })
    expect(lastArg()).not.toBeUndefined()
  })
})

it('3 — a re-run with a migrating record changes enabled and nothing else', () => {
  const hydrated = { enabled: false, host: 'x', store: { retention_days: 30 } }
  draw(hydrated, setup({ record_state: 'backfill' }))

  fireEvent.click(checkbox())

  expect(onUpdate).toHaveBeenCalledTimes(1)
  expect(lastArg()).toEqual({ enabled: true, host: 'x', store: { retention_days: 30 } })
})

it('5 — an unreadable setup disables the checkbox and writes nothing', () => {
  draw({ enabled: true }, null)
  expect(checkbox()).toBeDisabled()
  expect(onUpdate).not.toHaveBeenCalled()
})

it('6 — a legacy re-run offers the move, and the move writes shadow true only', () => {
  draw(
    { enabled: true, store: { shadow: false } },
    setup({ active: true, backend_effective: 'influxdb' }),
  )

  const move = screen.getByRole('button', { name: 'Move to the built-in store' })
  fireEvent.click(move)

  expect(onUpdate).toHaveBeenCalledTimes(1)
  const arg = lastArg() as HistorianYaml
  expect(arg.store?.shadow).toBe(true)
  expect(arg.backend).toBeUndefined()
})

describe('L5 — tick then untick restores what the run found', () => {
  it('a hydrated section comes back exactly', () => {
    // Deriving the mode from the section an earlier action wrote makes this
    // destructive: the tick writes BUILTIN, and an untick derived from that
    // would deploy `backend: qsdb, store.shadow: false` with `enabled:
    // false` — a section the user never had.
    const hydrated = { enabled: false, host: 'x' }
    draw(hydrated, setup({ record_state: 'none' }))

    fireEvent.click(checkbox())
    expect(lastArg()).toEqual({
      enabled: true,
      host: 'x',
      backend: 'qsdb',
      store: { shadow: false },
    })

    fireEvent.click(checkbox())
    expect(lastArg()).toEqual(hydrated)
    expect(lastArg()).not.toHaveProperty('backend')
  })

  it('an absent section comes back absent, not as an empty shape', () => {
    draw(undefined, setup())

    fireEvent.click(checkbox())
    expect(lastArg()).toMatchObject({ enabled: true, backend: 'qsdb' })

    fireEvent.click(checkbox())
    expect(lastArg()).toBeUndefined()
  })
})
