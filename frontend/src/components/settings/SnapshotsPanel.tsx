import { useState, useCallback } from 'react'
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useSnapshots } from '../../hooks/useSnapshots'
import { cn } from '../../lib/utils'
import type { DiffEntry, Snapshot } from '../../types/api'

/**
 * Engineering / settings panel exposing the pre-write configuration
 * snapshot mechanism (INSTRUCTION-192). Operator workflow:
 *
 *   1. Open the panel — see retained snapshots, newest first.
 *   2. Click "View diff" on a row — see the structured diff.
 *      Secret-bearing rows are visually marked (lock icon, distinct
 *      background) but values are NOT redacted — operator value
 *      visibility is required for informed revert decisions.
 *   3. Click "Revert" — type the snapshot timestamp verbatim to confirm.
 *   4. Optionally "Purge all snapshots" for post-credential-rotation
 *      cleanup; type PURGE_ALL to confirm.
 */
export function SnapshotsPanel() {
  const { data, error, loading, refetch, fetchDiff, revert, purge } =
    useSnapshots()

  const [collapsed, setCollapsed] = useState(true)
  const [diffSnapshot, setDiffSnapshot] = useState<Snapshot | null>(null)
  const [diffEntries, setDiffEntries] = useState<DiffEntry[] | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [confirmingRevert, setConfirmingRevert] = useState(false)
  const [revertInput, setRevertInput] = useState('')
  const [revertInFlight, setRevertInFlight] = useState(false)
  const [revertResult, setRevertResult] = useState<string | null>(null)

  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeInput, setPurgeInput] = useState('')
  const [purgeInFlight, setPurgeInFlight] = useState(false)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)

  const openDiff = useCallback(
    async (snap: Snapshot) => {
      setDiffSnapshot(snap)
      setDiffEntries(null)
      setDiffError(null)
      setDiffLoading(true)
      setConfirmingRevert(false)
      setRevertInput('')
      setRevertResult(null)
      try {
        const entries = await fetchDiff(snap.snapshot_id)
        setDiffEntries(entries)
      } catch (e) {
        setDiffError(e instanceof Error ? e.message : String(e))
      } finally {
        setDiffLoading(false)
      }
    },
    [fetchDiff],
  )

  const closeDiff = useCallback(() => {
    setDiffSnapshot(null)
    setDiffEntries(null)
    setDiffError(null)
    setConfirmingRevert(false)
    setRevertInput('')
    setRevertResult(null)
  }, [])

  const submitRevert = useCallback(async () => {
    if (!diffSnapshot) return
    setRevertInFlight(true)
    setRevertResult(null)
    try {
      const res = await revert(diffSnapshot.snapshot_id, revertInput)
      setRevertResult(
        `Reverted to ${res.reverted_to.snapshot_id}. Restart triggered.`,
      )
      setConfirmingRevert(false)
      setRevertInput('')
    } catch (e) {
      setRevertResult(
        `Revert failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setRevertInFlight(false)
    }
  }, [diffSnapshot, revert, revertInput])

  const submitPurge = useCallback(async () => {
    setPurgeInFlight(true)
    setPurgeResult(null)
    try {
      const count = await purge()
      setPurgeResult(`Purged ${count} snapshot${count === 1 ? '' : 's'}.`)
      setPurgeOpen(false)
      setPurgeInput('')
    } catch (e) {
      setPurgeResult(
        `Purge failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setPurgeInFlight(false)
    }
  }, [purge])

  const copyId = useCallback((id: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(id).catch(() => {
        /* clipboard denied — non-fatal, operator can still type */
      })
    }
  }, [])

  const retentionCount = data?.retention_count ?? 5
  const snapshots = data?.snapshots ?? []
  const revertConfirmed =
    diffSnapshot !== null && revertInput === diffSnapshot.snapshot_id
  const purgeConfirmed = purgeInput === 'PURGE_ALL'

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg)]/50"
      >
        <div className="flex items-center gap-2">
          <Camera size={16} className="text-[var(--text-muted)]" />
          <span className="font-medium text-[var(--text)]">
            Configuration Snapshots
          </span>
          {!loading && (
            <span className="text-xs text-[var(--text-muted)]">
              ({snapshots.length} retained)
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronRight size={16} className="text-[var(--text-muted)]" />
        ) : (
          <ChevronDown size={16} className="text-[var(--text-muted)]" />
        )}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 border-t border-[var(--border)]">
          <p className="mt-3 text-sm text-[var(--text)]">
            <strong>Retaining the last {retentionCount} snapshots.</strong>{' '}
            Older snapshots are automatically deleted when this limit is
            exceeded.
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Snapshots include all configuration including credentials.
            After rotating credentials, use Purge to remove older
            snapshots that contain the rotated value. State files
            (sysid_state.json, historian data, schedules) are NOT
            captured by this mechanism.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={refetch}
              className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm text-[var(--red)]">
              Failed to load snapshots: {error}
            </p>
          )}

          {loading && (
            <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          )}

          {!loading && !error && snapshots.length === 0 && (
            <p className="mt-4 text-sm text-[var(--text-muted)]">
              No snapshots yet. The next config change captures one.
            </p>
          )}

          {!loading && snapshots.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg)]/30 text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">
                      Captured
                    </th>
                    <th className="text-left px-3 py-2 font-medium">Trigger</th>
                    <th className="text-right px-3 py-2 font-medium">Size</th>
                    <th className="text-right px-3 py-2 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr
                      key={s.snapshot_id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-2 align-top">
                        <div
                          className="text-[var(--text)]"
                          title={s.snapshot_id}
                        >
                          {formatHumanTimestamp(s.captured_at)}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] font-mono truncate max-w-[280px]">
                          {s.snapshot_id}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-[var(--text-muted)]">
                        {s.trigger_path}
                      </td>
                      <td className="px-3 py-2 align-top text-right text-[var(--text-muted)]">
                        {formatBytes(s.size_bytes)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => copyId(s.snapshot_id)}
                            className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                            title="Copy snapshot ID"
                            aria-label="Copy snapshot ID"
                          >
                            <Copy size={12} />
                            Copy ID
                          </button>
                          <button
                            type="button"
                            onClick={() => openDiff(s)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
                          >
                            View diff
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {snapshots.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border)]">
              {!purgeOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setPurgeOpen(true)
                    setPurgeResult(null)
                  }}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-red-500/10 text-[var(--red)] hover:bg-red-500/20"
                >
                  <Trash2 size={12} />
                  Purge all snapshots
                </button>
              ) : (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-3">
                  <p className="text-sm text-[var(--text)]">
                    To confirm, type the literal string{' '}
                    <code className="px-1 rounded bg-[var(--bg)] font-mono">
                      PURGE_ALL
                    </code>
                    :
                  </p>
                  <input
                    type="text"
                    value={purgeInput}
                    onChange={(e) => setPurgeInput(e.target.value)}
                    placeholder="PURGE_ALL"
                    className="mt-2 w-full px-3 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] font-mono"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!purgeConfirmed || purgeInFlight}
                      onClick={submitPurge}
                      className={cn(
                        'inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded',
                        purgeConfirmed && !purgeInFlight
                          ? 'bg-[var(--red)] text-white hover:opacity-90'
                          : 'bg-gray-500/20 text-[var(--text-muted)] cursor-not-allowed',
                      )}
                    >
                      {purgeInFlight && (
                        <Loader2 size={12} className="animate-spin" />
                      )}
                      Confirm purge
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPurgeOpen(false)
                        setPurgeInput('')
                      }}
                      className="text-xs px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {purgeResult && (
                <p className="mt-2 text-sm text-[var(--text)]">{purgeResult}</p>
              )}
            </div>
          )}
        </div>
      )}

      {diffSnapshot && (
        <DiffModal
          snapshot={diffSnapshot}
          entries={diffEntries}
          loading={diffLoading}
          error={diffError}
          confirmingRevert={confirmingRevert}
          revertInput={revertInput}
          revertConfirmed={revertConfirmed}
          revertInFlight={revertInFlight}
          revertResult={revertResult}
          onClose={closeDiff}
          onStartRevert={() => setConfirmingRevert(true)}
          onCancelRevert={() => {
            setConfirmingRevert(false)
            setRevertInput('')
          }}
          onChangeRevertInput={setRevertInput}
          onSubmitRevert={submitRevert}
        />
      )}
    </section>
  )
}

