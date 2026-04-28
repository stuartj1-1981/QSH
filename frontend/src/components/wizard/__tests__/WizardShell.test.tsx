import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
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
  it('renders one segment and one label cell per step (13-step HA variant)', () => {
    const labels = [
      'Restore', 'Welcome', 'Data Sharing', 'Connection', 'Heat Source',
      'Sensors', 'Rooms', 'Tariff', 'Schedules', 'Thermal',
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

  it('renders one segment and one label cell per step (14-step MQTT variant)', () => {
    const labels = [
      'Restore', 'Welcome', 'Data Sharing', 'Connection', 'Heat Source',
      'MQTT Broker', 'Sensors', 'Rooms', 'Tariff', 'Schedules',
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
})
