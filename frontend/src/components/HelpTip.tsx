import { useState, useRef, useEffect, useCallback } from 'react'
import { HelpCircle, X } from 'lucide-react'

interface HelpTipProps {
  text: string
  size?: number
  className?: string
}

export function HelpTip({ text, size = 14, className }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(true)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const reposition = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setAbove(rect.top > 120)
  }, [])

  useEffect(() => {
    if (!open) return
    reposition()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const handleClick = (e: MouseEvent) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open, reposition])

  return (
    <span className={`relative inline-flex items-center ${className ?? ''}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        aria-label="Help"
      >
        <HelpCircle size={size} />
      </button>
      {open && (
        <div
          ref={popRef}
          className={`absolute z-50 w-56 p-3 rounded-lg shadow-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text)] ${
            above ? 'bottom-full mb-2' : 'top-full mt-2'
          } left-1/2 -translate-x-1/2`}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-1 right-1 text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            <X size={12} />
          </button>
          <p className="pr-4 leading-relaxed">{text}</p>
        </div>
      )}
    </span>
  )
}
