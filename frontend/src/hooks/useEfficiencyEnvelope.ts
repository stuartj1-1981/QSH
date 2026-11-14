import { useCallback, useEffect, useState } from 'react'
import type { EfficiencyEnvelopeResponse, EnvelopeResetResult } from '../types/api'
import { apiUrl } from '../lib/api'

/** The poll interval of the envelope card. The learner admits at most one
 *  sample per 30 s cycle and a bin needs 60 samples, so a minute is enough. */
export const ENVELOPE_POLL_MS = 60_000

/** A non-OK response as "HTTP <status> — <detail>", or "HTTP <status>" when
 *  the body is not JSON or holds no string detail. */
async function httpError(r: Response): Promise<string> {
  let detail = `HTTP ${r.status}`
  try {
    const body = await r.json()
    if (body && typeof body.detail === 'string') {
      detail = `${detail} — ${body.detail}`
    }
  } catch {
    // non-JSON error body — the status line is the detail
  }
  return detail
}

/** INSTRUCTION-620B — the heat source efficiency envelope
 *  (`GET /api/envelope`, INSTRUCTION-620A). Read on mount, then every
 *  `pollMs` while the page is visible, and at once on `refresh()`.
 *  A failed read keeps the last good data and sets `error`; a good read
 *  clears `error`. The envelope is not in the live WebSocket stream.
 *  Not named `useEnvelope`: that hook is the building-envelope editor
 *  (INSTRUCTION-112C). */
export function useEfficiencyEnvelope(pollMs: number = ENVELOPE_POLL_MS) {
  const [data, setData] = useState<EfficiencyEnvelopeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1)
    }, pollMs)
    return () => clearInterval(id)
  }, [pollMs])

  useEffect(() => {
    let cancelled = false
    fetch(apiUrl('api/envelope'))
      .then(async (r) => {
        if (!r.ok) throw new Error(await httpError(r))
        return (await r.json()) as EfficiencyEnvelopeResponse
      })
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  return { data, error, loading, refresh }
}

/** INSTRUCTION-620B — `POST /api/envelope/reset`: discards the learned
 *  surfaces (the configured source is kept). A discriminated outcome, so the
 *  caller renders both arms (the 414 outcome-rendering law). */
export async function resetEfficiencyEnvelope(): Promise<
  { ok: true; result: EnvelopeResetResult } | { ok: false; error: string }
> {
  try {
    const r = await fetch(apiUrl('api/envelope/reset'), { method: 'POST' })
    if (!r.ok) return { ok: false, error: await httpError(r) }
    return { ok: true, result: (await r.json()) as EnvelopeResetResult }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
