// 228B Task 3 — minimal heat-pump glyph (compressor / fan disc).
// Sized via `size` prop in px; inherits `color` via currentColor.
interface HeatPumpIconProps {
  size?: number
  className?: string
  'data-testid'?: string
}

export function HeatPumpIcon({ size = 14, className, ...rest }: HeatPumpIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <circle cx={12} cy={12} r={9} />
      <path d="M12 5 L14 9 L10 9 Z" fill="currentColor" stroke="none" />
      <path d="M19 12 L15 14 L15 10 Z" fill="currentColor" stroke="none" />
      <path d="M12 19 L10 15 L14 15 Z" fill="currentColor" stroke="none" />
      <path d="M5 12 L9 10 L9 14 Z" fill="currentColor" stroke="none" />
      <circle cx={12} cy={12} r={1.5} fill="currentColor" stroke="none" />
    </svg>
  )
}
