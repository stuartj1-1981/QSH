// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useRef } from 'react'
import { Download, Upload, Loader2, AlertTriangle } from 'lucide-react'
import { apiUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import type { Driver } from '../../types/config'

interface BackupRestoreProps {
  driver: Driver
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function BackupRestore({ driver: _driver }: BackupRestoreProps) {
  const [restoring, setRestoring] = useState(false)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [restoreConfig, setRestoreConfig] = useState(false)
  const [result, setResult] = useState<{ message: string; success: boolean } | null>(null)
  const [confirmReplace, setConfirmReplace] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const exportBackup = () => {
    window.location.href = apiUrl('api/backup/export')
  }

  const restore = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return

    if (mode === 'replace' && confirmReplace !== 'REPLACE') {
      setResult({ message: 'Type REPLACE to confirm destructive restore.', success: false })
      return
    }

    setRestoring(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const resp = await fetch(apiUrl(`api/backup/restore?mode=${mode}${restoreConfig ? '&restore_config=true' : ''}`), {
        method: 'POST',
        body: formData,
      })
      const data = await resp.json()
      if (resp.ok) {
        setResult({ message: data.message, success: true })
      } else {
        setResult({ message: data.detail || 'Restore failed', success: false })
      }
    } catch {
      setResult({ message: 'Network error', success: false })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[var(--text)]">Backup & Restore</h2>

      {/* Export */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
        <h3 className="text-sm font-medium text-[var(--text)]">Export Backup</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Downloads qsh.yaml + sysid + pipeline state as a ZIP.
        </p>
        <button
          onClick={exportBackup}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <Download size={14} />
          Export Backup
        </button>
      </div>

      {/* Restore */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Restore from Backup</h3>

        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="block text-sm text-[var(--text)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--bg)] file:text-sm file:font-medium file:text-[var(--text)]"
        />

        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--text)]">Restore Mode:</p>
          <label
            className={cn(
              'flex items-start gap-2 p-3 rounded-lg border cursor-pointer',
              mode === 'merge'
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)]'
            )}
          >
            <input
              type="radio"
              name="mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <div>
              <span className="text-sm font-medium text-[var(--text)]">
                Merge (recommended)
              </span>
              <p className="text-xs text-[var(--text-muted)]">
                Keep best per-room observations. Non-destructive.
              </p>
            </div>
          </label>
          <label
            className={cn(
              'flex items-start gap-2 p-3 rounded-lg border cursor-pointer',
              mode === 'replace'
                ? 'border-[var(--red)] bg-[var(--red)]/5'
                : 'border-[var(--border)]'
            )}
          >
            <input
              type="radio"
              name="mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              className="mt-0.5 accent-[var(--red)]"
            />
            <div>
              <span className="text-sm font-medium text-[var(--text)]">Replace All</span>
              <p className="text-xs text-[var(--text-muted)]">
                Full overwrite. Previous state lost.
              </p>
            </div>
          </label>
        </div>

        <label className="flex items-start gap-2 p-3 rounded-lg border border-[var(--border)] cursor-pointer">
          <input
            type="checkbox"
            checked={restoreConfig}
            onChange={(e) => setRestoreConfig(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <div>
            <span className="text-sm font-medium text-[var(--text)]">
              Restore configuration (qsh.yaml)
            </span>
            <p className="text-xs text-[var(--text-muted)]">
              Enable when migrating to a new installation. Overwrites current config.
            </p>
          </div>
        </label>

        {mode === 'replace' && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30">
            <AlertTriangle size={14} className="text-[var(--red)] shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-[var(--red)]">
                This will overwrite all sysid learning data. Type "REPLACE" to confirm:
              </p>
              <input
                type="text"
                value={confirmReplace}
                onChange={(e) => setConfirmReplace(e.target.value)}
                className="mt-1 w-32 px-2 py-1 rounded border border-[var(--red)]/30 bg-transparent text-sm text-[var(--text)]"
              />
            </div>
          </div>
        )}

        <button
          onClick={restore}
          disabled={restoring}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
        >
          {restoring ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} />
          )}
          Restore
        </button>

        {result && (
          <p
            className={cn(
              'text-sm',
              result.success ? 'text-[var(--green)]' : 'text-[var(--red)]'
            )}
          >
            {result.message}
          </p>
        )}
      </div>
    </div>
  )
}
