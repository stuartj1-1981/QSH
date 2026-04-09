import { useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import type { MqttConfig, MqttTopicCandidate } from '../../types/config'
import { useMqttScan } from '../../hooks/useMqttScan'

interface TopicDiscoveryPanelProps {
  mqtt: MqttConfig
  onResults?: (topics: MqttTopicCandidate[]) => void
  filterRoom?: string
}

export function TopicDiscoveryPanel({ mqtt, onResults, filterRoom }: TopicDiscoveryPanelProps) {
  const { scanTopics, scanResults, scanLoading, scanError } = useMqttScan()
  const [filter, setFilter] = useState('')

  const handleScan = async () => {
    const results = await scanTopics(
      {
        broker: mqtt.broker,
        port: mqtt.port,
        username: mqtt.username,
        password: mqtt.password,
        tls: mqtt.tls,
        client_id: mqtt.client_id,
        topic_prefix: mqtt.topic_prefix,
      },
      filterRoom,
    )
    onResults?.(results)
  }

  const filtered = filter
    ? scanResults.filter((t) => t.topic.toLowerCase().includes(filter.toLowerCase()))
    : scanResults

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={handleScan}
          disabled={scanLoading || !mqtt.broker}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {scanLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {scanLoading ? 'Scanning...' : 'Scan Broker'}
        </button>
        {scanResults.length > 0 && (
          <span className="text-xs text-[var(--text-muted)]">
            {scanResults.length} topics found
          </span>
        )}
      </div>

      {scanError && <p className="text-sm text-[var(--red)]">{scanError}</p>}

      {scanResults.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter topics..."
              className="w-full bg-transparent text-sm outline-none text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((t) => (
              <div
                key={t.topic}
                className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-[var(--border)] last:border-0"
              >
                {t.is_numeric && (
                  <span className="w-2 h-2 rounded-full bg-[var(--green)] shrink-0" title="Numeric" />
                )}
                {!t.is_numeric && (
                  <span className="w-2 h-2 rounded-full bg-[var(--text-muted)] shrink-0" title="Non-numeric" />
                )}
                <span className="font-mono text-[var(--text)] truncate flex-1">{t.topic}</span>
                <span className="text-[var(--text-muted)] truncate max-w-[120px]">{t.payload}</span>
                {t.suggested_field && (
                  <span className="px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)] shrink-0">
                    {t.suggested_field}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
