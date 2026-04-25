import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'

const baseProps = {
  operatingState: 'Winter (Heating)',
  controlEnabled: true,
  appliedFlow: 40,
  appliedMode: 'winter',
  outdoorTemp: 5.0,
  heatSource: {
    type: 'heat_pump' as const,
    input_power_kw: 3.5,
    thermal_output_kw: 11.2,
    thermal_output_source: 'measured' as const,
    performance: { value: 3.2, source: 'live' as const },
    flow_temp: 40,
    return_temp: 35,
    delta_t: 5,
    flow_rate: 0.38,
  },
}

const baseRoom = {
  temp: 20.0,
  target: 21.0,
  valve: 50,
  occupancy: 'occupied',
  status: 'heating',
  facing: 0.5,
  area_m2: 20,
  ceiling_m: 2.4,
}

describe('StatusBanner sensor fallback warning', () => {
  it('renders fallback warning when rooms have unavailable sensors', () => {
    render(
      <StatusBanner
        {...baseProps}
        rooms={{
          lounge: { ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' },
          bedroom: { ...baseRoom, occupancy_source: 'sensor' },
        }}
      />
    )
    expect(screen.getByText(/Occupancy sensor unavailable/)).toBeDefined()
    expect(screen.getByText(/lounge/)).toBeDefined()
  })

  it('does not render fallback warning when all sensors healthy', () => {
    render(
      <StatusBanner
        {...baseProps}
        rooms={{
          lounge: { ...baseRoom, occupancy_source: 'sensor' },
          bedroom: { ...baseRoom, occupancy_source: 'schedule' },
        }}
      />
    )
    expect(screen.queryByText(/Occupancy sensor unavailable/)).toBeNull()
  })

  it('does not render fallback warning when no rooms provided', () => {
    render(<StatusBanner {...baseProps} />)
    expect(screen.queryByText(/Occupancy sensor unavailable/)).toBeNull()
  })

  it('shows multiple room names when multiple sensors unavailable', () => {
    render(
      <StatusBanner
        {...baseProps}
        rooms={{
          lounge: { ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' },
          bedroom: { ...baseRoom, occupancy_source: 'last_known (sensor unavailable)' },
        }}
      />
    )
    expect(screen.getByText(/lounge/)).toBeDefined()
    expect(screen.getByText(/bedroom/)).toBeDefined()
  })
})

describe('StatusBanner readback mismatch alarm', () => {
  it('does not render alarm when count is 0 and threshold is 5', () => {
    render(
      <StatusBanner
        {...baseProps}
        readbackMismatchCount={0}
        readbackMismatchThreshold={5}
      />
    )
    expect(screen.queryByTestId('readback-mismatch-alarm')).toBeNull()
  })

  it('does not render alarm when count is 4 (below threshold of 5)', () => {
    render(
      <StatusBanner
        {...baseProps}
        readbackMismatchCount={4}
        readbackMismatchThreshold={5}
      />
    )
    expect(screen.queryByTestId('readback-mismatch-alarm')).toBeNull()
  })

  it('renders alarm at count=5 threshold=5 without "First alarmed at" when time is 0', () => {
    render(
      <StatusBanner
        {...baseProps}
        readbackMismatchCount={5}
        readbackMismatchThreshold={5}
        lastReadbackMismatchAlarmTime={0}
      />
    )
    const alarm = screen.getByTestId('readback-mismatch-alarm')
    expect(alarm).toBeDefined()
    expect(alarm.getAttribute('role')).toBe('alert')
    expect(alarm.textContent).toMatch(/5 cycles/)
    expect(alarm.textContent).not.toMatch(/First alarmed at/)
  })

  it('renders alarm at count=12 with "First alarmed at" time when timestamp is non-zero', () => {
    render(
      <StatusBanner
        {...baseProps}
        readbackMismatchCount={12}
        readbackMismatchThreshold={5}
        lastReadbackMismatchAlarmTime={1745236800}
      />
    )
    const alarm = screen.getByTestId('readback-mismatch-alarm')
    expect(alarm).toBeDefined()
    expect(alarm.textContent).toMatch(/12 cycles/)
    expect(alarm.textContent).toMatch(/First alarmed at/)
    // The time string body must be non-empty — toLocaleTimeString() renders
    // locale-specific HH:MM:SS; we assert presence rather than an exact match.
    const match = alarm.textContent?.match(/First alarmed at (.+)\./)
    expect(match).not.toBeNull()
    expect(match?.[1]?.length ?? 0).toBeGreaterThan(0)
  })

  it('does not render alarm when count is 6 but threshold is 10 (configurable threshold)', () => {
    render(
      <StatusBanner
        {...baseProps}
        readbackMismatchCount={6}
        readbackMismatchThreshold={10}
      />
    )
    expect(screen.queryByTestId('readback-mismatch-alarm')).toBeNull()
  })
})

// INSTRUCTION-119 Task 8: HP COP gate on performance.source + thermal
// output "0.0 kW" rendering when HP is off.
describe('StatusBanner HP COP gate and off-state rendering', () => {
  it('suppresses COP label when HP off with fallback baseline (source="config")', () => {
    // 0 kW input after 5-cycle hold lapse: resolver emits
    // HeatSourcePerformance(value=2.5, source="config"). The banner must
    // not render this as a live COP value.
    render(
      <StatusBanner
        {...baseProps}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 0,
          thermal_output_kw: 0,
          thermal_output_source: 'computed',
          performance: { value: 2.5, source: 'config' },
          flow_temp: 30,
          return_temp: 30,
          delta_t: 0,
          flow_rate: 0,
        }}
      />
    )
    expect(screen.queryByText(/COP/)).toBeNull()
  })

  it('renders "0.0 kW in" and "0.0 kW out" when HP is off (not "-- in" or "-- out")', () => {
    render(
      <StatusBanner
        {...baseProps}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 0,
          thermal_output_kw: 0,
          thermal_output_source: 'computed',
          performance: { value: 2.5, source: 'config' },
          flow_temp: 30,
          return_temp: 30,
          delta_t: 0,
          flow_rate: 0,
        }}
      />
    )
    // Both "0.0 kW in" and "0.0 kW out" (with "≈ " computed prefix) should
    // render. Narrow negative assertions to the specific "-- in" / "-- out"
    // strings this fix targets, per V2 L2.
    expect(screen.getByText(/0\.0 kW in/)).toBeDefined()
    expect(screen.getByText(/0\.0 kW out/)).toBeDefined()
    expect(screen.queryByText(/-- out/)).toBeNull()
    expect(screen.queryByText(/-- in/)).toBeNull()
  })

  it('renders COP label when HP is running with live performance', () => {
    // baseProps already has live performance with value=3.2. Sanity-check
    // that the gate change does not regress the running case.
    render(<StatusBanner {...baseProps} />)
    expect(screen.getByText(/COP 3\.2/)).toBeDefined()
  })

  // INSTRUCTION-120C Task 7 fixture: hp_running_sensor_loss_fallback.
  // HP is drawing power (hp_power > 0) but the live-COP sensor has failed
  // and the 5-cycle hold has lapsed, so resolver emits
  // HeatSourcePerformance(value=2.5, source="config"). Bug B's post-
  // cache-flush scenario. The gate must not render the fallback baseline
  // as a live COP value.
  it('suppresses COP label when HP is running but performance is in fallback', () => {
    render(
      <StatusBanner
        {...baseProps}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 1.2,
          thermal_output_kw: 3.0,
          thermal_output_source: 'computed',
          performance: { value: 2.5, source: 'config' },
          flow_temp: 38,
          return_temp: 33,
          delta_t: 5,
          flow_rate: 0.3,
        }}
      />
    )
    expect(screen.queryByText(/COP/)).toBeNull()
  })
})

