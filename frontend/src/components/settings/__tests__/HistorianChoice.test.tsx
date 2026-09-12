/**
 * INSTRUCTION-524B T6(f) — one row per mode and per text variant: the
 * rendered mode, the text, which of the four buttons appear, and whether
 * the checkbox is enabled. The parked/not-enabled row is review finding R1,
 * carried by DISPATCH-NOTE-524A-524B-2026-09-12.md.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HistorianChoice } from '../HistorianChoice'
import { HISTORIAN } from '../../../lib/helpText'
import type { HistorianYaml } from '../../../types/config'
import type { HistorianSetupResponse } from '../../../types/api'

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

function draw(
  section: HistorianYaml | null | undefined,
  s: HistorianSetupResponse | null,
  over: { checked?: boolean; onAction?: (a: never) => void; onRetry?: () => void } = {},
) {
  return render(
    <HistorianChoice
      section={section}
      setup={s}
      error={null}
      checked={over.checked ?? false}
      onAction={(over.onAction as never) ?? noop}
      onRetry={over.onRetry ?? noop}
    />,
  )
}

const mode = () => screen.getByTestId('historian-mode').getAttribute('data-mode')
const button = (name: string) => screen.queryByRole('button', { name })
const checkbox = () => screen.getByRole('checkbox')

describe('unknown — three text variants, Try again, checkbox disabled', () => {
  it('setup is null', () => {
    draw({}, null)
    expect(mode()).toBe('unknown')
    expect(screen.getByText(HISTORIAN.unknown.noSetup)).toBeInTheDocument()
    expect(button('Try again')).toBeInTheDocument()
    expect(checkbox()).toBeDisabled()
  })

  it('the record is unread', () => {
    draw({}, setup({ store_record: true, record_state: 'unread' }))
    expect(mode()).toBe('unknown')
    expect(screen.getByText(HISTORIAN.unknown.unread)).toBeInTheDocument()
  })

  it('a record with no state', () => {
    draw({}, setup({ store_record: true, record_state: null }))
    expect(mode()).toBe('unknown')
    expect(screen.getByText(HISTORIAN.unknown.noState)).toBeInTheDocument()
  })
})

describe('unavailable and unreadable — off only', () => {
  it('unavailable, already on: can be turned off', () => {
    draw({ enabled: true }, setup({ store_available: false }), { checked: true })
    expect(mode()).toBe('unavailable')
    expect(screen.getByText(HISTORIAN.unavailable)).toBeInTheDocument()
    expect(checkbox()).toBeEnabled()
  })

  it('unavailable, already off: cannot be turned on', () => {
    draw({}, setup({ store_available: false }), { checked: false })
    expect(checkbox()).toBeDisabled()
  })

  it('unreadable', () => {
    draw({ enabled: true }, setup({ record_state: 'unreadable' }), { checked: true })
    expect(mode()).toBe('unreadable')
    expect(screen.getByText(HISTORIAN.unreadable)).toBeInTheDocument()
  })
})

describe('migrating — parked, three variants', () => {
  it('parked and recording to InfluxDB', () => {
    draw({ enabled: true, store: { shadow: false } }, setup({ record_state: 'backfill', active: true }))
    expect(mode()).toBe('migrating')
    expect(screen.getByText(HISTORIAN.migratingParked.active)).toBeInTheDocument()
    expect(screen.getByText(HISTORIAN.migratingParked.advice)).toBeInTheDocument()
    expect(button('Resume the move')).toBeInTheDocument()
  })

  it('parked, on, and recording nothing', () => {
    draw({ enabled: true, store: { shadow: false } }, setup({ record_state: 'backfill' }))
    expect(screen.getByText(HISTORIAN.migratingParked.inactive)).toBeInTheDocument()
  })

  it('parked and the historian is off (review finding R1)', () => {
    // The cleared text keyed this branch on `active` alone, so a disabled
    // historian was told the key was the reason nothing is recorded.
    draw({ enabled: false, backend: 'qsdb' }, setup({ record_state: 'shadow' }))
    expect(mode()).toBe('migrating')
    expect(screen.getByText(HISTORIAN.migratingParked.notEnabled)).toBeInTheDocument()
    expect(screen.queryByText(HISTORIAN.migratingParked.inactive)).not.toBeInTheDocument()
    expect(button('Resume the move')).toBeInTheDocument()
  })
})

describe('migrating — not parked, three variants, no Resume', () => {
  it('active', () => {
    draw({ enabled: true }, setup({ record_state: 'backfill', active: true }))
    expect(screen.getByText(HISTORIAN.migrating.active)).toBeInTheDocument()
    expect(button('Resume the move')).not.toBeInTheDocument()
  })

  it('enabled and not active', () => {
    draw({ enabled: true }, setup({ record_state: 'shadow' }))
    expect(screen.getByText(HISTORIAN.migrating.enabledNotActive)).toBeInTheDocument()
  })

  it('not enabled', () => {
    draw({ enabled: false, store: { shadow: true } }, setup({ record_state: 'shadow' }))
    expect(screen.getByText(HISTORIAN.migrating.notEnabled)).toBeInTheDocument()
  })
})

describe('builtin — three variants', () => {
  it('enabled and recording', () => {
    draw({ enabled: true, backend: 'qsdb' }, setup({ record_state: 'cutover', active: true }))
    expect(mode()).toBe('builtin')
    expect(screen.getByText(HISTORIAN.builtin.recording)).toBeInTheDocument()
    expect(button('Use the built-in store only')).not.toBeInTheDocument()
  })

  it('enabled and recording nothing — the repair button is offered', () => {
    draw({ enabled: true }, setup({ record_state: 'cutover' }))
    expect(screen.getByText(HISTORIAN.builtin.enabledNotActive)).toBeInTheDocument()
    expect(button('Use the built-in store only')).toBeInTheDocument()
  })

  it('not enabled', () => {
    draw({ enabled: false }, setup({ record_state: 'cutover' }))
    expect(screen.getByText(HISTORIAN.builtin.notEnabled)).toBeInTheDocument()
    expect(button('Use the built-in store only')).not.toBeInTheDocument()
  })
})

describe('legacy', () => {
  it('parked: the move is offered', () => {
    draw(
      { enabled: true, store: { shadow: false } },
      setup({ active: true, backend_effective: 'influxdb' }),
      { checked: true },
    )
    expect(mode()).toBe('legacy')
    expect(screen.getByText(HISTORIAN.legacy.lead)).toBeInTheDocument()
    expect(screen.getByText(HISTORIAN.legacy.move)).toBeInTheDocument()
    expect(button('Move to the built-in store')).toBeInTheDocument()
  })

  it('not parked: the store did not start, and no move button', () => {
    draw({ enabled: true }, setup({ active: true, backend_effective: 'influxdb' }), {
      checked: true,
    })
    expect(screen.getByText(HISTORIAN.legacy.noStore)).toBeInTheDocument()
    expect(button('Move to the built-in store')).not.toBeInTheDocument()
  })
})

describe('fresh', () => {
  it('the plain case', () => {
    draw({}, setup())
    expect(mode()).toBe('fresh')
    expect(screen.getByText(HISTORIAN.fresh.lead)).toBeInTheDocument()
    expect(screen.queryByText(HISTORIAN.fresh.oldInflux)).not.toBeInTheDocument()
  })

  it('a section carrying a host warns that old history is not copied', () => {
    draw({ host: 'a0d7b954-influxdb' }, setup())
    expect(screen.getByText(HISTORIAN.fresh.oldInflux)).toBeInTheDocument()
  })

  it('backend influxdb warns the same way', () => {
    draw({ backend: 'influxdb' }, setup())
    expect(screen.getByText(HISTORIAN.fresh.oldInflux)).toBeInTheDocument()
  })

  it('enabled on qsdb with a store that did not open', () => {
    draw({ enabled: true, backend: 'qsdb' }, setup({ store_open: false }))
    expect(screen.getByText(HISTORIAN.fresh.storeDidNotStart)).toBeInTheDocument()
  })
})

describe('every button reports its action', () => {
  it('Resume the move', () => {
    const onAction = vi.fn()
    draw({ enabled: true, store: { shadow: false } }, setup({ record_state: 'backfill' }), {
      onAction: onAction as never,
    })
    fireEvent.click(button('Resume the move')!)
    expect(onAction).toHaveBeenCalledWith('resume')
  })

  it('Use the built-in store only', () => {
    const onAction = vi.fn()
    draw({ enabled: true }, setup({ record_state: 'cutover' }), { onAction: onAction as never })
    fireEvent.click(button('Use the built-in store only')!)
    expect(onAction).toHaveBeenCalledWith('use_builtin')
  })

  it('Move to the built-in store', () => {
    const onAction = vi.fn()
    draw(
      { enabled: true, store: { shadow: false } },
      setup({ active: true, backend_effective: 'influxdb' }),
      { checked: true, onAction: onAction as never },
    )
    fireEvent.click(button('Move to the built-in store')!)
    expect(onAction).toHaveBeenCalledWith('move_to_builtin')
  })

  it('Try again calls onRetry, not onAction', () => {
    const onRetry = vi.fn()
    const onAction = vi.fn()
    draw({}, null, { onRetry, onAction: onAction as never })
    fireEvent.click(button('Try again')!)
    expect(onRetry).toHaveBeenCalled()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('the checkbox reports enable and disable', () => {
    const onAction = vi.fn()
    const { unmount } = draw({}, setup(), { onAction: onAction as never })
    fireEvent.click(checkbox())
    expect(onAction).toHaveBeenCalledWith('enable')
    unmount()

    const onAction2 = vi.fn()
    draw({ enabled: true }, setup(), { checked: true, onAction: onAction2 as never })
    fireEvent.click(checkbox())
    expect(onAction2).toHaveBeenCalledWith('disable')
  })
})

it('renders no text input and no InfluxDB wording', () => {
  draw({ enabled: true, host: 'a0d7b954-influxdb' }, setup())
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByText(/Test Connection/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Enable InfluxDB logging/)).not.toBeInTheDocument()
})
