import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MigrationPanel } from '../MigrationPanel'
import type { StoreStats } from '../../../types/api'

function stats(overrides: Partial<StoreStats>): StoreStats {
  return {
    migration_state: null,
    backfill_state: null,
    backend_config: 'qsdb',
    backend_effective: 'influxdb',
    population_days: null,
    reconciled_days: null,
    unreconciled_days: null,
    source_ok: null,
    source_last_error: null,
    last_pulled_day: null,
    ...overrides,
  }
}

describe('MigrationPanel', () => {
  it('renders with stats: null without crashing', () => {
    render(<MigrationPanel stats={null} />)
    expect(screen.getByText('Migration')).toBeDefined()
  })

  it('renders the none state', () => {
    render(<MigrationPanel stats={stats({ migration_state: 'none' })} />)
    expect(screen.getByText('None')).toBeDefined()
  })

  it('renders the shadow state with an active backfill_state (not PARKED)', () => {
    render(<MigrationPanel stats={stats({ migration_state: 'shadow', backfill_state: 'enumerating' })} />)
    expect(screen.getByText('Shadow')).toBeDefined()
    expect(screen.queryByText('PARKED')).toBeNull()
  })

  it('renders the backfill state with a pulling backfill_state (not PARKED)', () => {
    render(<MigrationPanel stats={stats({ migration_state: 'backfill', backfill_state: 'pulling' })} />)
    expect(screen.getByText('Backfill')).toBeDefined()
    expect(screen.queryByText('PARKED')).toBeNull()
  })

  it('renders the reconciled state', () => {
    render(<MigrationPanel stats={stats({ migration_state: 'reconciled', backfill_state: 'idle' })} />)
    expect(screen.getByText('Reconciled')).toBeDefined()
  })

  it('renders the cutover state', () => {
    render(<MigrationPanel stats={stats({ migration_state: 'cutover' })} />)
    expect(screen.getByText('Cutover')).toBeDefined()
  })

  it.each(['shadow', 'backfill', 'reconciled'])(
    'renders PARKED — not a stuck migration — when state is %s and backfill_state is null',
    (state) => {
      render(<MigrationPanel stats={stats({ migration_state: state, backfill_state: null })} />)
      expect(screen.getByText('PARKED')).toBeDefined()
      expect(screen.getByText('historian.store.shadow')).toBeDefined()
    },
  )

  it('shows source_last_error when source_ok is false', () => {
    render(
      <MigrationPanel
        stats={stats({ migration_state: 'shadow', backfill_state: 'idle', source_ok: false, source_last_error: 'connection refused' })}
      />,
    )
    expect(screen.getByText('connection refused')).toBeDefined()
  })

  it('renders no progress bar when population_days is null', () => {
    render(<MigrationPanel stats={stats({ migration_state: 'backfill', backfill_state: 'pulling', population_days: null })} />)
    expect(screen.queryByText('Reconciled progress')).toBeNull()
  })

  it('renders a progress bar when population_days is a positive number', () => {
    render(
      <MigrationPanel
        stats={stats({
          migration_state: 'backfill',
          backfill_state: 'pulling',
          population_days: 10,
          reconciled_days: 4,
        })}
      />,
    )
    expect(screen.getByText('Reconciled progress')).toBeDefined()
    expect(screen.getByText('40%')).toBeDefined()
  })
})
