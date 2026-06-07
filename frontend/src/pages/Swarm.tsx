import { useState } from 'react'
import { useSwarm, type SetLiveResult } from '../hooks/useSwarm'
import { cn } from '../lib/utils'
import { HelpTip } from '../components/HelpTip'
import { SWARM } from '../lib/helpText'
import type { SwarmChannel, SwarmGateState, SwarmGlobal } from '../types/api'

function humanize(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// INSTRUCTION-296B — the UNKNOWN gate label is context-specific: a GLOBAL
// UNKNOWN is a stale/unreachable fleet read ("No Signal"); a LOCAL UNKNOWN is
// "no authorisation issued yet" ("Standby"). OPEN/CLOSED are unchanged. The
// colour map is identical for both contexts.
const GATE_LABEL: Record<'global' | 'local', Record<SwarmGateState, string>> = {
  global: { OPEN: 'OPEN', CLOSED: 'CLOSED', UNKNOWN: 'No Signal' },
  local: { OPEN: 'OPEN', CLOSED: 'CLOSED', UNKNOWN: 'Standby' },
}

function gateBadge(state: SwarmGateState, context: 'global' | 'local' = 'local') {
  const map: Record<SwarmGateState, string> = {
    UNKNOWN: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    CLOSED: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
    OPEN: 'bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-100',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', map[state] ?? map.UNKNOWN)}>
      {GATE_LABEL[context][state]}
    </span>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className={cn('text-[var(--text)] text-right break-all', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

// Master consumption state badge (294B): the DISPLAY reflects live_active (actual
// consumption), distinct from the control affordances which gate on
// live_enabled/can_enable. Armed-but-suppressed = intent ON, GLOBAL not fresh-Open.
function masterStateLabel(g: SwarmGlobal): { text: string; cls: string } {
  if (g.live_active) {
    return { text: 'Live', cls: 'bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-100' }
  }
  if (g.live_enabled) {
    return {
      text: 'Armed — suppressed (GLOBAL not Open)',
      cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
    }
  }
  return { text: 'Shadow', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' }
}

// INSTRUCTION-294B — Swarm Live Control. GLOBAL gate state + the unit master
// live-enable. The flip is a system-owner action (confirm step, no justification
// field — the unit master takes none); GLOBAL Open only UNLOCKS "Go Live"; a
// stale/Closed/Unknown GLOBAL shows it locked with the reason (Watchdog).
function LiveControlPanel({
  globalState,
  onSetLive,
}: {
  globalState: SwarmGlobal | null
  onSetLive: (enabled: boolean) => Promise<SetLiveResult>
}) {
  // confirming: null = idle; true = confirming Go-Live; false = confirming Return-to-Shadow.
  const [confirming, setConfirming] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const startConfirm = (next: boolean) => {
    setFeedback(null)
    setConfirming(next)
  }

  const handleConfirm = async () => {
    const next = confirming
    if (next === null) return
    setPending(true)
    const res = await onSetLive(next)
    setPending(false)
    setConfirming(null)
    if (res.ok) {
      setFeedback({
        ok: true,
        text: next ? 'Live enabled — this unit will consume swarm priors.' : 'Returned to shadow.',
      })
    } else if (res.status === 409) {
      // Defence-in-depth: the gate closed between render and click.
      setFeedback({ ok: false, text: res.detail ?? 'cannot enable — GLOBAL gate is not Open' })
    } else {
      setFeedback({
        ok: false,
        text: res.detail ? `Request failed: ${res.detail}` : `Request failed (status ${res.status}).`,
      })
    }
  }

  const master = globalState ? masterStateLabel(globalState) : null

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-[var(--text)]">Swarm Live Control</h3>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3 text-sm">
        {/* Fleet GLOBAL gate (fresh state — stale collapses to UNKNOWN server-side) */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--text-muted)]">Fleet GLOBAL gate</span>
          {globalState ? (
            <span className="flex items-center gap-1">
              {gateBadge(globalState.global_gate, 'global')}
              {globalState.global_gate === 'UNKNOWN' && <HelpTip text={SWARM.global_no_signal} size={12} />}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">Loading…</span>
          )}
        </div>

        {/* Unit consumption — reflects live_active (actual), incl. armed-suppressed */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[var(--text-muted)]">Unit consumption</span>
          {master ? (
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', master.cls)}>
              {master.text}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">Loading…</span>
          )}
        </div>

        {/* Control — owner action behind a confirm step */}
        {globalState && (
          <div className="pt-1 space-y-2">
            {confirming !== null ? (
              <div className="space-y-2">
                <p className="text-[var(--text)]">
                  {confirming
                    ? 'Enable live consumption of swarm priors on this unit?'
                    : 'Return this unit to shadow mode?'}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={handleConfirm}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {pending ? 'Working…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirming(null)}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : !globalState.live_enabled ? (
              <div className="space-y-1">
                <button
                  type="button"
                  disabled={!globalState.can_enable}
                  onClick={() => startConfirm(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Go Live
                </button>
                {!globalState.can_enable && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {globalState.global_gate === 'CLOSED'
                      ? 'Locked — fleet GLOBAL gate is Closed'
                      : 'Locked — fleet GLOBAL gate — No Signal (stale / unreachable)'}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg)]"
              >
                Return to Shadow
              </button>
            )}

            {feedback && (
              <p className={cn('text-xs', feedback.ok ? 'text-green-600' : 'text-red-500')}>{feedback.text}</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// INSTRUCTION-296B — the four swarm consumption channels, rendered as
// traffic-light tiles. `cls` keys the 296A /swarm/channels payload; `label` is
// the operator-facing name; `tip` is the HelpTip copy.
type TileStatus = 'in_use' | 'observing' | 'no_data' | 'reserved'

const CHANNEL_META: { cls: string; label: string; tip: string }[] = [
  { cls: 'sysid_priors', label: 'Thermal Envelope', tip: SWARM.thermal_envelope },
  { cls: 'solar_bootstrap', label: 'Solar Capture', tip: SWARM.solar_capture },
  { cls: 'disturbance_relay', label: 'Disturbance Relay', tip: SWARM.disturbance_relay },
  { cls: 'rl_benchmarking', label: 'RL Benchmarking', tip: SWARM.rl_benchmarking },
]

// Traffic-light derivation: reserved (not wired) → no_data (wired, nothing
// cached) → in_use (wired, gate Open, fresh, master live) → otherwise observing
// (received but not applied live). live_active folds the master shadow/live state
// in, so a fresh+gate-Open channel is amber under shadow and green under live.
function channelStatus(ch: SwarmChannel, liveActive: boolean): TileStatus {
  if (!ch.wired) return 'reserved'
  if (ch.data === 'none') return 'no_data'
  if (ch.gate === 'OPEN' && ch.data === 'fresh' && liveActive) return 'in_use'
  return 'observing'
}

const TILE_PRESENTATION: Record<TileStatus, { label: string; dot: string; badge: string }> = {
  in_use: {
    label: 'In use',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-100',
  },
  observing: {
    label: 'Observing',
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
  },
  no_data: {
    label: 'No data',
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100',
  },
  reserved: {
    label: 'Reserved',
    dot: 'bg-gray-400',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  },
}

// One-line sub-label per the §1 table. The observing tail is title-cased gate
// word then a terminal else: fresh+OPEN+live is already in_use, so an OPEN+live
// observing tile is necessarily stale.
function subLabel(status: TileStatus, ch: SwarmChannel, liveActive: boolean): string {
  switch (status) {
    case 'in_use':
      return 'Consuming · gate Open'
    case 'no_data':
      return 'Awaiting data'
    case 'reserved':
      return 'Not yet active'
    case 'observing':
      if (ch.gate !== 'OPEN') return `Received · gate ${ch.gate === 'CLOSED' ? 'Closed' : 'Standby'}`
      if (!liveActive) return 'Received · shadow'
      return 'Received · stale'
  }
}

function statusBadge(status: TileStatus) {
  const meta = TILE_PRESENTATION[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap',
        meta.badge,
      )}
    >
      <span className={cn('w-2 h-2 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}

function ChannelTile({
  meta,
  channel,
  liveActive,
}: {
  meta: { cls: string; label: string; tip: string }
  channel: SwarmChannel | undefined
  liveActive: boolean
}) {
  // The 296A payload always carries the four channels; the guard is type-safety
  // only (a missing channel renders nothing rather than crashing).
  if (!channel) return null
  const status = channelStatus(channel, liveActive)
  const muted = status === 'reserved'
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'flex items-center gap-1 font-medium',
            muted ? 'text-[var(--text-muted)]' : 'text-[var(--text)]',
          )}
        >
          {meta.label}
          <HelpTip text={meta.tip} size={12} />
        </span>
        {statusBadge(status)}
      </div>
      <p className="text-xs text-[var(--text-muted)]">{subLabel(status, channel, liveActive)}</p>
    </div>
  )
}

export function Swarm() {
  const { status, priors, gates, globalState, channels, error, setLive } = useSwarm()

  // Initial load failed before any status arrived.
  if (error && !status) {
    return <p className="text-red-500 p-4">Error: {error}</p>
  }
  // First load in flight.
  if (!status) {
    return <p className="text-[var(--text-muted)] p-4">Loading swarm data…</p>
  }
  // Whole-page disabled state — swarm not enabled on this install.
  if (!status.enabled) {
    return (
      <div className="space-y-2 p-4">
        <h2 className="text-xl font-bold text-[var(--text)]">Swarm</h2>
        <p className="text-[var(--text-muted)]">Swarm is disabled on this install.</p>
      </div>
    )
  }

  const queueEntries = Object.entries(status.queue)
  const gateEntries = gates ? Object.entries(gates.gates) : []
  const liveActive = globalState?.live_active ?? false

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)]">Swarm</h2>
        <p className="text-sm text-[var(--text-muted)]">Per-unit swarm state</p>
      </div>

      {/* Non-blocking banner when a later poll failed but we still have data */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-500">
          Last refresh failed: {error}
        </div>
      )}

      {/* Panel 0 — Swarm Live Control (GLOBAL gate + master live-enable, 294B) */}
      <LiveControlPanel globalState={globalState} onSetLive={setLive} />

      {/* Panel 1 — Identity + Publish status */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-[var(--text)]">Identity &amp; Publish</h3>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2 text-sm">
          <Field label="Unit ID" value={status.unit_id ?? '—'} mono />
          <Field label="Cohort" value={status.cohort_id ?? '—'} />
          <Field label="Endpoint" value={status.endpoint ? status.endpoint : '—'} mono />
          <Field label="Subscribe" value={status.subscribe_enabled ? 'enabled' : 'disabled'} />
          <Field label="In-flight (pending)" value={String(status.pending)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {queueEntries.length === 0 ? (
            <span className="text-sm text-[var(--text-muted)]">No packets in queue.</span>
          ) : (
            queueEntries.map(([bucket, count]) => (
              <div
                key={bucket}
                className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm"
              >
                <span className="text-[var(--text-muted)]">{humanize(bucket)}:</span>{' '}
                <span className="font-medium text-[var(--text)]">{count}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Panel 2 — Received priors (empty-state is the expected steady state) */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-[var(--text)]">Received Priors</h3>
        {!priors ? (
          <p className="text-sm text-[var(--text-muted)]">Loading priors…</p>
        ) : priors.count === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No priors received yet — the prior-consumption path is not live on this install.
          </p>
        ) : (
          <div className="space-y-2">
            {priors.last_etag && (
              <p className="text-xs text-[var(--text-muted)]">
                ETag: <span className="font-mono">{priors.last_etag}</span>
              </p>
            )}
            {priors.family_names.map((fam) => (
              <div key={fam} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm">
                <div className="font-medium text-[var(--text)]">{fam}</div>
                <pre className="text-xs text-[var(--text-muted)] overflow-x-auto">
                  {JSON.stringify(priors.families[fam], null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Panel 3 — Swarm Inputs (traffic-light tile per consumption channel) */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-1 text-base font-semibold text-[var(--text)]">
          Swarm Inputs
          <HelpTip text={SWARM.inputs} size={12} />
        </h3>
        {channels === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading swarm inputs…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {CHANNEL_META.map((meta) => (
              <ChannelTile
                key={meta.cls}
                meta={meta}
                channel={channels.channels[meta.cls]}
                liveActive={liveActive}
              />
            ))}
          </div>
        )}
      </section>

      {/* Panel 4 — LocalGate state (all-UNKNOWN→Standby is normal pre-coordinator) */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-1 text-base font-semibold text-[var(--text)]">
          Local Gates
          <HelpTip text={SWARM.local_standby} size={12} />
        </h3>
        {gateEntries.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Loading gates…</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {gateEntries.map(([cls, state]) => (
              <div
                key={cls}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <span className="text-sm text-[var(--text-muted)]">{humanize(cls)}</span>
                {gateBadge(state, 'local')}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
