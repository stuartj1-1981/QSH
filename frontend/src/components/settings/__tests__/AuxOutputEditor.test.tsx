import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuxOutputEditor } from '../AuxOutputEditor'

describe('AuxOutputEditor', () => {
  // ── 1. disabled state renders only the toggle ─────────────────────────────
  it('renders disabled state with checkbox unchecked and no fields', () => {
    render(
      <AuxOutputEditor
        value={null}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    const checkbox = screen.getByRole('checkbox', { name: /enable auxiliary output/i })
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByLabelText(/HA entity/i)).toBeNull()
    expect(screen.queryByLabelText(/Rated kW/i)).toBeNull()
  })

  // ── 2. enabling shows defaults and calls onChange with default block ───
  it('enabling calls onChange with default block', () => {
    const onChange = vi.fn()
    render(
      <AuxOutputEditor
        value={null}
        onChange={onChange}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /enable auxiliary output/i }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        rated_kw: 0,
        min_on_time_s: 60,
        min_off_time_s: 60,
        max_cycles_per_hour: 6,
      })
    )
  })

  // ── 3. disabling calls onChange(null) ─────────────────────────────────────
  it('disabling calls onChange with null', () => {
    const onChange = vi.fn()
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x' }}
        onChange={onChange}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /enable auxiliary output/i }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  // ── 4. HA driver shows EntityField, hides TopicField ──────────────────────
  it('HA driver renders the entity field, not the topic field', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x' }}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(screen.getByPlaceholderText('switch.lounge_panel_heater')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('control/lounge/aux')).toBeNull()
  })

  // ── 5. MQTT driver shows TopicField, hides EntityField ────────────────────
  it('MQTT driver renders the topic field, not the entity field', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, mqtt_topic: 'control/x' }}
        onChange={() => {}}
        driver="mqtt"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(screen.getByPlaceholderText('control/lounge/aux')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('switch.lounge_panel_heater')).toBeNull()
  })

  // ── 6. out-of-range rated_kw renders warning ─────────────────────────────
  it('out-of-range rated_kw renders warning text', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x', rated_kw: 12.0 }}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(screen.getByText(/Rated kW > 10/i)).toBeInTheDocument()
  })

  // ── 7. V2 / H1 — rated_kw is in primary visible row, not behind disclosure ──
  it('rated_kw input is in primary row; protection numerics are inside the engineering disclosure', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x' }}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    // Rated kW must NOT be a descendant of the <details> disclosure.
    const ratedLabel = screen.getByText(/^Rated kW$/i)
    expect(ratedLabel.closest('details')).toBeNull()
    // The three protection numerics MUST be descendants of the <details>.
    const minOn = screen.getByText(/^Min on time \(s\)$/i)
    const minOff = screen.getByText(/^Min off time \(s\)$/i)
    const maxCycles = screen.getByText(/^Max cycles per hour$/i)
    expect(minOn.closest('details')).not.toBeNull()
    expect(minOff.closest('details')).not.toBeNull()
    expect(maxCycles.closest('details')).not.toBeNull()
  })

  // ── 8. V2 / M2 — onValidityChange callback ────────────────────────────────
  it('onValidityChange fires false when enabled with empty target field', () => {
    const onValidityChange = vi.fn()
    render(
      <AuxOutputEditor
        value={{ enabled: true }}
        onChange={() => {}}
        onValidityChange={onValidityChange}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(onValidityChange).toHaveBeenCalledWith(false)
  })

  it('onValidityChange fires true when target field is filled', () => {
    const onValidityChange = vi.fn()
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x' }}
        onChange={() => {}}
        onValidityChange={onValidityChange}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(onValidityChange).toHaveBeenCalledWith(true)
  })

  it('onValidityChange fires true when value is null (disabled)', () => {
    const onValidityChange = vi.fn()
    render(
      <AuxOutputEditor
        value={null}
        onChange={() => {}}
        onValidityChange={onValidityChange}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(onValidityChange).toHaveBeenCalledWith(true)
  })

  it('shows inline "required" hint when target field is empty', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true }}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(screen.getByText(/Required when auxiliary output is enabled/i)).toBeInTheDocument()
  })

  // ── 9. V2 / M3 — resolved=undefined renders plain-text fallback ──────────
  it('renders plain-text fallback when resolved is undefined (HA driver)', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x' }}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={undefined}
      />
    )
    // The input must still be present
    expect(screen.getByPlaceholderText('switch.lounge_panel_heater')).toBeInTheDocument()
    // Editor does not crash and renders the rated_kw field
    expect(screen.getByText(/^Rated kW$/i)).toBeInTheDocument()
  })

  it('does not crash when resolved is undefined and target field is empty', () => {
    expect(() =>
      render(
        <AuxOutputEditor
          value={{ enabled: true }}
          onChange={() => {}}
          driver="ha"
          controlMode="indirect"
          resolved={undefined}
        />
      )
    ).not.toThrow()
  })

  // ── Bonus: control_mode=none, rated_kw=0 sysid warning ───────────────────
  it('control_mode=none with rated_kw=0 shows sysid warning', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'switch.x', rated_kw: 0 }}
        onChange={() => {}}
        driver="ha"
        controlMode="none"
        resolved={{}}
      />
    )
    expect(screen.getByText(/sysid will not learn U\/C/i)).toBeInTheDocument()
  })

  // ── Bonus: HA prefix warning ───────────────────────────────────────────────
  it('HA entity without switch./input_boolean. prefix shows warning', () => {
    render(
      <AuxOutputEditor
        value={{ enabled: true, ha_entity: 'sensor.bogus' }}
        onChange={() => {}}
        driver="ha"
        controlMode="indirect"
        resolved={{}}
      />
    )
    expect(screen.getByText(/should start with switch\. or input_boolean\./i)).toBeInTheDocument()
  })
})
