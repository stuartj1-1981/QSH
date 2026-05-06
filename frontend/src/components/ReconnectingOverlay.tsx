import { useEffect, useState } from 'react'

interface ReconnectingOverlayProps {
  disconnectedSince: number | null
}

type OverlayState = 'hidden' | 'reconnecting' | 'restart-in-progress'

const SHOW_AFTER_MS = 3000
const ESCALATE_AFTER_MS = 10000

export function ReconnectingOverlay({ disconnectedSince }: ReconnectingOverlayProps) {
  if (disconnectedSince === null) return null
  // Keying the inner component by `disconnectedSince` resets its state on
  // every new disconnect, so the inner can compute initial state via the
  // useState initializer (one-shot, allowed to read Date.now()) without
  // ever calling setState synchronously inside an effect body.
  return <ReconnectingOverlayInner key={disconnectedSince} disconnectedSince={disconnectedSince} />
}

function ReconnectingOverlayInner({ disconnectedSince }: { disconnectedSince: number }) {
  const [state, setState] = useState<OverlayState>(() => {
    const elapsed = Date.now() - disconnectedSince
    if (elapsed >= ESCALATE_AFTER_MS) return 'restart-in-progress'
    if (elapsed >= SHOW_AFTER_MS) return 'reconnecting'
    return 'hidden'
  })

  useEffect(() => {
    const elapsed = Date.now() - disconnectedSince
    const showTimer = elapsed < SHOW_AFTER_MS
      ? setTimeout(() => setState('reconnecting'), SHOW_AFTER_MS - elapsed)
      : null
    const escalateTimer = elapsed < ESCALATE_AFTER_MS
      ? setTimeout(() => setState('restart-in-progress'), ESCALATE_AFTER_MS - elapsed)
      : null
    return () => {
      if (showTimer) clearTimeout(showTimer)
      if (escalateTimer) clearTimeout(escalateTimer)
    }
  }, [disconnectedSince])

  if (state === 'hidden') return null

  const escalated = state === 'restart-in-progress'
  const heading = escalated ? 'Restart in progress' : 'Reconnecting'
  const subtext = escalated
    ? 'The pipeline is restarting. This usually takes a minute or two. The page will reload data automatically when ready.'
    : 'Lost connection to the QSH backend. Trying to reconnect…'

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/80 backdrop-blur-sm"
    >
      <div className="max-w-md mx-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-3 w-3 rounded-full bg-[var(--amber)] animate-pulse" />
          <h2 className="text-lg font-semibold text-[var(--text)]">{heading}</h2>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{subtext}</p>
      </div>
    </div>
  )
}
