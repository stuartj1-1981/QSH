// SysID constants mirrored from qsh/sysid.py.
//
// IMPORTANT: These values MUST be kept in sync with the cited Python source.
// If a constant in qsh/sysid.py is tuned, update the matching value here in
// the same change-set and update any tooltip prose that quotes the value.
// See INSTRUCTION-214 Task 0 for the verification protocol.

/** Minimum observations before the learned value is used at all (qsh/sysid.py:51). */
export const MIN_OBS_FOR_USE = 10

/** Observation count at which u_confidence reaches 1.0 (qsh/sysid.py:325, denominator of `u_observations / 100`). */
export const CONFIDENCE_FULL_AT = 100

/** Minimum R² for a passive-cooling window fit to be accepted (qsh/sysid.py:261). */
export const PC_FIT_R_SQUARED_MIN = 0.8
