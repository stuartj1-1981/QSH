import { useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { useMqttScan } from '../../hooks/useMqttScan'
import type { MqttConfig } from '../../types/config'

interface StepMqttBrokerProps {
  config: Record<string, unknown>
  onUpdate: (section: string, data: unknown) => void
}

export function StepMqttBroker({ config, onUpdate }: StepMqttBrokerProps) {
  const mqtt: MqttConfig = (config.mqtt as MqttConfig) || {
    broker: '',
    port: 1883,
    inputs: {},
  }
  const { testConnection, testLoading, testResult } = useMqttScan()
  const [localTestResult, setLocalTestResult] = useState(testResult)

  const update = (changes: Partial<MqttConfig>) => {
    onUpdate('mqtt', { ...mqtt, ...changes })
  }

  const updateOutputs = (key: string, value: string) => {
    const outputs = mqtt.outputs || {}
    onUpdate('mqtt', {
      ...mqtt,
      outputs: { ...outputs, [key]: value || undefined },
    })
  }

  const handleTest = async () => {
    const result = await testConnection({
      broker: mqtt.broker,
      port: mqtt.port,
      username: mqtt.username,
      password: mqtt.password,
      tls: mqtt.tls,
      client_id: mqtt.client_id,
      topic_prefix: mqtt.topic_prefix,
    })
    setLocalTestResult(result)
  }

  const result = localTestResult ?? testResult

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">MQTT Broker</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure your MQTT broker connection. QSH will subscribe to sensor topics
          and publish control commands directly.
        </p>
      </div>

      {/* Connection details */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Connection</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Broker <span className="text-[var(--red)]">*</span>
            </label>
            <input
              type="text"
              value={mqtt.broker}
              onChange={(e) => update({ broker: e.target.value })}
              placeholder="192.168.1.50 or hostname"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Port
            </label>
            <input
              type="number"
              value={mqtt.port}
              onChange={(e) => update({ port: parseInt(e.target.value) || 1883 })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Username
            </label>
            <input
              type="text"
              value={mqtt.username || ''}
              onChange={(e) => update({ username: e.target.value || undefined })}
              placeholder="Optional"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Password
            </label>
            <input
              type="password"
              value={mqtt.password || ''}
              onChange={(e) => update({ password: e.target.value || undefined })}
              placeholder="Optional"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Client ID
            </label>
            <input
              type="text"
              value={mqtt.client_id || 'qsh'}
              onChange={(e) => update({ client_id: e.target.value || 'qsh' })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Topic Prefix
            </label>
            <input
              type="text"
              value={mqtt.topic_prefix || ''}
              onChange={(e) => update({ topic_prefix: e.target.value || undefined })}
              placeholder="Leave empty if topics are fully qualified"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mqtt.tls || false}
                onChange={(e) => update({ tls: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              <span className="text-sm font-medium text-[var(--text)]">TLS</span>
            </label>
          </div>
        </div>
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testLoading || !mqtt.broker}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {testLoading ? <Loader2 size={16} className="animate-spin" /> : null}
          Test Connection
        </button>
        {result && (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
              result.success
                ? 'bg-[var(--green)]/10 text-[var(--green)]'
                : 'bg-[var(--red)]/10 text-[var(--red)]'
            }`}
          >
            {result.success ? <Check size={14} /> : <X size={14} />}
            {result.message}
          </div>
        )}
      </div>

      {/* Output topics */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Output Topics</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Topics where QSH publishes control commands. Leave empty for monitor-only mode.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Flow Temperature
            </label>
            <input
              type="text"
              value={mqtt.outputs?.flow_temp || ''}
              onChange={(e) => updateOutputs('flow_temp', e.target.value)}
              placeholder="heatpump/flow_temp/set"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Mode
            </label>
            <input
              type="text"
              value={mqtt.outputs?.mode || ''}
              onChange={(e) => updateOutputs('mode', e.target.value)}
              placeholder="heatpump/mode/set"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Heat Source Command (optional)
          </label>
          <input
            type="text"
            value={mqtt.outputs?.heat_source_command || ''}
            onChange={(e) => updateOutputs('heat_source_command', e.target.value)}
            placeholder="heatpump/command"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>
    </div>
  )
}
