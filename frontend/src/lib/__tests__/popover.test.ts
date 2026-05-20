import { describe, it, expect } from 'vitest'
import { computePopoverCoords, VIEWPORT_MARGIN, VERTICAL_GAP } from '../popover'

const viewport = (innerWidth: number, innerHeight: number) => ({ innerWidth, innerHeight })

describe('computePopoverCoords', () => {
  it('places above when both sides fit', () => {
    // Plenty of room above and below. Above is preferred.
    const { top, left } = computePopoverCoords(
      { triggerTop: 400, triggerBottom: 420, anchorX: 500 },
      { width: 200, height: 100 },
      viewport(1000, 800),
    )
    expect(top).toBe(400 - 100 - VERTICAL_GAP)
    expect(left).toBe(500 - 200 / 2)
  })

  it('flips to below when above does not fit', () => {
    // Trigger near top of viewport: above has no room, below has plenty.
    const { top } = computePopoverCoords(
      { triggerTop: 20, triggerBottom: 40, anchorX: 500 },
      { width: 200, height: 100 },
      viewport(1000, 800),
    )
    expect(top).toBe(40 + VERTICAL_GAP)
  })

  it('picks the larger side and clamps to viewport when neither side fits', () => {
    // Trigger in the middle; popover is taller than either side's available space.
    // innerHeight=400, triggerTop=180, triggerBottom=220, popHeight=300.
    // spaceAbove = 180 - 8 - 8 = 164; spaceBelow = 400 - 220 - 8 - 8 = 164.
    // Tied -> spaceAbove >= spaceBelow takes the "above" branch.
    // Above branch produces top = 180 - 300 - 8 = -128; clamped to VIEWPORT_MARGIN.
    const { top } = computePopoverCoords(
      { triggerTop: 180, triggerBottom: 220, anchorX: 500 },
      { width: 200, height: 300 },
      viewport(1000, 400),
    )
    expect(top).toBe(VIEWPORT_MARGIN)
  })

  it('clamps left when anchor is near the right edge', () => {
    const { left } = computePopoverCoords(
      { triggerTop: 400, triggerBottom: 420, anchorX: 995 },
      { width: 200, height: 100 },
      viewport(1000, 800),
    )
    // Centred left = 995 - 100 = 895; maxLeft = 1000 - 200 - 8 = 792.
    expect(left).toBe(792)
  })

  it('clamps left when anchor is near the left edge', () => {
    const { left } = computePopoverCoords(
      { triggerTop: 400, triggerBottom: 420, anchorX: 5 },
      { width: 200, height: 100 },
      viewport(1000, 800),
    )
    // Centred left = 5 - 100 = -95; clamped up to VIEWPORT_MARGIN.
    expect(left).toBe(VIEWPORT_MARGIN)
  })

  it('forces left to VIEWPORT_MARGIN when popover is wider than the viewport', () => {
    const { left } = computePopoverCoords(
      { triggerTop: 400, triggerBottom: 420, anchorX: 100 },
      { width: 500, height: 100 },
      viewport(300, 800),
    )
    // maxLeft = 300 - 500 - 8 = -208 < VIEWPORT_MARGIN; the helper falls back to VIEWPORT_MARGIN.
    expect(left).toBe(VIEWPORT_MARGIN)
  })

  it('regression: solar-tooltip scenario clamps top into the viewport', () => {
    // Original defect: HelpTip's 160 px threshold produced top = -128 for a
    // 230 px popover with triggerTop = 180 inside a 400 px viewport. The new
    // algorithm must keep top inside [VIEWPORT_MARGIN, innerHeight - margin - height].
    const innerHeight = 400
    const popHeight = 300
    const { top } = computePopoverCoords(
      { triggerTop: 180, triggerBottom: 194, anchorX: 500 },
      { width: 224, height: popHeight },
      viewport(1000, innerHeight),
    )
    const maxTop = innerHeight - popHeight - VIEWPORT_MARGIN
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
    expect(top).toBeLessThanOrEqual(maxTop)
  })

  it('vertical degenerate: popover taller than viewport pins top to VIEWPORT_MARGIN', () => {
    // Symmetric to the horizontal width-larger-than-viewport case. Guards against
    // future divergence between axes inside the clamp helper.
    const { top } = computePopoverCoords(
      { triggerTop: 10, triggerBottom: 30, anchorX: 500 },
      { width: 200, height: 500 },
      viewport(1000, 400),
    )
    expect(top).toBe(VIEWPORT_MARGIN)
  })
})
