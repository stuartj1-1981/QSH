import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, X } from 'lucide-react'

const POPOVER_WIDTH = 224           // matches Tailwind w-56
const VIEWPORT_MARGIN = 8           // px gutter from viewport edges
const VERTICAL_GAP = 8              // px gap between trigger and popover
const VERTICAL_FLIP_THRESHOLD = 160 // px below which we flip default 'above' to 'below'

interface HelpTipProps {
  text: string
  size?: number
  className?: string
}

export function HelpTip({ text, size = 14, className }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  const close = useCallback(() => {
    setOpen(false)
    setCoords(null)
  }, [])

  // Callback ref: fires during commit when the popover mounts. Measures the
  // trigger + popover synchronously before paint, then setCoords triggers a
  // pre-paint re-render with the final position. The popover is rendered with
  // visibility: hidden until coords are populated, so the user only ever sees
  // the final placement (no flicker).
  const measurePopover = useCallback((node: HTMLDivElement | null) => {
    popRef.current = node
    if (!node || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const popHeight = node.offsetHeight
    const placement = rect.top >= VERTICAL_FLIP_THRESHOLD ? 'above' : 'below'
    const top = placement === 'above'
      ? rect.top - popHeight - VERTICAL_GAP
      : rect.bottom + VERTICAL_GAP
    const triggerCenterX = rect.left + rect.width / 2
    let left = triggerCenterX - POPOVER_WIDTH / 2
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
    if (maxLeft < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN
    } else {
      left = Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft)
    }
    setCoords({ top, left })
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const handleClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) close()
    }
    // capture mode: catches nested scroll containers (e.g. table overflow-x-auto on Balancing)
    const handleScroll = () => close()
    const handleResize = () => close()
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open, close])

  return (
    <span className={`inline-flex items-center ${className ?? ''}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        aria-label="Help"
        aria-describedby={open ? popoverId : undefined}
      >
        <HelpCircle size={size} />
      </button>
      {open && createPortal(
        <div
          ref={measurePopover}
          id={popoverId}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            width: POPOVER_WIDTH,
            visibility: coords ? 'visible' : 'hidden',
          }}
          className="z-[60] p-3 rounded-lg shadow-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text)]"
        >
          <button
            type="button"
            onClick={close}
            className="absolute top-1 right-1 text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            <X size={12} />
          </button>
          <p className="pr-4 leading-relaxed">{text}</p>
        </div>,
        document.body,
      )}
    </span>
  )
}