describe('StatusBanner performance label gating', () => {
  const hpBaseProps = {
    ...baseProps,
    heatSource: {
      ...baseProps.heatSource,
      type: 'heat_pump' as const,
    },
  }

  const boilerBaseProps = {
    ...baseProps,
    heatSource: {
      type: 'gas_boiler' as const,
      input_power_kw: 8.0,
      thermal_output_kw: 6.8,
      thermal_output_source: 'computed' as const,
      performance: { value: 0.85, source: 'config' as const },
      flow_temp: 65,
      return_temp: 50,
      delta_t: 15,
      flow_rate: 0.4,
    },
  }

  it('HP running live: renders COP label', () => {
    render(
      <StatusBanner
        {...hpBaseProps}
        heatSource={{
          ...hpBaseProps.heatSource,
          input_power_kw: 2.1,
          performance: { value: 3.6, source: 'live' },
        }}
      />
    )
    expect(screen.getByText(/COP 3\.6/)).toBeDefined()
  })

  it('HP off (post-128A fix): suppresses COP label', () => {
    render(
      <StatusBanner
        {...hpBaseProps}
        heatSource={{
          ...hpBaseProps.heatSource,
          input_power_kw: 0.0,
          performance: { value: 2.5, source: 'config' },
        }}
      />
    )
    expect(screen.queryByText(/COP/)).toBeNull()
  })

  it('HP sensor-loss fallback: suppresses COP label', () => {
    render(
      <StatusBanner
        {...hpBaseProps}
        heatSource={{
          ...hpBaseProps.heatSource,
          input_power_kw: 2.1,
          performance: { value: 2.5, source: 'config' },
        }}
      />
    )
    expect(screen.queryByText(/COP/)).toBeNull()
  })

  it('Boiler running: renders η label', () => {
    render(<StatusBanner {...boilerBaseProps} />)
    expect(screen.getByText(/η 0\.85/)).toBeDefined()
  })

  it('Boiler off (input below 0.5 kW threshold): suppresses η label — 128B Finding 4', () => {
    render(
      <StatusBanner
        {...boilerBaseProps}
        heatSource={{
          ...boilerBaseProps.heatSource,
          input_power_kw: 0.0,
        }}
      />
    )
    expect(screen.queryByText(/η/)).toBeNull()
  })

  it('Boiler just above off threshold (0.5 kW): renders η label', () => {
    render(
      <StatusBanner
        {...boilerBaseProps}
        heatSource={{
          ...boilerBaseProps.heatSource,
          input_power_kw: 0.5,
        }}
      />
    )
    expect(screen.getByText(/η 0\.85/)).toBeDefined()
  })

  it('Boiler just below off threshold (0.49 kW): suppresses η label', () => {
    render(
      <StatusBanner
        {...boilerBaseProps}
        heatSource={{
          ...boilerBaseProps.heatSource,
          input_power_kw: 0.49,
        }}
      />
    )
    expect(screen.queryByText(/η/)).toBeNull()
  })
})
