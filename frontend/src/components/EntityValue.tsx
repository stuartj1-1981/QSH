import type { ReactNode } from 'react'

interface EntityValueProps {
  children: ReactNode
  entityId?: string | null
  engineering?: boolean
  className?: string
}

export function EntityValue({ children, entityId, engineering, className }: EntityValueProps) {
  const showTooltip = !!entityId
  const showUnderline = showTooltip && engineering

  return (
    <span
      title={showTooltip ? entityId : undefined}
      className={className}
      style={showUnderline ? {
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: '2px',
        textDecorationColor: 'var(--text-muted)',
      } : undefined}
    >
      {children}
    </span>
  )
}
