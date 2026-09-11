import { useStoreStats } from '../hooks/useStore'
import { MigrationPanel } from '../components/store/MigrationPanel'
import { SealedDaysPanel } from '../components/store/SealedDaysPanel'
import { ParityPanel } from '../components/store/ParityPanel'
import { StoreSettingsPanel } from '../components/store/StoreSettingsPanel'
import { CutoverPanel } from '../components/store/CutoverPanel'
import { SqlConsole } from '../components/store/SqlConsole'

export function Store() {
  const { data, loading, error, refresh } = useStoreStats()

  if (loading && !data) {
    return <p className="text-[var(--text-muted)] p-4">Loading store status...</p>
  }

  if (error) {
    return <p className="text-red-500 p-4">Error: {error}</p>
  }

  // Rarer branch: no historian configured at all.
  if (!data || data.historian === false) {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-[var(--text)]">Store</h2>
        <p className="text-[var(--text-muted)]">No historian is configured on this install.</p>
      </div>
    )
  }

  // The class the whole degradation design is for: a historian without a
  // store (`backend: influxdb`, no migration started).
  if (data.store === false) {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-[var(--text)]">Store</h2>
        <p className="text-[var(--text-muted)]">
          No store on this install. The historian runs on{' '}
          {data.stats?.backend_effective ?? 'InfluxDB'} without a local store.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">Store</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Effective backend: {data.stats?.backend_effective ?? '--'}
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg)]"
        >
          Refresh
        </button>
      </div>

      <MigrationPanel stats={data.stats} />
      <SealedDaysPanel />
      <ParityPanel />

      {/* INSTRUCTION-510C — the page's three acts, below 510B's read-only
          panels. */}
      <StoreSettingsPanel backfillState={data.stats?.backfill_state} />
      <CutoverPanel stats={data.stats} onCutover={refresh} />
      <SqlConsole />
    </div>
  )
}
