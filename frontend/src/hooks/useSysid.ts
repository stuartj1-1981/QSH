import { useEffect, useState } from 'react'
import type { SysidResponse, SysidRoomDetail, SysidResetResult } from '../types/api'
import { apiUrl } from '../lib/api'

export function useSysid() {
  const [data, setData] = useState<SysidResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(apiUrl('api/sysid'))
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  return { data, error }
}

/** INSTRUCTION-415 — detailed per-room SysID state (`/api/sysid/{room}`),
 *  fetched lazily when `room` is non-null (the Engineering room-detail
 *  expansion). Carries the per-room U-candidate rejection ledger inside
 *  `gate_stats` under `room_`-prefixed keys. */
export function useSysidRoom(room: string | null, refreshKey = 0) {
  // Keyed by room so switching rooms never shows the previous room's data —
  // the derived values below return null until the fetch for the CURRENT
  // room resolves (no synchronous state reset needed in the effect body).
  // Bumping refreshKey refetches the same room (INSTRUCTION-422 — after a
  // reset the ledger and counts must show the fresh state).
  const [state, setState] = useState<{
    room: string
    data?: SysidRoomDetail
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!room) return
    let cancelled = false
    fetch(apiUrl(`api/sysid/${encodeURIComponent(room)}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => {
        if (!cancelled) setState({ room, data: d })
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ room, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [room, refreshKey])

  const current = room && state && state.room === room ? state : null
  return { data: current?.data ?? null, error: current?.error ?? null }
}

/** INSTRUCTION-422 — POST /api/sysid/{room}/reset. Returns a discriminated
 *  outcome so the caller renders BOTH arms (the 414 outcome-rendering law:
 *  no silent success, no silent failure — the 503/404 arms surface their
 *  detail verbatim). */
export async function resetSysidRoom(
  room: string,
): Promise<{ ok: true; result: SysidResetResult } | { ok: false; error: string }> {
  try {
    const r = await fetch(
      apiUrl(`api/sysid/${encodeURIComponent(room)}/reset`),
      { method: 'POST' },
    )
    if (!r.ok) {
      let detail = `HTTP ${r.status}`
      try {
        const body = await r.json()
        if (body && typeof body.detail === 'string') {
          detail = `${detail} — ${body.detail}`
        }
      } catch {
        // non-JSON error body — the status line is the detail
      }
      return { ok: false, error: detail }
    }
    return { ok: true, result: (await r.json()) as SysidResetResult }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
