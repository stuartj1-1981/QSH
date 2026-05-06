import type { RoomConfigYaml } from '../types/config'

/** INSTRUCTION-172 V2 LOW finding — preserve user-typed `fixed_setpoint` in
 *  component state across `control_mode` toggles, but conditionally omit it
 *  from the API payload when `control_mode !== 'none'`. The backend's
 *  cross-field validator rejects the combination; this strip ensures we
 *  don't send a guaranteed 422 for a value the user might still want when
 *  they toggle back. */
export function stripFixedSetpointForControlMode(
  room: RoomConfigYaml,
): RoomConfigYaml {
  if (room.fixed_setpoint === undefined) return room
  if (room.control_mode === 'none') return room
  const copy = { ...room }
  delete copy.fixed_setpoint
  return copy
}
