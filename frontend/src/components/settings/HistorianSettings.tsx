// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect } from 'react'
import { Save, Loader2, Check, X } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { apiUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { HelpTip } from '../HelpTip'
import { HISTORIAN } from '../../lib/helpText'
import type { HistorianYaml, InfluxTestResponse, Driver } from '../../types/config'

interface HistorianSettingsProps {
  historian?: HistorianYaml
  driver: Driver
  onRefetch: () => void
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function HistorianSettings({
  historian: initial,
  driver: _driver,
  onRefetch,
}: HistorianSettingsProps) {
  const [hist, setHist] = useState<HistorianYaml>(
    initial || { enabled: false, host: 'a0d7b954-influxdb', port: 8086, database: 'qsh', username: 'qsh' }
  )
  const { patch, saving } = usePatchConfig()

  useEffect(() => { setHist(initial || { enabled: false, host: 'a0d7b954-influxdb', port: 8086, database: 'qsh', username: 'qsh' }) }, [initial])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<InfluxTestResponse | null>(null)

  const save = async () => {
    const result = await patch('historian', hist)
    if (result) onRefetch()
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const resp = await fetch(apiUrl('api/config/test-influxdb'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: hist.host || 'a0d7b954-influxdb',
          port: hist.port || 8086,
          database: hist.database || 'qsh',
          username: hist.username || '',
          password: hist.password || '',
        }),
      })
      const data: InfluxTestResponse = await resp.json()
      setTestResult(data)
    } catch (e) {
      setTestResult({ success: false, message: `Network error: ${e instanceof Error ? e.message : e}` })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Historian (InfluxDB)</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hist.enabled ?? false}
            onChange={(e) => setHist(prev => ({ ...prev, enabled: e.target.checked }))}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)] flex items-center gap-1">Enable InfluxDB logging <HelpTip text={HISTORIAN.enabled} size={12} /></span>
        </label>

        {hist.enabled && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">Host <HelpTip text={HISTORIAN.host} size={12} /></label>
                <input
                  type="text"
                  value={hist.host || ''}
                  onChange={(e) => setHist(prev => ({ ...prev, host: e.target.value }))}
                  placeholder="a0d7b954-influxdb"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">Port</label>
                <input
                  type="number"
                  value={hist.port ?? 8086}
                  onChange={(e) => setHist(prev => ({ ...prev, port: parseInt(e.target.value) || 8086 }))}
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">Database <HelpTip text={HISTORIAN.database} size={12} /></label>
                <input
                  type="text"
                  value={hist.database || ''}
                  onChange={(e) => setHist(prev => ({ ...prev, database: e.target.value }))}
                  placeholder="qsh"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">Username</label>
                <input
                  type="text"
                  value={hist.username || ''}
                  onChange={(e) => setHist(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="qsh"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">Password</label>
              <input
                type="password"
                value={hist.password || ''}
                onChange={(e) => setHist(prev => ({ ...prev, password: e.target.value }))}
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Batch Size (1–100)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={hist.batch_size ?? 20}
                  onChange={(e) => setHist(prev => ({ ...prev, batch_size: parseInt(e.target.value) || 20 }))}
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Flush Interval (s)
                </label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={hist.flush_interval_s ?? 60}
                  onChange={(e) =>
                    setHist(prev => ({ ...prev, flush_interval_s: parseInt(e.target.value) || 60 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>

            {/* Test Connection */}
            <div className="flex items-center gap-3">
              <button
                onClick={testConnection}
                disabled={testing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
              >
                {testing && <Loader2 size={14} className="animate-spin" />}
                Test Connection
              </button>
              {testResult && (
                <div
                  className={cn(
                    'flex items-center gap-2 text-sm',
                    testResult.success ? 'text-[var(--green)]' : 'text-[var(--red)]'
                  )}
                >
                  {testResult.success ? <Check size={14} /> : <X size={14} />}
                  {testResult.message}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
