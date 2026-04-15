import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TopicDiscoveryPanel } from '../TopicDiscoveryPanel'
import type { MqttConfig, MqttTopicCandidate } from '../../../types/config'

const MQTT: MqttConfig = {
  broker: 'test.local',
  port: 1883,
  username: '',
  password: '',
  tls: false,
  client_id: 'qsh',
  topic_prefix: '',
  inputs: {},
}

function mockScanResponse(
  topics: MqttTopicCandidate[],
  scanMeta?: { total: number; partial: number; window: number },
) {
  const body: Record<string, unknown> = { topics }
  if (scanMeta) {
    body.scan_meta = {
      started_at: 1,
      duration_s: scanMeta.window,
      window_seconds: scanMeta.window,
      total_topics: scanMeta.total,
      partial_topics: scanMeta.partial,
    }
  }
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe('TopicDiscoveryPanel — INSTRUCTION-93B UI additions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT render partial banner when scan_meta is absent (legacy backend)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockScanResponse([
        { topic: 'a', payload: '1', is_numeric: true },
      ]),
    )

    render(<TopicDiscoveryPanel mqtt={MQTT} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan Broker/i }))

    await waitFor(() => {
      expect(screen.getByText('a')).toBeDefined()
    })
    expect(screen.queryByTestId('partial-scan-banner')).toBeNull()
  })

  it('does NOT render partial banner when partial_topics === 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockScanResponse(
        [{ topic: 'a', payload: '1', is_numeric: true, scan_completeness: 'retained' }],
        { total: 1, partial: 0, window: 30 },
      ),
    )

    render(<TopicDiscoveryPanel mqtt={MQTT} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan Broker/i }))

    await waitFor(() => {
      expect(screen.getByText('a')).toBeDefined()
    })
    expect(screen.queryByTestId('partial-scan-banner')).toBeNull()
  })

  it('renders partial banner when partial_topics > 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockScanResponse(
        [{ topic: 'hp/stats', payload: '{}', is_numeric: false, scan_completeness: 'partial' }],
        { total: 1, partial: 1, window: 30 },
      ),
    )

    render(<TopicDiscoveryPanel mqtt={MQTT} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan Broker/i }))

    await waitFor(() => {
      expect(screen.getByTestId('partial-scan-banner')).toBeDefined()
    })
    const banner = screen.getByTestId('partial-scan-banner')
    expect(banner.textContent).toContain('1 topic')
    expect(banner.textContent).toContain('30s')
  })

  it('Rescan (90s) button calls scan with windowSeconds=90', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // Initial scan → partial so the banner renders.
      .mockResolvedValueOnce(
        mockScanResponse(
          [{ topic: 'hp/stats', payload: '{}', is_numeric: false, scan_completeness: 'partial' }],
          { total: 1, partial: 1, window: 30 },
        ),
      )
      // Rescan → all good.
      .mockResolvedValueOnce(
        mockScanResponse(
          [
            {
              topic: 'hp/stats',
              payload: '{"power":1}',
              is_numeric: false,
              scan_completeness: 'heartbeat',
            },
          ],
          { total: 1, partial: 0, window: 90 },
        ),
      )

    render(<TopicDiscoveryPanel mqtt={MQTT} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan Broker/i }))
    await waitFor(() => {
      expect(screen.getByTestId('partial-scan-banner')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /Rescan \(90s\)/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.window_seconds).toBe(90)
  })

  it('renders per-topic status dot coloured by scan_completeness', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockScanResponse(
        [
          { topic: 'r', payload: '1', is_numeric: true, scan_completeness: 'retained' },
          { topic: 'h', payload: '2', is_numeric: true, scan_completeness: 'heartbeat' },
          { topic: 'p', payload: '3', is_numeric: true, scan_completeness: 'partial' },
          // No scan_completeness → legacy.
          { topic: 'l', payload: '4', is_numeric: true },
        ],
        { total: 4, partial: 1, window: 30 },
      ),
    )

    render(<TopicDiscoveryPanel mqtt={MQTT} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan Broker/i }))

    await waitFor(() => {
      expect(screen.getByText('r')).toBeDefined()
    })
    expect(screen.getByTestId('completeness-dot-retained')).toBeDefined()
    expect(screen.getByTestId('completeness-dot-heartbeat')).toBeDefined()
    expect(screen.getByTestId('completeness-dot-partial')).toBeDefined()
    expect(screen.getByTestId('completeness-dot-legacy')).toBeDefined()
  })

  it('retained badge renders when retained=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockScanResponse(
        [{ topic: 'hp/snap', payload: '{}', is_numeric: false, retained: true, scan_completeness: 'retained' }],
        { total: 1, partial: 0, window: 30 },
      ),
    )

    render(<TopicDiscoveryPanel mqtt={MQTT} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan Broker/i }))

    await waitFor(() => {
      expect(screen.getByText('retained')).toBeDefined()
    })
  })
})
