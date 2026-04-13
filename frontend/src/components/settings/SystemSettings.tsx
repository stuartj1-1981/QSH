// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { Download, Wand2 } from 'lucide-react'
import { apiUrl } from '../../lib/api'
import type { Driver } from '../../types/config'

interface SystemSettingsProps {
  driver: Driver
  onRunWizard: () => void
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function SystemSettings({ driver: _driver, onRunWizard }: SystemSettingsProps) {
  const downloadConfig = async () => {
    try {
      const resp = await fetch(apiUrl('api/config/raw'))
      const data = await resp.json()
      const yaml = JSON.stringify(data, null, 2)
      const blob = new Blob([yaml], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'qsh_config.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Ignore
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[var(--text)]">System</h2>

      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
          <h3 className="text-sm font-medium text-[var(--text)]">Export Configuration</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Download the current qsh.yaml configuration as JSON.
          </p>
          <button
            onClick={downloadConfig}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--bg)]"
          >
            <Download size={14} />
            Download Config
          </button>
        </div>

        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
          <h3 className="text-sm font-medium text-[var(--text)]">Setup Wizard</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Re-run the guided setup wizard to reconfigure QSH from scratch.
          </p>
          <button
            onClick={onRunWizard}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--accent)] text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/5"
          >
            <Wand2 size={14} />
            Re-run Setup Wizard
          </button>
        </div>
      </div>
    </div>
  )
}
