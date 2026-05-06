/**
 * INSTRUCTION-136A Task 6 + INSTRUCTION-163: TariffSettings → Tariff
 * Aggression section.
 *
 * Covers:
 *   - Three-way Comfort/Optimise/Aggressive button group renders.
 *   - Default selection reflects current config value (or 'optimise' fallback).
 *   - Clicking a button calls patch('energy', { tariff_aggression_mode: ... }).
 *   - INSTRUCTION-163: in summer_monitoring the section renders disabled
 *     with a caption (was: hidden). Configuration UI is never gated on
 *     operational state — the runtime gate lives on Home.
 *   - Each option's description text matches the scope doc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CycleMessage } from '../../../types/api'

const liveMock = vi.hoisted(() => ({ data: null as CycleMessage | null }))
const patchMock = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))

vi.mock('../../../hooks/useLive', () => ({
  useLive: () => ({ data: liveMock.data, isConnected: true, lastUpdate: 0 }),
}))

import { TariffSettings } from '../TariffSettings'

const noop = () => {}

beforeEach(() => {
  liveMock.data = null
  patchMock.mockReset()
  patchMock.mockResolvedValue({})
})

describe('TariffSettings — tariff aggression section', () => {
  it('renders the three-button group when not in summer mode', () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    expect(screen.getByTestId('tariff-aggression-section')).toBeDefined()
    expect(screen.getByTestId('tariff-aggression-comfort')).toBeDefined()
    expect(screen.getByTestId('tariff-aggression-optimise')).toBeDefined()
    expect(screen.getByTestId('tariff-aggression-aggressive')).toBeDefined()
  })

  it('renders disabled with summer-monitoring caption when summer_monitoring === true', async () => {
    // INSTRUCTION-163: configuration UI must always be visible. Summer
    // monitoring disables interaction and surfaces a caption — it does not
    // hide the section.
    const user = userEvent.setup()
    liveMock.data = {
      type: 'cycle',
      engineering: {
        det_flow: 35,
        rl_flow: null,
        rl_blend: 0,
        rl_reward: 0,
        shoulder_monitoring: false,
        summer_monitoring: true,
      },
    } as unknown as CycleMessage
    render(
      <TariffSettings
        energy={{ tariff_aggression_mode: 'aggressive' }}
        driver="ha"
        onRefetch={noop}
      />,
    )

    // Section visible (the user must always be able to see what is configured
    // for next winter).
    expect(screen.getByTestId('tariff-aggression-section')).toBeDefined()

    // All three radios are HTML-disabled.
    const comfort = screen.getByTestId('tariff-aggression-comfort') as HTMLButtonElement
    const optimise = screen.getByTestId('tariff-aggression-optimise') as HTMLButtonElement
    const aggressive = screen.getByTestId('tariff-aggression-aggressive') as HTMLButtonElement
    expect(comfort.disabled).toBe(true)
    expect(optimise.disabled).toBe(true)
    expect(aggressive.disabled).toBe(true)

    // V2 / L2: radiogroup wrapper carries aria-disabled=true so assistive
    // tech announces the entire group as inert.
    const radiogroup = screen.getByRole('radiogroup', { name: 'tariff-aggression' })
    expect(radiogroup.getAttribute('aria-disabled')).toBe('true')

    // Caption present.
    expect(screen.getByTestId('tariff-aggression-summer-note')).toBeDefined()

    // V2 / L3: selected mode is still indicated even though disabled — the
    // user must be able to see which mode is configured for next winter.
    expect(aggressive.getAttribute('aria-checked')).toBe('true')
    expect(comfort.getAttribute('aria-checked')).toBe('false')
    expect(optimise.getAttribute('aria-checked')).toBe('false')

    // Native HTML disabled blocks user-event clicks (matching Task 1 V2
    // contract: native disabled is the sole gate, no runtime click-guard).
    await user.click(aggressive)
    await user.click(comfort)
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('clicking Aggressive calls patch with the correct payload', async () => {
    const user = userEvent.setup()
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    await user.click(screen.getByTestId('tariff-aggression-aggressive'))
    expect(patchMock).toHaveBeenCalledWith('energy', {
      tariff_aggression_mode: 'aggressive',
    })
  })

  it('clicking Comfort calls patch with the correct payload', async () => {
    const user = userEvent.setup()
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    await user.click(screen.getByTestId('tariff-aggression-comfort'))
    expect(patchMock).toHaveBeenCalledWith('energy', {
      tariff_aggression_mode: 'comfort',
    })
  })

  it('default selection reflects the current config value (aggressive)', () => {
    render(
      <TariffSettings
        energy={{ tariff_aggression_mode: 'aggressive' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const aggressive = screen.getByTestId('tariff-aggression-aggressive')
    expect(aggressive.getAttribute('aria-checked')).toBe('true')
    const comfort = screen.getByTestId('tariff-aggression-comfort')
    expect(comfort.getAttribute('aria-checked')).toBe('false')
  })

  it('defaults to optimise when no mode is set in config', () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    const optimise = screen.getByTestId('tariff-aggression-optimise')
    expect(optimise.getAttribute('aria-checked')).toBe('true')
  })

  it('option descriptions match the scope doc decision table', () => {
    render(<TariffSettings energy={{}} driver="ha" onRefetch={noop} />)
    // Comfort: never reduce flow temp.
    expect(
      screen.getByTestId('tariff-aggression-comfort').textContent,
    ).toContain('Never reduce flow temp')
    // Optimise: 10% threshold.
    expect(
      screen.getByTestId('tariff-aggression-optimise').textContent,
    ).toContain('10%')
    // Aggressive: any positive net savings.
    expect(
      screen.getByTestId('tariff-aggression-aggressive').textContent,
    ).toContain('positive net savings')
  })
})
