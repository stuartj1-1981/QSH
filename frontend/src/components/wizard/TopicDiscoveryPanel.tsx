import { useState } from 'react'
import { Search, Loader2, AlertTriangle } from 'lucide-react'
import type { MqttConfig, MqttTopicCandidate } from '../../types/config'
import { useMqttScan } from '../../hooks/useMqttScan'

interface TopicDiscoveryPanelProps {
  mqtt: MqttConfig
  onResults?: (topics: MqttTopicCandidate[]) => void
  filterRoom?: string
}

/**
 * INSTRUCTION-93B: the scanner performs a bounded-window aggregation (default
 * 30 s) so delta-only publishers (e.g. Samsung A2W) don't lose fields to the
 * last-payload-wins race. Surface the scan status here:
 *  - partial-scan banner if any topic came back 'partial'
 *  - "Rescan (90s)" button to re-run with a longer window
 *  - per-topic status dot coloured by scan_completeness
 */
export function TopicDiscoveryPanel({ mqtt, onResults, filterRoom }: TopicDiscoveryPanelProps) {
  const { scanTopics, scanResults, scanMeta, scanLoading, scanError } = useMqttScan()
  const [filter, setFilter] = useState('')

  const runScan = async (windowSeconds?: number) => {
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
      windowSeconds !== undefined ? { windowSeconds } : undefined,
    )
    onResults?.(results)
  }

  const handleScan = () => {
    void runScan()
  }

  const handleRescan = () => {
    void runScan(90)
  }

  const filtered = filter
    ? scanResults.filter((t) => t.topic.toLowerCase().includes(filter.toLowerCase()))
    : scanResults

  const showPartialBanner = !!scanMeta && scanMeta.partial_topics > 0

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

      {showPartialBanner && scanMeta && (
        <div
          role="status"
          className="flex items-start gap-2 px-3 py-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 text-xs text-[var(--text)]"
          data-testid="partial-scan-banner"
        >
          <AlertTriangle size={14} className="text-[var(--amber)] shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p>
              {scanMeta.partial_topics} topic(s) emitted partial data during the{' '}
              {scanMeta.window_seconds}s scan. Publishers that send delta-only updates
              may not expose all fields in a short window. Rescan with a longer window
              if expected fields are missing.
            </p>
            <button
              onClick={handleRescan}
              disabled={scanLoading}
              className="px-2 py-1 rounded bg-[var(--amber)]/20 text-[var(--text)] text-xs font-medium hover:bg-[var(--amber)]/30 disabled:opacity-50"
            >
              Rescan (90s)
            </button>
          </div>
        </div>
      )}

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
                <CompletenessDot completeness={t.scan_completeness} />
                {t.is_numeric && (
                  <span
                    className="w-2 h-2 rounded-full bg-[var(--green)] shrink-0"
                    title="Numeric"
                  />
                )}
                {!t.is_numeric && (
                  <span
                    className="w-2 h-2 rounded-full bg-[var(--text-muted)] shrink-0"
                    title="Non-numeric"
                  />
                )}
                <span className="font-mono text-[var(--text)] truncate flex-1">{t.topic}</span>
                {t.retained && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] shrink-0"
                    title="Retained payload captured"
                  >
                    retained
                  </span>
                )}
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

interface CompletenessDotProps {
  completeness?: MqttTopicCandidate['scan_completeness']
}

function CompletenessDot({ completeness }: CompletenessDotProps) {
  const map: Record<string, { colour: string; title: string }> = {
    retained: {
      colour: 'bg-[var(--green)]',
      title: 'Retained full-state payload captured',
    },
    heartbeat: {
      colour: 'bg-[var(--amber)]',
      title: 'Full state reconstructed from in-window heartbeat',
    },
    partial: {
      colour: 'bg-[var(--red)]',
      title: 'Only delta payloads seen — some fields may be missing',
    },
  }
  const info = completeness ? map[completeness] : undefined
  const colour = info?.colour ?? 'bg-[var(--text-muted)]'
  const title = info?.title ?? 'Legacy scan result (no completeness data)'
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${colour}`}
      title={title}
      data-testid={`completeness-dot-${completeness ?? 'legacy'}`}
    />
  )
}
