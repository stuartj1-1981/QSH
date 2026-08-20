const PRESENCE_KEYWORDS = ['mmwave', 'radar', 'presence', 'ld2410', 'fp2']
const MOTION_KEYWORDS = ['pir', 'motion', 'movement']

/** Suggest an occupancy sensor class from HA metadata. Returns null when
 *  the evidence is not good enough to say anything — the honest default,
 *  since a wrong hint is worse than no hint. Never writes; the caller
 *  renders this as text only (owner ruling, 18 August 2026). */
export function suggestOccupancyClass(
  entityId: string | undefined,
  deviceClass: string | undefined,
): 'motion' | 'presence' | null {
  if (deviceClass === 'occupancy' || deviceClass === 'presence') return 'presence'
  if (deviceClass === 'motion') return 'motion'

  if (entityId) {
    const idLower = entityId.toLowerCase()
    const isPresence = PRESENCE_KEYWORDS.some((kw) => idLower.includes(kw))
    const isMotion = MOTION_KEYWORDS.some((kw) => idLower.includes(kw))
    // A device advertising both is a presence device with a motion-compatible
    // name, not the reverse — presence wins on collision.
    if (isPresence) return 'presence'
    if (isMotion) return 'motion'
  }

  return null
}
