// 228B Task 3 — chip text per backend reason Literal.
//
// Adding a new SourceSelectionReasonKind in api.ts requires a matching
// entry here — the per-Literal parametrised test in
// StatusBanner.test.tsx pins this surface 1-to-1.
//
// Lives in lib/ rather than alongside StatusBanner.tsx because the
// component file is subject to Vite fast-refresh constraints that
// reject sibling non-component exports.
import type { SourceSelectionReasonKind } from '../types/api'

export const SOURCE_REASON_CHIP_TEXT: Record<SourceSelectionReasonKind, string> = {
  cost:            'Cost',
  carbon:          'Carbon',
  manual_lock:     'Locked',
  failover:        'Failover',
  dwell_hold:      'Hold (dwell)',
  deadband_hold:   'Hold (close)',
  daily_cap_hold:  'Hold (cap)',
  single_source:   '',  // badge hidden — see ActiveSourceBadge render gate
}
