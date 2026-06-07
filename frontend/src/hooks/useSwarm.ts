import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type {
  SwarmStatus,
  SwarmPriors,
  SwarmDivergence,
  SwarmGates,
  SwarmGlobal,
  SwarmChannels,
} from '../types/api'

// INSTRUCTION-294B — hook-owned contract guard for GET /api/swarm/global. The
// four-field fresh contract is what 294B consumes; route presence alone is not
// enough (B-3). A payload missing live_active/live_enabled/can_enable, or with
// an out-of-set global_gate, is rejected by throwing — funnelled to `error` and
// surfaced in the page banner — so a 294A↔294B drift fails LOUDLY, never as a
// falsy default that renders "Armed — suppressed" forever. No `as any`: probe
// the unknown via Record<string, unknown>.
function isSwarmGlobal(d: unknown): d is SwarmGlobal {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Record<string, unknown>
  return (
    typeof o.live_enabled === 'boolean' &&
    typeof o.live_active === 'boolean' &&
    typeof o.can_enable === 'boolean' &&
    (o.global_gate === 'OPEN' || o.global_gate === 'CLOSED' || o.global_gate === 'UNKNOWN')
  )
}

// Result of a master live-enable POST — never throws to the caller, so the page
// can render success / 409 (gate not Open) / network failure as distinct
// messages rather than a conflated error.
export interface SetLiveResult {
  ok: boolean
  status: number
  detail: string | null
}

// INSTRUCTION-289B — poll the unit-side swarm read surface (289A's four GET
// routes), extended at 294B with a fifth GET (GLOBAL gate + master live-enable)
// and a setLive POST. This is slow-changing engineering data, so a 30s REST poll
// against the dedicated routes is correct; the live WebSocket is intentionally
// NOT used (rollout F-1 lesson: stream only genuinely-live high-cadence data).
// Mirrors the useQuarantine fetch/poll/error idiom — every URL via the
// ingress-aware apiUrl(), errors surfaced to state (never console).
export function useSwarm() {
  const [status, setStatus] = useState<SwarmStatus | null>(null)
  const [priors, setPriors] = useState<SwarmPriors | null>(null)
  const [divergence, setDivergence] = useState<SwarmDivergence | null>(null)
  const [gates, setGates] = useState<SwarmGates | null>(null)
  const [globalState, setGlobalState] = useState<SwarmGlobal | null>(null)
  const [channels, setChannels] = useState<SwarmChannels | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    const getJson = (path: string) => fetch(apiUrl(path)).then((r) => r.json())
    // Each endpoint is independent: a successful fetch populates its datum even
    // if a sibling fails. The composed catch funnels any failure to `error` so
    // there is no unhandled rejection; a fully-successful poll clears it.
    Promise.all([
      getJson('api/swarm/status').then((d) => setStatus(d as SwarmStatus)),
      getJson('api/swarm/priors').then((d) => setPriors(d as SwarmPriors)),
      getJson('api/swarm/divergence').then((d) => setDivergence(d as SwarmDivergence)),
      getJson('api/swarm/gates').then((d) => setGates(d as SwarmGates)),
      getJson('api/swarm/channels').then((d) => setChannels(d as SwarmChannels)),
      getJson('api/swarm/global').then((d) => {
        if (!isSwarmGlobal(d)) {
          throw new Error(
            'malformed /api/swarm/global payload (missing live_active / live_enabled / can_enable / global_gate)',
          )
        }
        setGlobalState(d)
      }),
    ])
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Master live-enable toggle (294A POST /api/swarm/live). Mirrors the Balancing
  // PATCH-then-refetch idiom; returns the structured result and never throws so
  // the page can distinguish 409 (gate not Open) from a network failure.
  const setLive = useCallback(
    async (enabled: boolean): Promise<SetLiveResult> => {
      try {
        const res = await fetch(apiUrl('api/swarm/live'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        })
        let detail: string | null = null
        if (res.ok) {
          fetchData() // refetch so live_enabled/live_active reflect the new state
        } else {
          const body = (await res.json().catch(() => ({}))) as { detail?: unknown }
          detail = typeof body.detail === 'string' ? body.detail : null
        }
        return { ok: res.ok, status: res.status, detail }
      } catch (e: unknown) {
        return { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) }
      }
    },
    [fetchData],
  )

  return { status, priors, divergence, gates, globalState, channels, error, refetch: fetchData, setLive }
}
