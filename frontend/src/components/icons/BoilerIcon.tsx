// 228B Task 3 — minimal boiler glyph (flame). Covers gas / LPG / oil boiler
// types. Sized via `size` prop in px; inherits `color` via currentColor.
interface BoilerIconProps {
  size?: number
  className?: string
  'data-testid'?: string
}

export function BoilerIcon({ size = 14, className, ...rest }: BoilerIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path
        d="M12 2 C 11 6, 7 7, 7 12 C 7 17, 10 20, 12 21 C 14 20, 17 17, 17 12 C 17 9, 14 8, 13.5 5 C 13 7, 12.5 7.5, 12 6 Z"
        fill="currentColor"
      />
    </svg>
  )
}
