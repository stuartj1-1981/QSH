/**
 * Verifies that components in the 30s WebSocket render path are wrapped with
 * React.memo so they skip re-renders when props are unchanged.
 *
 * Each test:
 *  1. Confirms the export is a React.memo wrapper ($$typeof check).
 *  2. Renders with initial props, re-renders with identical props, and asserts
 *     the DOM output is stable (no crash / no content change).
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EngineeringBar } from '../EngineeringBar'
import { TrendChart } from '../TrendChart'
import { OperatingStateTimeline } from '../OperatingStateTimeline'
import { CapacityBar } from '../CapacityBar'
import { RecoveryCard } from '../RecoveryCard'
import { HardwareTelemetry } from '../HardwareTelemetry'

// React.memo wraps the component in an object with $$typeof === REACT_MEMO_TYPE.
// The Symbol description is 'react.memo' in React 18+.
function isMemoWrapped(component: unknown): boolean {
  return (
    typeof component === 'object' &&
    component !== null &&
    '$$typeof' in component &&
    String((component as { $$typeof: unknown }).$$typeof).includes('memo')
  )
}

describe('React.memo wrapping — WS render path components', () => {
  it('EngineeringBar is wrapped with React.memo', () => {
    expect(isMemoWrapped(EngineeringBar)).toBe(true)
  })

  it('TrendChart is wrapped with React.memo', () => {
    expect(isMemoWrapped(TrendChart)).toBe(true)
  })

  it('OperatingStateTimeline is wrapped with React.memo', () => {
    expect(isMemoWrapped(OperatingStateTimeline)).toBe(true)
  })

  it('CapacityBar is wrapped with React.memo', () => {
    expect(isMemoWrapped(CapacityBar)).toBe(true)
  })

  it('RecoveryCard is wrapped with React.memo', () => {
    expect(isMemoWrapped(RecoveryCard)).toBe(true)
  })

  it('HardwareTelemetry is wrapped with React.memo', () => {
    expect(isMemoWrapped(HardwareTelemetry)).toBe(true)
  })
})

describe('React.memo — no re-render with identical props', () => {
  it('CapacityBar does not change DOM output on rerender with same props', () => {
    const props = { capacityPct: 60, minLoadPct: 33 }
    const { container, rerender } = render(<CapacityBar {...props} />)
    const htmlBefore = container.innerHTML
    rerender(<CapacityBar {...props} />)
    expect(container.innerHTML).toBe(htmlBefore)
  })

  it('RecoveryCard does not change DOM output on rerender with same props', () => {
    const props = { recoveryTimeHours: 1.5, capacityPct: 60 }
    const { container, rerender } = render(<RecoveryCard {...props} />)
    const htmlBefore = container.innerHTML
    rerender(<RecoveryCard {...props} />)
    expect(container.innerHTML).toBe(htmlBefore)
  })

  it('OperatingStateTimeline does not change DOM output on rerender with same data reference', () => {
    const data = [
      { t: 1000, operating_state: 'Winter (Heating)' },
      { t: 2000, operating_state: 'Winter (Heating)' },
    ]
    const { container, rerender } = render(<OperatingStateTimeline data={data} hours={24} />)
    const htmlBefore = container.innerHTML
    rerender(<OperatingStateTimeline data={data} hours={24} />)
    expect(container.innerHTML).toBe(htmlBefore)
  })

  it('EngineeringBar does not change DOM output on rerender with same props', () => {
    const props = {
      cycleNumber: 42,
      detFlow: 45.0,
      rlFlow: 44.5,
      rlBlend: 0.75,
      rlReward: 1.23,
      shoulderMonitoring: false,
      summerMonitoring: false,
      antifrostOverrideActive: false,
      winterEquilibrium: false,
    }
    const { container, rerender } = render(<EngineeringBar {...props} />)
    const htmlBefore = container.innerHTML
    rerender(<EngineeringBar {...props} />)
    expect(container.innerHTML).toBe(htmlBefore)
  })
})
