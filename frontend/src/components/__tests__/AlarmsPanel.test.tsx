import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlarmsPanel } from '../forecast/AlarmsPanel'
import type { AlarmEvent } from '../../types/api'

const LEGACY_TOKEN = 'doub' + 'ly_robust'

const _ev = (alarm_id: 'A' | 'B', ts: number, room: string | null = 'lounge'): AlarmEvent => ({
  alarm_id, timestamp: ts, room, payload: {}, severity: 'notification',
})

describe('AlarmsPanel', () => {
  it('renders active alarms with notification severity badge', () => {
    render(
      <AlarmsPanel
        liveAlarms={[_ev('A', 100)]}
        historicalAlarms={[]}
        loading={false}
        error={null}
      />,
    )
    // Two badges: one in live (severity tag), and "Alarm A"
    const notifBadges = screen.getAllByText('notification')
    expect(notifBadges.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Alarm A')).toBeInTheDocument()
  })

  it('renders historical alarms', () => {
    render(
      <AlarmsPanel
        liveAlarms={[]}
        historicalAlarms={[_ev('B', 200), _ev('A', 300)]}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText('Alarm A')).toBeInTheDocument()
    expect(screen.getByText('Alarm B')).toBeInTheDocument()
  })

  it('renders loading state', () => {
    render(
      <AlarmsPanel
        liveAlarms={[]}
        historicalAlarms={[]}
        loading={true}
        error={null}
      />,
    )
    expect(screen.getByText(/Loading alarms/)).toBeInTheDocument()
  })

  it('severity always "notification" assertion', () => {
    render(
      <AlarmsPanel
        liveAlarms={[_ev('A', 100), _ev('B', 200)]}
        historicalAlarms={[_ev('A', 300)]}
        loading={false}
        error={null}
      />,
    )
    // All severity badges should be "notification"; none others.
    const all = screen.getAllByText('notification')
    expect(all.length).toBe(3)
  })

  it('legacy estimator term absent from rendered DOM', () => {
    render(
      <AlarmsPanel
        liveAlarms={[_ev('A', 100)]}
        historicalAlarms={[_ev('B', 200)]}
        loading={false}
        error={null}
      />,
    )
    expect(screen.queryByText(new RegExp(LEGACY_TOKEN))).toBeNull()
  })
})
