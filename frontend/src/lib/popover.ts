// Shared viewport-aware placement for portaled popovers / tooltips.
// Consumers: HelpTip, OccupancyTimeline, OperatingStateTimeline.
//
// Algorithm:
//   1. Prefer rendering above the trigger band. If there is not enough room
//      above, render below; if neither side has room, pick the larger side.
//   2. Clamp the final `top` to [VIEWPORT_MARGIN, innerHeight - margin - height]
//      so the popover stays fully on-screen even when it is taller than the
//      space available on either side.
//   3. Centre horizontally on `anchorX`, then clamp into
//      [VIEWPORT_MARGIN, innerWidth - margin - width].

export const VIEWPORT_MARGIN = 8
export const VERTICAL_GAP = 8

export interface PopoverAnchor {
  triggerTop: number     // viewport top of the trigger band (e.g. rect.top)
  triggerBottom: number  // viewport bottom of the trigger band (e.g. rect.bottom)
  anchorX: number        // viewport X to centre the popover horizontally on
}

export interface PopoverDims {
  width: number
  height: number
}

export interface PopoverCoords {
  top: number
  left: number
}

interface Viewport {
  innerWidth: number
  innerHeight: number
}

export function computePopoverCoords(
  anchor: PopoverAnchor,
  dims: PopoverDims,
  viewport: Viewport = window,
): PopoverCoords {
  const { triggerTop, triggerBottom, anchorX } = anchor
  const { width, height } = dims
  const { innerWidth, innerHeight } = viewport

  // Vertical placement: prefer above; flip to below if above doesn't fit;
  // if neither fits, take the larger side. Then clamp into the viewport.
  const spaceAbove = triggerTop - VERTICAL_GAP - VIEWPORT_MARGIN
  const spaceBelow = innerHeight - triggerBottom - VERTICAL_GAP - VIEWPORT_MARGIN
  let top: number
  if (spaceAbove >= height) {
    top = triggerTop - height - VERTICAL_GAP
  } else if (spaceBelow >= height) {
    top = triggerBottom + VERTICAL_GAP
  } else if (spaceAbove >= spaceBelow) {
    top = triggerTop - height - VERTICAL_GAP
  } else {
    top = triggerBottom + VERTICAL_GAP
  }
  const maxTop = innerHeight - height - VIEWPORT_MARGIN
  if (maxTop < VIEWPORT_MARGIN) {
    top = VIEWPORT_MARGIN
  } else {
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop)
  }

  // Horizontal placement: centre on the anchor, then clamp into the viewport.
  let left = anchorX - width / 2
  const maxLeft = innerWidth - width - VIEWPORT_MARGIN
  if (maxLeft < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN
  } else {
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft)
  }

  return { top, left }
}
