// INSTRUCTION-572D — the contact delay of a room's window sensor (569A).

/** The range that the loader keeps (qsh/config.py clamps the delay to it). */
export const WINDOW_OPEN_DELAY_MIN_S = 0
export const WINDOW_OPEN_DELAY_MAX_S = 600

/** The delay to store for the text of the field: a whole number of seconds
 *  in the range. An empty field, and text that is not a finite number, give
 *  undefined, which removes the key; QSH then uses 60 seconds. */
export function parseWindowOpenDelay(text: string): number | undefined {
  if (text.trim() === '') return undefined
  const seconds = Number(text)
  if (!Number.isFinite(seconds)) return undefined
  return Math.min(WINDOW_OPEN_DELAY_MAX_S, Math.max(WINDOW_OPEN_DELAY_MIN_S, Math.round(seconds)))
}
