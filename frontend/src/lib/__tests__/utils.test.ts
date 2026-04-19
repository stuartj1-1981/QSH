import { describe, it, expect } from 'vitest'
import { formatTimeRange } from '../utils'

// Use fixed UTC epochs (seconds). Node vitest runs with TZ from the
// environment; we build dates explicitly from UTC then compare against the
// rendered local time. To keep the output stable we assert on the arrow
// separator and the HH:mm shape rather than pinning the exact locale output.

describe('formatTimeRange', () => {
  it('returns HH:mm → HH:mm for a same-day range', () => {
    // 2026-04-15 08:00 UTC → 2026-04-15 11:30 UTC (12600s apart)
    const start = Date.UTC(2026, 3, 15, 8, 0, 0) / 1000
    const end = Date.UTC(2026, 3, 15, 11, 30, 0) / 1000
    const out = formatTimeRange(start, end)
    expect(out).toMatch(/^\d{2}:\d{2} \u2192 \d{2}:\d{2}$/)
    // Arrow is Unicode RIGHT ARROW, not ASCII.
    expect(out).toContain('\u2192')
    expect(out).not.toContain('->')
  })

  it('appends a day suffix when the range crosses midnight', () => {
    // 24 hours apart centred on noon UTC. formatTimeRange compares LOCAL
    // calendar days via toDateString(), so the inputs must land on two
    // different local days in every real TZ. Worst-case TZ offset is ±14h
    // from UTC, so a 24h span centred on noon UTC always straddles two local
    // calendar days. (Previous revision used 23:30 UTC → 12:15 UTC next day,
    // which under Europe/London BST = UTC+1 collapsed to a single local day.)
    const start = Date.UTC(2026, 3, 15, 12, 0, 0) / 1000
    const end = Date.UTC(2026, 3, 16, 12, 0, 0) / 1000
    const out = formatTimeRange(start, end)
    // Must include a parenthesised day-month suffix after the end time.
    expect(out).toMatch(/\u2192 \d{2}:\d{2} \(.+\)$/)
  })

  it('does not crash when start equals end', () => {
    const t = Date.UTC(2026, 3, 15, 12, 0, 0) / 1000
    const out = formatTimeRange(t, t)
    expect(out).toMatch(/^\d{2}:\d{2} \u2192 \d{2}:\d{2}$/)
  })
})
