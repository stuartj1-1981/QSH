// SysID constants mirrored from qsh/sysid.py.
//
// IMPORTANT: These values MUST be kept in sync with the cited Python source.
// If a constant in qsh/sysid.py is tuned, update the matching value here in
// the same change-set and update any tooltip prose that quotes the value.
// See INSTRUCTION-214 Task 0 for the verification protocol.
//
// INSTRUCTION-418, INSTRUCTION-570N — every mirrored constant carries a
// structured `@source <path>::<NAME>` tag that names the Python constant.
// The tag is machine-checked by __tests__/sysidConstants.source.test.ts:
// the cited file must define NAME once at module level, with the value
// mirrored here. The tag names the constant and not a line, so an edit
// that moves lines in qsh/sysid.py does not break it; an edit that changes
// a value or renames a constant does.

/** Minimum observations before the learned value is used at all.
 *  @source qsh/sysid.py::MIN_OBS_FOR_USE */
export const MIN_OBS_FOR_USE = 10

/** Accepted-U-observation count at which the per-room confidence badge
 *  reaches High (and the historical full-confidence reference). Defined
 *  source-side in qsh/sysid.py as CONFIDENCE_FULL_AT (INSTRUCTION-416).
 *  @source qsh/sysid.py::CONFIDENCE_FULL_AT */
export const CONFIDENCE_FULL_AT = 100

/** Minimum R² for a passive-cooling window fit to be accepted.
 *  @source qsh/sysid.py::PC_FIT_R_SQUARED_MIN */
export const PC_FIT_R_SQUARED_MIN = 0.8

/** INSTRUCTION-573B — the longest interval between two readings that the
 *  event U read uses [s]; the Engineering U ledger's 'window' class.
 *  @source qsh/sysid.py::MAX_EVENT_WINDOW_S */
export const MAX_EVENT_WINDOW_S = 7200

/** INSTRUCTION-573B — the fastest cooling that the event U read admits
 *  [°C/h]; the Engineering U ledger's 'rate' class.
 *  @source qsh/sysid.py::MAX_U_RATE_C_PER_H */
export const MAX_U_RATE_C_PER_H = 5.0
