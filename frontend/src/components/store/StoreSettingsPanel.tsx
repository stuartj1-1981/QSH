import { useEffect, useState } from 'react'
import { Save, Loader2, AlertTriangle, Check } from 'lucide-react'
import { useStoreConfig } from '../../hooks/useStore'
import { apiUrl } from '../../lib/api'
import { cn, formatBytes } from '../../lib/utils'
import type { TestStoreResponse } from '../../types/api'

interface StoreSettingsPanelProps {
  // From the page's own useStoreStats() poll — used only to decide whether
  // a save needs the mid-migration second confirmation (commitment 3).
  backfillState: string | null | undefined
}

const MID_MIGRATION_STATES = new Set(['pulling', 'enumerating'])

export function StoreSettingsPanel({ backfillState }: StoreSettingsPanelProps) {
  const { data, loading, error, saving, saved, save } = useStoreConfig()

  const [retentionDays, setRetentionDays] = useState(0)
  const [localCacheDays, setLocalCacheDays] = useState(30)
  const [externalPath, setExternalPath] = useState('')
  const [parityReport, setParityReport] = useState(false)
  const [confirmingMidMigration, setConfirmingMidMigration] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestStoreResponse | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Re-hydrate local edit state whenever the held section changes — on
  // first load, and again after a successful save (the held section is
  // replaced with the merged object the save just sent).
  useEffect(() => {
    if (!data) return
    const store = data.store ?? {}
    setRetentionDays(store.retention_days ?? 0)
    setLocalCacheDays(store.local_cache_days ?? 30)
    setExternalPath(store.external_path ?? '')
    setParityReport(store.parity_report ?? false)
  }, [data])

  const store = data?.store ?? {}
  const isMidMigration = backfillState != null && MID_MIGRATION_STATES.has(backfillState)

  const doSave = () => {
    setConfirmingMidMigration(false)
    void save({
      retention_days: retentionDays,
      local_cache_days: localCacheDays,
      external_path: externalPath.trim() === '' ? null : externalPath.trim(),
      parity_report: parityReport,
    })
  }

  const handleSaveClick = () => {
    if (isMidMigration && !confirmingMidMigration) {
      setConfirmingMidMigration(true)
      return
    }
    doSave()
  }

  const runTest = async () => {
    setTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      const resp = await fetch(apiUrl('api/config/test-store'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_path: externalPath.trim() === '' ? null : externalPath.trim() }),
      })
      const json = (await resp.json()) as TestStoreResponse
      setTestResult(json)
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setTesting(false)
    }
  }

  const retentionOutOfBand = retentionDays < 0
  const cacheOutOfBand = localCacheDays < 0
  const pathOutOfBand =
    externalPath.trim() !== '' &&
    !externalPath.trim().startsWith('/share/') &&
    !externalPath.trim().startsWith('/media/')

  return (
    <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] space-y-4">
      <h3 className="text-base font-semibold text-[var(--text)]">Store settings</h3>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading store config...</p>}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="text-[var(--text-muted)]">Shadow</div>
            <div className="text-[var(--text)]">{store.shadow === undefined ? '--' : String(store.shadow)}</div>
            <div className="text-[var(--text-muted)]">Cutover</div>
            <div className="text-[var(--text)]">{store.cutover ?? '--'}</div>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            <code>shadow</code> and <code>cutover</code> are the migration's own controls, set via
            config. They are not editable here.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">Retention (days)</label>
              <input
                type="number"
                min="0"
                value={retentionDays}
                onChange={(e) => setRetentionDays(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
              {retentionOutOfBand && (
                <p className="text-xs text-amber-500 mt-1">
                  Negative — the backend falls back to 0 rather than rejecting this.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">Local cache (days)</label>
              <input
                type="number"
                min="0"
                value={localCacheDays}
                onChange={(e) => setLocalCacheDays(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
              {cacheOutOfBand && (
                <p className="text-xs text-amber-500 mt-1">
                  Negative — the backend falls back to 30 rather than rejecting this.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">External path</label>
            <input
              type="text"
              value={externalPath}
              onChange={(e) => setExternalPath(e.target.value)}
              placeholder="/share/qsdb"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            {pathOutOfBand && (
              <p className="text-xs text-amber-500 mt-1">
                Not under <code>/share/</code> or <code>/media/</code> — this is guidance, not a
                gate; the store applies its own constraint.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={parityReport}
              onChange={(e) => setParityReport(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-sm font-medium text-[var(--text)]">Parity report</span>
          </label>

          <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
            <button
              onClick={runTest}
              disabled={testing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
            >
              {testing && <Loader2 size={14} className="animate-spin" />}
              Test store
            </button>
            {testError && <span className="text-sm text-red-500">Error: {testError}</span>}
          </div>

          {testResult && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="text-[var(--text-muted)]">DuckDB</div>
              <div className={cn(testResult.duckdb.available ? 'text-[var(--text)]' : 'text-red-500')}>
                {testResult.duckdb.available ? `available (${testResult.duckdb.version ?? '--'})` : 'not available'}
              </div>
              <div className="text-[var(--text-muted)]">Store root</div>
              <div className="text-[var(--text)]">{testResult.root.path}</div>
              <div className="text-[var(--text-muted)]">Writable</div>
              <div className={cn(testResult.root.writable ? 'text-[var(--text)]' : 'text-red-500')}>
                {testResult.root.writable ? 'yes' : 'no'}
              </div>
              <div className="text-[var(--text-muted)]">Free space</div>
              <div className="text-[var(--text)]">{formatBytes(testResult.root.free_bytes)}</div>
              {testResult.external_path && (
                <>
                  <div className="text-[var(--text-muted)]">External path form</div>
                  <div className={cn(testResult.external_path.form_ok ? 'text-[var(--text)]' : 'text-red-500')}>
                    {testResult.external_path.form_ok ? 'ok' : 'not under /share/ or /media/'}
                  </div>
                  <div className="text-[var(--text-muted)]">External path reachable</div>
                  <div className="text-[var(--text)]">
                    {testResult.external_path.reachable === null
                      ? '--'
                      : testResult.external_path.reachable
                        ? 'yes'
                        : 'no'}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-[var(--border)] space-y-2">
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} />
              Saving restarts the pipeline to adopt the new config.
            </p>

            {confirmingMidMigration && (
              <div className="p-3 rounded-lg border border-amber-500 bg-amber-50 dark:bg-amber-900/20 space-y-2">
                <p className="text-sm text-[var(--text)]">
                  A migration is currently in flight (<code>backfill_state: {backfillState}</code>).
                  Saving now restarts the pipeline mid-migration.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={doSave}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:opacity-90"
                  >
                    Confirm save
                  </button>
                  <button
                    onClick={() => setConfirmingMidMigration(false)}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveClick}
                disabled={saving || loading || data === null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
              {saved && !saving && (
                <span className="flex items-center gap-1 text-sm text-[var(--green)]">
                  <Check size={14} /> Saved
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
