// INSTRUCTION-526B T1 — shared room-label helper.
//
// A room's display_name is a user-typed label; the key is its identity. When a
// display_name is set, both exports return it verbatim (trimmed only) — never
// re-cased, since the user chose that casing deliberately. Otherwise each
// returns the same string the twelve pre-existing inline derivations produced,
// so a room with no display_name renders byte-identically to today.

interface RoomLike {
  display_name?: string | null
}

export function roomLabel(key: string, room?: RoomLike | null): string {
  const label = room?.display_name?.trim()
  if (label) {
    return label
  }
  return key.replace(/_/g, ' ')
}

export function roomLabelTitleCase(key: string, room?: RoomLike | null): string {
  const label = room?.display_name?.trim()
  if (label) {
    return label
  }
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
