/** Convert "HH:MM:SS" to a slot index (0-95, 15-minute resolution). */
export function timeToSlot(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return Math.round((h * 60 + m) / 15)
}

/** Convert a slot index (0-96) to "HH:MM:SS". */
export function slotToTime(slot: number): string {
  const clamped = Math.max(0, Math.min(96, slot))
  const totalMin = clamped * 15
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/** Format "HH:MM:SS" to "HH:MM" for display. */
export function formatTime(time: string): string {
  return time.slice(0, 5)
}
