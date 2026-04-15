import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTemp(temp: number | null | undefined): string {
  if (temp === null || temp === undefined) return '--'
  return `${temp.toFixed(1)}°`
}

export function formatPower(kw: number): string {
  if (kw < 0.01) return '0W'
  if (kw < 1) return `${(kw * 1000).toFixed(0)}W`
  return `${kw.toFixed(1)}kW`
}

export function statusColor(status: string): string {
  switch (status) {
    case 'ok': return 'text-[var(--green)]'
    case 'heating': return 'text-[var(--amber)]'
    case 'cold': return 'text-[var(--red)]'
    case 'away': return 'text-[var(--blue)]'
    default: return 'text-[var(--text-muted)]'
  }
}

export function statusBg(status: string): string {
  switch (status) {
    case 'ok': return 'bg-green-500/10 border-green-500/20'
    case 'heating': return 'bg-amber-500/10 border-amber-500/20'
    case 'cold': return 'bg-red-500/10 border-red-500/20'
    case 'away': return 'bg-blue-500/10 border-blue-500/20'
    default: return 'bg-gray-500/10 border-gray-500/20'
  }
}

// Convention: `startEpoch` and `endEpoch` are epoch SECONDS (matching
// HistoryPoint.t, which is populated from Python time.time()). We multiply
// by 1000 locally before constructing Date objects.
// The separator is U+2192 RIGHT ARROW — do NOT substitute ASCII fallbacks.
export function formatTimeRange(startEpoch: number, endEpoch: number): string {
  const start = new Date(startEpoch * 1000)
  const end = new Date(endEpoch * 1000)
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const startTime = timeFmt.format(start)
  const endTime = timeFmt.format(end)
  const sameDay = start.toDateString() === end.toDateString()
  if (sameDay) {
    return `${startTime} \u2192 ${endTime}`
  }
  const dayFmt = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  })
  return `${startTime} \u2192 ${endTime} (${dayFmt.format(end)})`
}