interface DiffModalProps {
  snapshot: Snapshot
  entries: DiffEntry[] | null
  loading: boolean
  error: string | null
  confirmingRevert: boolean
  revertInput: string
  revertConfirmed: boolean
  revertInFlight: boolean
  revertResult: string | null
  onClose: () => void
  onStartRevert: () => void
  onCancelRevert: () => void
  onChangeRevertInput: (s: string) => void
  onSubmitRevert: () => void
}

function DiffModal({
  snapshot,
  entries,
  loading,
  error,
  confirmingRevert,
  revertInput,
  revertConfirmed,
  revertInFlight,
  revertResult,
  onClose,
  onStartRevert,
  onCancelRevert,
  onChangeRevertInput,
  onSubmitRevert,
}: DiffModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl bg-[var(--card-bg)] shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text)]">Snapshot diff</h3>
            <p className="text-xs text-[var(--text-muted)] font-mono">
              {snapshot.snapshot_id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close diff"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              Computing diff…
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--red)]">Failed to load diff: {error}</p>
          )}

          {!loading && !error && entries !== null && entries.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No differences — snapshot matches the current configuration.
            </p>
          )}

          {!loading && entries !== null && entries.length > 0 && (
            <ul className="space-y-1 text-sm">
              {entries.map((entry) => (
                <DiffRow key={entry.path} entry={entry} />
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg)]/30">
          {!confirmingRevert && !revertResult && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--text-muted)]">
                Reverting will restore this snapshot and trigger a pipeline
                restart. The current configuration is captured first.
              </p>
              <button
                type="button"
                onClick={onStartRevert}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90"
              >
                Revert to this snapshot
              </button>
            </div>
          )}

          {confirmingRevert && !revertResult && (
            <div>
              <p className="text-sm text-[var(--text)]">
                To confirm, type the snapshot timestamp exactly:
              </p>
              <p className="mt-1 text-xs font-mono text-[var(--text-muted)] break-all">
                {snapshot.snapshot_id}
              </p>
              <input
                type="text"
                value={revertInput}
                onChange={(e) => onChangeRevertInput(e.target.value)}
                placeholder={snapshot.snapshot_id}
                className="mt-2 w-full px-3 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] font-mono"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!revertConfirmed || revertInFlight}
                  onClick={onSubmitRevert}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded',
                    revertConfirmed && !revertInFlight
                      ? 'bg-[var(--accent)] text-white hover:opacity-90'
                      : 'bg-gray-500/20 text-[var(--text-muted)] cursor-not-allowed',
                  )}
                >
                  {revertInFlight && (
                    <Loader2 size={12} className="animate-spin" />
                  )}
                  Confirm revert
                </button>
                <button
                  type="button"
                  onClick={onCancelRevert}
                  className="text-xs px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {revertResult && (
            <p className="text-sm text-[var(--text)]">{revertResult}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const tag = entry.added
    ? 'added'
    : entry.removed
      ? 'removed'
      : entry.type_change
        ? 'type'
        : 'changed'
  return (
    <li
      className={cn(
        'rounded px-2 py-1 border',
        entry.is_secret
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-[var(--border)] bg-[var(--bg)]/50',
      )}
      title={
        entry.is_secret
          ? 'This entry contains a credential. Diff snapshots include credentials per the secrets disclosure above.'
          : undefined
      }
    >
      <div className="flex items-center gap-2 text-xs">
        {entry.is_secret && <Lock size={12} className="text-amber-500" />}
        <span className="font-mono text-[var(--text)] truncate">
          {entry.path}
        </span>
        <span className="ml-auto px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--text-muted)]">
          {tag}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            Snapshot
          </div>
          <div className="font-mono break-all text-[var(--text)]">
            {formatValue(entry.old)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            Current
          </div>
          <div className="font-mono break-all text-[var(--text)]">
            {formatValue(entry.new)}
          </div>
        </div>
      </div>
    </li>
  )
}

function formatHumanTimestamp(epoch: number): string {
  if (!epoch) return '—'
  try {
    const d = new Date(epoch * 1000)
    return d.toLocaleString()
  } catch {
    return '—'
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
