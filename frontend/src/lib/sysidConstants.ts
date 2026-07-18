// SysID constants mirrored from qsh/sysid.py.
//
// IMPORTANT: These values MUST be kept in sync with the cited Python source.
// If a constant in qsh/sysid.py is tuned, update the matching value here in
// the same change-set and update any tooltip prose that quotes the value.
// See INSTRUCTION-214 Task 0 for the verification protocol.
//
// INSTRUCTION-418 — every mirrored constant carries a structured
// `@source <path>:<line>` tag pointing at the line that DEFINES the cited
// Python constant. The tag is machine-checked by
// __tests__/sysidConstants.source.test.ts: the cited line must contain the
// constant's name and value, so citation drift fails the suite instead of
// waiting for the next field diagnosis. When an edit to qsh/sysid.py moves
// a cited line, refresh the tag in the same change-set.

/** Minimum observations before the learned value is used at all.
 *  @source qsh/sysid.py:128 */
export const MIN_OBS_FOR_USE = 10

/** Accepted-U-observation count at which the per-room confidence badge
 *  reaches High (and the historical full-confidence reference). Defined
 *  source-side in qsh/sysid.py as CONFIDENCE_FULL_AT (INSTRUCTION-416).
 *  @source qsh/sysid.py:135 */
export const CONFIDENCE_FULL_AT = 100

/** Minimum R² for a passive-cooling window fit to be accepted.
 *  @source qsh/sysid.py:177 */
export const PC_FIT_R_SQUARED_MIN = 0.8
