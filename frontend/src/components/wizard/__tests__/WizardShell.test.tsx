import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WizardShell } from '../WizardShell'

const baseProps = {
  currentStep: 3,
  onBack: () => {},
  onNext: () => {},
  isFirstStep: false,
  isLastStep: false,
  validationErrors: [],
  children: <div>content</div>,
}

function gapClass(el: Element): string | null {
  const m = el.className.match(/\bgap-\d+(?:\.\d+)?\b/)
  return m ? m[0] : null
}

describe('WizardShell progress bar / label alignment', () => {
  it('renders one segment and one label cell per step (14-step HA variant)', () => {
    // INSTRUCTION-162B: HA path gained `Auxiliary outputs` between `Rooms`
    // and `Tariff` (13 → 14).
    const labels = [
      'Restore', 'Welcome', 'Data Sharing', 'Connection', 'Heat Source',
      'Sensors', 'Rooms', 'Auxiliary outputs', 'Tariff', 'Schedules', 'Thermal',
      'Hot Water', 'Disclaimer', 'Review',
    ]
    const { getByTestId } = render(
      <WizardShell {...baseProps} totalSteps={labels.length} stepLabels={labels} />
    )
    const segRow = getByTestId('wizard-progress-segments')
    const labelRow = getByTestId('wizard-progress-labels')
    expect(segRow.children.length).toBe(labels.length)
    expect(labelRow.children.length).toBe(labels.length)
  })

  it('renders one segment and one label cell per step (15-step MQTT variant)', () => {
    // INSTRUCTION-162B: MQTT path also gained `Auxiliary outputs` (14 → 15).
    const labels = [
      'Restore', 'Welcome', 'Data Sharing', 'Connection', 'Heat Source',
      'MQTT Broker', 'Sensors', 'Rooms', 'Auxiliary outputs', 'Tariff', 'Schedules',
      'Thermal', 'Hot Water', 'Disclaimer', 'Review',
    ]
    const { getByTestId } = render(
      <WizardShell {...baseProps} totalSteps={labels.length} stepLabels={labels} />
    )
    const segRow = getByTestId('wizard-progress-segments')
    const labelRow = getByTestId('wizard-progress-labels')

    expect(segRow.children.length).toBe(labels.length)
    expect(labelRow.children.length).toBe(labels.length)

    Array.from(labelRow.children).forEach((cell) => {
      expect(cell.className).toMatch(/\bflex-1\b/)
    })

    const segGap = gapClass(segRow)
    const labelGap = gapClass(labelRow)
    expect(segGap).not.toBeNull()
    expect(labelGap).toBe(segGap)
  })

  it('renders the progress bar inside a max-w-7xl container regardless of step count', () => {
    // INSTRUCTION-146: the progress bar's inner container is widened to
    // max-w-7xl so the 14-step MQTT path's longer labels ("Data Sharing",
    // "MQTT Broker", "Heat Source") fit without truncation on standard
    // laptop viewports. The 13-step path also benefits — the assertion is
    // structural and independent of step count. Guards against accidental
    // revert to max-w-4xl, which silently re-introduces ellipsisation.
    const variants: string[][] = [
      [
        'Restore', 'Welcome', 'Data Sharing', 'Connection', 'Heat Source',
        'Sensors', 'Rooms', 'Auxiliary outputs', 'Tariff', 'Schedules', 'Thermal',
        'Hot Water', 'Disclaimer', 'Review',
      ],
      [
        'Restore', 'Welcome', 'Data Sharing', 'Connection', 'Heat Source',
        'MQTT Broker', 'Sensors', 'Rooms', 'Auxiliary outputs', 'Tariff', 'Schedules',
        'Thermal', 'Hot Water', 'Disclaimer', 'Review',
      ],
    ]

    for (const labels of variants) {
      const { getByTestId, unmount } = render(
        <WizardShell {...baseProps} totalSteps={labels.length} stepLabels={labels} />
      )
      const segRow = getByTestId('wizard-progress-segments')
      const progressContainer = segRow.parentElement
      expect(progressContainer).not.toBeNull()
      expect(progressContainer!.className).toMatch(/\bmax-w-7xl\b/)
      expect(progressContainer!.className).not.toMatch(/\bmax-w-4xl\b/)
      unmount()
    }
  })
})

// ── INSTRUCTION-414: footer disabled-reason title + Back seal ────────────
describe('WizardShell footer controls (INSTRUCTION-414)', () => {
  const shellProps = {
    ...baseProps,
    totalSteps: 3,
    stepLabels: ['a', 'b', 'c'],
  }

  it('renders nextDisabledReason as the primary button title (D5 tooltip migration)', () => {
    render(
      <WizardShell
        {...shellProps}
        isLastStep
        nextDisabled
        nextDisabledReason="2 warnings awaiting confirmation"
      />
    )
    const btn = screen.getByRole('button', { name: /deploy/i })
    expect(btn.getAttribute('title')).toBe('2 warnings awaiting confirmation')
  })

  it('leaves the primary button title unset when no reason is given', () => {
    render(<WizardShell {...shellProps} isLastStep />)
    const btn = screen.getByRole('button', { name: /deploy/i })
    expect(btn.getAttribute('title')).toBeNull()
  })

  it('disables Back when backDisabled is set even though it is not the first step (D6 seal)', () => {
    render(<WizardShell {...shellProps} backDisabled />)
    const back = screen.getByRole('button', { name: /back/i }) as HTMLButtonElement
    expect(back.disabled).toBe(true)
  })

  it('leaves Back enabled when backDisabled is unset and not the first step', () => {
    render(<WizardShell {...shellProps} />)
    const back = screen.getByRole('button', { name: /back/i }) as HTMLButtonElement
    expect(back.disabled).toBe(false)
  })
})
