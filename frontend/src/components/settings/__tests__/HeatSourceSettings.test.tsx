/**
 * INSTRUCTION-236 — HeatSourceSettings is positively non-authoritative for
 * DHW signal keys (water_heater, hot_water_active, hot_water_boolean). The
 * fields are relocated to HotWaterSettings; HeatSourceSettings must NOT
 * render them and MUST NOT write them in its save payload, even when a
 * stale prop carries DHW values.
 *
 * Originally INSTRUCTION-127A (MQTT DHW signal parity inside HeatSourceSettings);
 * that contract is retired by INSTRUCTION-236.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { MqttConfig } from '../../../types/config'

const patch = vi.fn()

vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { HeatSourceSettings } from '../HeatSourceSettings'

const noop = () => {}
const baseHs = { type: 'heat_pump' as const, efficiency: 3.5 }

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({ updated: 'ok' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HeatSourceSettings — DHW relocation (INSTRUCTION-236)', () => {
  it('DHW signal fields are absent from the sensor section in both drivers', () => {
    ;(['ha', 'mqtt'] as const).forEach((driver) => {
      const { unmount } = render(
        <HeatSourceSettings
          heatSource={baseHs}
          driver={driver}
          mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
          onRefetch={noop}
        />,
      )
      fireEvent.click(screen.getByText(driver === 'mqtt' ? 'Sensor Topics' : 'Sensor Entities'))

      // HA: Water Heater EntityField removed.
      expect(screen.queryByText(/^Water Heater$/)).toBeNull()
      expect(screen.queryByPlaceholderText('water_heater.heat_pump')).toBeNull()

      // MQTT: Hot Water Signals sub-block (DHW Active primary + boolean) removed.
      expect(screen.queryByText('Hot Water Signals')).toBeNull()
      expect(screen.queryByText('DHW Active (primary)')).toBeNull()
      expect(screen.queryByText('DHW Active Boolean (optional OR)')).toBeNull()
      expect(screen.queryByPlaceholderText('heat_pump/dhw/active')).toBeNull()
      expect(screen.queryByPlaceholderText('heat_pump/dhw/demand_bool')).toBeNull()

      unmount()
    })
  })

  it('HeatSourceSettings save never includes DHW keys in patch payload, regardless of prop state', async () => {
    render(
      <HeatSourceSettings
        heatSource={{
          type: 'heat_pump',
          efficiency: 3.5,
          flow_min: 25,
          flow_max: 50,
          sensors: {
            // Stale prop carries DHW keys from a pre-236 save or a concurrent
            // HotWaterSettings tab. The HeatSource save MUST omit them.
            flow_temp: 'sensor.hp_flow_temp',
            water_heater: 'water_heater.STALE_VALUE',
            hot_water_boolean: 'binary_sensor.STALE_VALUE',
          },
        }}
        mqtt={{
          broker: 'localhost',
          port: 1883,
          // Stale MQTT prop too — though HeatSource no longer writes mqtt, prove it.
          inputs: {
            hot_water_active: { topic: 'qsh/dhw/STALE', format: 'plain' },
            hot_water_boolean: { topic: 'qsh/dhw/STALE2', format: 'plain' },
          },
        } as MqttConfig}
        driver="ha"
        onRefetch={noop}
      />,
    )

    // INSTRUCTION-237B: per-card Save replaces top-level "Save Changes".
    // Dirty the card first by editing its name (the only header-level field
    // that doesn't require expanding the body deeper).
    const nameInput = screen.getByLabelText('Source 1 name')
    fireEvent.change(nameInput, { target: { value: 'My HP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))

    await waitFor(() => {
      const hsCall = patch.mock.calls.find(c => c[0] === 'heat_sources')
      expect(hsCall).toBeDefined()
    })

    // INSTRUCTION-237A: frontend writes plural only. The backend
    // reconciles to singular when length == 1.
    const hsCall = patch.mock.calls.find(c => c[0] === 'heat_sources')!
    const sources = hsCall[1] as Array<{ sensors?: Record<string, unknown> }>
    expect(sources).toHaveLength(1)
    const body = sources[0]
    // Non-DHW sensor preserved.
    expect(body.sensors?.flow_temp).toBe('sensor.hp_flow_temp')
    // DHW keys explicitly omitted by the destructure in persist().
    expect(body.sensors?.water_heater).toBeUndefined()
    expect(body.sensors?.hot_water_boolean).toBeUndefined()
    // No singular heat_source patch ever.
    expect(patch.mock.calls.find(c => c[0] === 'heat_source')).toBeUndefined()
    // No MQTT patch fired — the entire branch was deleted in 236.
    expect(patch.mock.calls.find(c => c[0] === 'mqtt')).toBeUndefined()
  })

  it('MQTT driver: HeatSourceSettings save does not patch mqtt at all (DHW writes owned by HotWaterSettings)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        driver="mqtt"
        mqtt={{
          broker: 'mqtt.local',
          port: 1883,
          inputs: {
            hot_water_active: { topic: 'existing/active', format: 'plain' },
            outdoor_temp: { topic: 'sensors/outdoor_temp', format: 'plain' },
          },
        }}
        onRefetch={noop}
      />,
    )

    // Dirty + save (INSTRUCTION-237B per-card pattern).
    const nameInput = screen.getByLabelText('Source 1 name')
    fireEvent.change(nameInput, { target: { value: 'MQTT HP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('heat_sources', expect.any(Array))
    })
    // Crucial: no mqtt patch is fired from HeatSourceSettings.
    expect(patch.mock.calls.find(c => c[0] === 'mqtt')).toBeUndefined()
    // No singular heat_source patch either (237A).
    expect(patch.mock.calls.find(c => c[0] === 'heat_source')).toBeUndefined()
  })
})

/**
 * INSTRUCTION-237B — multi-card editor. Covers Add/Remove, per-card Save
 * writing the full array, structural-equality resync, new-unsaved cards,
 * rollback on persist failure, and the empty-payload guard.
 */
describe('HeatSourceSettings — multi-card editor (INSTRUCTION-237B)', () => {
  it('renders an "Add heat source" button (Task 3 case 1)', () => {
    render(
      <HeatSourceSettings heatSource={baseHs} driver="ha" onRefetch={noop} />,
    )
    expect(
      screen.getByRole('button', { name: /add heat source/i }),
    ).toBeInTheDocument()
  })

  it('renders one card when heatSources is length 1 (case 2)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'Only' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getAllByLabelText(/^Source \d+ name$/)).toHaveLength(1)
  })

  it('renders two cards when heatSources has two entries (case 3)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'Samsung HP' },
          { type: 'gas_boiler', name: 'Glowworm' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const nameInputs = screen.getAllByLabelText(/^Source \d+ name$/) as HTMLInputElement[]
    expect(nameInputs).toHaveLength(2)
    expect(nameInputs[0].value).toBe('Samsung HP')
    expect(nameInputs[1].value).toBe('Glowworm')
  })

  it('Add appends to local state without calling patch (case 4, V2 D-N1)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'S1' },
          { type: 'gas_boiler', name: 'S2' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getAllByLabelText(/^Source \d+ name$/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /add heat source/i }))
    expect(screen.getAllByLabelText(/^Source \d+ name$/)).toHaveLength(3)
    // V2 D-N1: Add must NOT call patch.
    expect(patch).not.toHaveBeenCalled()
    // The new card shows the "(new — unsaved)" badge.
    expect(screen.getByText(/new — unsaved/i)).toBeInTheDocument()
  })

  it('Add is disabled at MAX_HEAT_SOURCES (case 5)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'S1' },
          { type: 'gas_boiler', name: 'S2' },
          { type: 'lpg_boiler', name: 'S3' },
          { type: 'oil_boiler', name: 'S4' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(
      screen.getByRole('button', { name: /add heat source/i }),
    ).toBeDisabled()
    expect(screen.getByText(/Maximum 4 sources/i)).toBeInTheDocument()
  })

  it('Remove is disabled on the only card when length=1 (case 6)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'Only' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Remove source 1/i }),
    ).toBeDisabled()
  })

  it('Remove confirms then calls patch ONCE with the shortened array (case 7, V1 D-1)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'Keep' },
          { type: 'gas_boiler', name: 'Drop' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove source 2/i }))
    // Inline confirmation appears.
    expect(screen.getByText(/Remove this heat source\?/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ name?: string }>
      expect(payload).toHaveLength(1)
      expect(payload[0].name).toBe('Keep')
    })
    // No singular patch ever (D-1).
    expect(patch.mock.calls.find((c) => c[0] === 'heat_source')).toBeUndefined()
  })

  it('Edit fuel_cost_per_kwh on card 2 marks dirty; Save calls patch with the new value (case 8)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', efficiency: 3.5 },
          { type: 'gas_boiler', name: 'Boiler', efficiency: 0.88 },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Expand card 2 (gas_boiler). Each toggle button is uniquely labelled.
    fireEvent.click(screen.getByRole('button', { name: 'Expand source 2' }))
    // Edit fuel cost (only visible on non-HP). Use the input id rather
    // than label text — the HelpTip button inside the label confuses
    // getByLabelText with a multi-match.
    const fuelInput = document.getElementById(
      'source-1-fuel-cost',
    ) as HTMLInputElement
    expect(fuelInput).not.toBeNull()
    fireEvent.change(fuelInput, { target: { value: '0.075' } })
    // (unsaved) badge appears on card 2 (not new).
    expect(screen.getByText(/^\(unsaved\)$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save source 2' }))
    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ fuel_cost_per_kwh?: number; name?: string }>
      expect(payload).toHaveLength(2)
      expect(payload[0].name).toBe('HP')
      expect(payload[0].fuel_cost_per_kwh).toBeUndefined() // unchanged
      expect(payload[1].fuel_cost_per_kwh).toBe(0.075)
    })
  })

  it('Two cards dirty — Save on one persists BOTH and clears both indicators (case 9)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP' },
          { type: 'gas_boiler', name: 'Boiler' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Dirty card 1 by changing its name.
    const name1 = screen.getAllByLabelText(/^Source \d+ name$/)[0] as HTMLInputElement
    fireEvent.change(name1, { target: { value: 'HP Renamed' } })
    // Dirty card 2 by changing its name.
    const name2 = screen.getAllByLabelText(/^Source \d+ name$/)[1] as HTMLInputElement
    fireEvent.change(name2, { target: { value: 'Boiler Renamed' } })

    // Two (unsaved) badges visible.
    expect(screen.getAllByText(/^\(unsaved\)$/)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ name?: string }>
      // Per-card Save writes the FULL array — both names persisted.
      expect(payload[0].name).toBe('HP Renamed')
      expect(payload[1].name).toBe('Boiler Renamed')
    })
    // Both badges cleared.
    expect(screen.queryAllByText(/^\(unsaved\)$/)).toHaveLength(0)
  })

  it('Save while a different card has pending edits — payload includes the other card\'s edits (case 10)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'A' },
          { type: 'gas_boiler', name: 'B' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // User edits card 1 (A) — they intended to save this card.
    const name1 = screen.getAllByLabelText(/^Source \d+ name$/)[0] as HTMLInputElement
    fireEvent.change(name1, { target: { value: 'A-edited' } })
    // ... then notices card 2 also has a pending edit they forgot about.
    const name2 = screen.getAllByLabelText(/^Source \d+ name$/)[1] as HTMLInputElement
    fireEvent.change(name2, { target: { value: 'B-also-edited' } })
    // The user clicks Save on card 1 (where they think their edit lives).
    // Task 1d documents this: per-card Save writes the FULL array, so
    // card 2's unsaved edit is also persisted. The Save tooltip surfaces
    // this UX explicitly (V2 N-N2).
    const saveBtn = screen.getByRole('button', { name: 'Save source 1' })
    expect(saveBtn).toHaveAttribute(
      'title',
      'Save — persists changes on all cards',
    )
    fireEvent.click(saveBtn)
    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ name?: string }>
      expect(payload[0].name).toBe('A-edited')
      // Other card's unsaved edit included — no data loss.
      expect(payload[1].name).toBe('B-also-edited')
    })
  })

  it('Resync: structurally identical prop change does NOT stomp dirty edits (case 11, V1 D-3)', () => {
    const initial: HeatSourceYamlT = { type: 'heat_pump', name: 'HP' }
    const { rerender } = render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[initial]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const nameInput = screen.getByLabelText('Source 1 name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Dirty Name' } })
    expect(screen.getByText(/^\(unsaved\)$/)).toBeInTheDocument()

    // Parent re-fetches and passes a NEW reference with IDENTICAL content.
    rerender(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'HP' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Local edit survived — structural equality guard prevented stomp.
    expect((screen.getByLabelText('Source 1 name') as HTMLInputElement).value).toBe(
      'Dirty Name',
    )
    expect(screen.getByText(/^\(unsaved\)$/)).toBeInTheDocument()
  })

  it('Resync: structurally DIFFERENT prop change DOES reset (case 12)', () => {
    const { rerender } = render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'Old' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    rerender(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'New' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect((screen.getByLabelText('Source 1 name') as HTMLInputElement).value).toBe(
      'New',
    )
    expect(screen.queryByText(/^\(unsaved\)$/)).toBeNull()
  })

  it('SourceSelectionSettings receives sourceNames reflecting edited names (case 13)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'Alpha' },
          { type: 'gas_boiler', name: 'Beta' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // SourceSelectionSettings renders one radio per name (228B). Confirm
    // both names appear before edit.
    expect(screen.getByText(/Lock to Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Lock to Beta/)).toBeInTheDocument()

    // Edit the first card's name; SourceSelectionSettings prop updates.
    const name1 = screen.getAllByLabelText(/^Source \d+ name$/)[0] as HTMLInputElement
    fireEvent.change(name1, { target: { value: 'Alpha-Renamed' } })
    expect(screen.getByText(/Lock to Alpha-Renamed/)).toBeInTheDocument()
    expect(screen.queryByText(/Lock to Alpha$/)).toBeNull()
  })

  it('fuel_cost fields visible for gas_boiler card, hidden for heat_pump card (case 14)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP' },
          { type: 'gas_boiler', name: 'Boiler' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Card 1 (HP) is expanded by default — no fuel cost field on disk.
    expect(document.getElementById('source-0-fuel-cost')).toBeNull()
    // Expand card 2 (gas_boiler).
    fireEvent.click(screen.getByRole('button', { name: 'Expand source 2' }))
    expect(document.getElementById('source-1-fuel-cost')).not.toBeNull()
  })

  it('Frontend writes ONLY heat_sources (plural) across the whole suite (case 15, V1 D-1 complete)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'A' },
          { type: 'gas_boiler', name: 'B' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const name1 = screen.getAllByLabelText(/^Source \d+ name$/)[0] as HTMLInputElement
    fireEvent.change(name1, { target: { value: 'A-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      expect(patch).toHaveBeenCalled()
    })
    // Global assertion: every patch call is for 'heat_sources', never 'heat_source'.
    for (const call of patch.mock.calls) {
      expect(call[0]).not.toBe('heat_source')
    }
  })

  it('Carbon-factor placeholder is display-only (case 16, V2 G-N3)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'gas_boiler', name: 'B' } as HeatSourceYamlT,
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Query by id — getByLabelText is ambiguous because the HelpTip
    // button is rendered inside the <label>.
    const input = document.getElementById(
      'source-0-carbon-factor',
    ) as HTMLInputElement
    expect(input).not.toBeNull()
    // Placeholder reflects the type-aware default; value is empty.
    expect(input.placeholder).toBe('0.183')
    expect(input.value).toBe('')

    // Rendering must NOT have triggered patch with a carbon_factor.
    expect(patch).not.toHaveBeenCalled()

    // Typing materialises the value into state.
    fireEvent.change(input, { target: { value: '0.2' } })
    expect(
      (document.getElementById('source-0-carbon-factor') as HTMLInputElement).value,
    ).toBe('0.2')
    // The (unsaved) badge appears on this card.
    expect(screen.getByText(/^\(unsaved\)$/)).toBeInTheDocument()
  })

  it('Pump max-speed placeholder is display-only (case 17, V3 G-V3-2)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'gas_boiler', name: 'B' } as HeatSourceYamlT,
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const input = document.getElementById(
      'source-0-pump-max-speed',
    ) as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.placeholder).toBe('100')
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: '80' } })
    expect(
      (document.getElementById('source-0-pump-max-speed') as HTMLInputElement).value,
    ).toBe('80')
    expect(screen.getByText(/^\(unsaved\)$/)).toBeInTheDocument()
  })

  it('Remove rolls back when patch resolves false (case 18a, V3 D-V3-1)', async () => {
    patch.mockReset()
    patch.mockResolvedValue(null) // usePatchConfig returns null on failure
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'Keep' },
          { type: 'gas_boiler', name: 'Drop' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove source 2/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => {
      expect(patch).toHaveBeenCalled()
    })
    // Local state rolled back — card 2 returns.
    await waitFor(() => {
      const nameInputs = screen.getAllByLabelText(/^Source \d+ name$/) as HTMLInputElement[]
      expect(nameInputs).toHaveLength(2)
      expect(nameInputs[1].value).toBe('Drop')
    })
    // No spurious (unsaved) badges on either card — both still match
    // lastSavedRef.
    expect(screen.queryByText(/^\(unsaved\)$/)).toBeNull()
  })

  it('Remove rolls back when patch throws (case 18b, V4 G-V4-1)', async () => {
    patch.mockReset()
    patch.mockRejectedValue(new Error('network'))
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'Keep' },
          { type: 'gas_boiler', name: 'Drop' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove source 2/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => {
      expect(patch).toHaveBeenCalled()
    })
    await waitFor(() => {
      const nameInputs = screen.getAllByLabelText(/^Source \d+ name$/) as HTMLInputElement[]
      expect(nameInputs).toHaveLength(2)
    })
    expect(screen.queryByText(/^\(unsaved\)$/)).toBeNull()
  })

  it('Remove excludes new-unsaved cards from PATCH (case 19, V3 D-V3-2)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'c1' },
          { type: 'gas_boiler', name: 'c2' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Add a new card — local-state only, no patch.
    fireEvent.click(screen.getByRole('button', { name: /add heat source/i }))
    expect(patch).not.toHaveBeenCalled()
    expect(screen.getByText(/new — unsaved/i)).toBeInTheDocument()

    // Remove card 1 (the FIRST saved card). The PATCH payload must
    // exclude the new-unsaved card 3.
    fireEvent.click(screen.getByRole('button', { name: /Remove source 1/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ name?: string }>
      // PATCH contains ONLY c2 — new-unsaved card excluded.
      expect(payload).toHaveLength(1)
      expect(payload[0].name).toBe('c2')
    })

    // Local state retains the new-unsaved card.
    await waitFor(() => {
      const nameInputs = screen.getAllByLabelText(/^Source \d+ name$/)
      expect(nameInputs).toHaveLength(2)
    })
    expect(screen.getByText(/new — unsaved/i)).toBeInTheDocument()

    // Now Save the new card explicitly — both cards reach disk.
    fireEvent.click(screen.getByRole('button', { name: 'Save source 2' }))
    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(2)
      const payload2 = calls[1][1] as Array<{ name?: string }>
      expect(payload2).toHaveLength(2)
      expect(payload2[0].name).toBe('c2')
      expect(payload2[1].name).toMatch(/Source \d+/) // auto-generated
    })
    // The (new — unsaved) badge clears.
    expect(screen.queryByText(/new — unsaved/i)).toBeNull()
  })

  it('Empty-payload Remove is refused before PATCH (case 20, V5 D-V4-1)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'c0' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // Add two new cards — both new-unsaved, no patch.
    const addBtn = screen.getByRole('button', { name: /add heat source/i })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)
    expect(screen.getAllByText(/new — unsaved/i)).toHaveLength(2)
    expect(patch).not.toHaveBeenCalled()

    // Try to remove c0 (the only saved card).
    fireEvent.click(screen.getByRole('button', { name: /Remove source 1/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    // No patch fires.
    expect(patch).not.toHaveBeenCalled()
    // Card c0 still in the DOM.
    expect(
      (screen.getAllByLabelText(/^Source \d+ name$/)[0] as HTMLInputElement).value,
    ).toBe('c0')
    // Alert banner rendered.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/cannot remove.*unsaved/i)

    // Dismiss the alert.
    fireEvent.click(screen.getByRole('button', { name: /Dismiss error/i }))
    expect(screen.queryByRole('alert')).toBeNull()
    // Cards still intact.
    expect(screen.getAllByLabelText(/^Source \d+ name$/)).toHaveLength(3)
  })
})

// Re-import type after the new block so the test file remains
// import-order-clean. The `HeatSourceYamlT` alias avoids re-importing the
// real type if the existing top-of-file import is sufficient.
type HeatSourceYamlT = import('../../../types/config').HeatSourceYaml

/**
 * INSTRUCTION-241C Task 3 — settings-component render tests for the
 * shared `mqttSensorPlaceholder` helper. Two cases only; the table-driven
 * helper-unit tests live at frontend/src/lib/__tests__/mqtt-placeholders.test.ts
 * per 241B Task 0 (M5 disposition).
 */
describe('HeatSourceSettings — MQTT placeholder differentiation (INSTRUCTION-241C Task 3)', () => {
  it('Test 1: collision-disambiguated render — two same-type sources get name-derived placeholders', () => {
    const heatSources: HeatSourceYamlT[] = [
      { type: 'heat_pump', name: 'Main HP' },
      { type: 'heat_pump', name: 'Garage HP' },
    ]
    render(
      <HeatSourceSettings
        heatSource={heatSources[0]}
        heatSources={heatSources}
        driver="mqtt"
        mqtt={{ broker: 'localhost', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    // Card 1 is expanded by default — expand its Sensor Topics block.
    fireEvent.click(screen.getByRole('button', { name: 'Sensor Topics' }))
    expect(
      screen.getByPlaceholderText('main_hp_hp/flow_temp'),
    ).toBeInTheDocument()

    // Switch to card 2 — click the Expand button for source 2.
    fireEvent.click(screen.getByRole('button', { name: 'Expand source 2' }))
    // Now expand card 2's Sensor Topics block.
    fireEvent.click(screen.getByRole('button', { name: 'Sensor Topics' }))
    expect(
      screen.getByPlaceholderText('garage_hp_hp/flow_temp'),
    ).toBeInTheDocument()
  })

  it('Test 2: single-source legacy continuity — placeholder uses heat_pump stem', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'heat_pump', name: 'Primary' }}
        heatSources={[{ type: 'heat_pump', name: 'Primary' }]}
        driver="mqtt"
        mqtt={{ broker: 'localhost', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    // Expand sensor topics.
    fireEvent.click(screen.getByRole('button', { name: 'Sensor Topics' }))
    // Single source — legacy heat_pump/<slot> form retained.
    expect(
      screen.getByPlaceholderText('heat_pump/flow_temp'),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('heat_pump/power_input'),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('heat_pump/cop'),
    ).toBeInTheDocument()
  })
})

/**
 * INSTRUCTION-241C Task 6 — save-error banner surfaces backend detail
 * verbatim on PATCH failure (e.g. duplicate-topic 400 from §D-6).
 */
describe('HeatSourceSettings — save-error banner (INSTRUCTION-241C Task 6)', () => {
  it('Test 1: 400 with detail body — banner renders the backend prose verbatim', async () => {
    const heatSources: HeatSourceYamlT[] = [
      { type: 'heat_pump', name: 'Main' },
      { type: 'heat_pump', name: 'Garage' },
    ]
    // First call (via patch hook) → null on error. Second call (sibling
    // fetch in persist) → 400 with detail body.
    patch.mockResolvedValue(null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        detail:
          "Duplicate sensor topic 'foo/bar' assigned to both (Main, flow_temp) and (Garage, flow_temp). Per INSTRUCTION-241C §D-6 the same topic may not feed two heat sources — silent data fusion.",
      }),
    } as unknown as Response)

    render(
      <HeatSourceSettings
        heatSource={heatSources[0]}
        heatSources={heatSources}
        driver="mqtt"
        mqtt={{ broker: 'localhost', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )

    // Dirty + save card 1.
    const nameInput = screen.getAllByLabelText(/^Source \d+ name$/)[0] as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeInTheDocument()
    })
    const alertText = screen.getByRole('alert').textContent ?? ''
    expect(alertText).toContain("Duplicate sensor topic 'foo/bar'")
    expect(alertText).toContain('(Main, flow_temp)')
    expect(alertText).toContain('(Garage, flow_temp)')

    fetchSpy.mockRestore()
  })

  it('Test 2: 500 without parseable body — banner falls back to HTTP status', async () => {
    patch.mockResolvedValue(null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not JSON')
      },
    } as unknown as Response)

    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'A' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const nameInput = screen.getByLabelText(/^Source 1 name$/) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/HTTP 500/)
    })
    fetchSpy.mockRestore()
  })

  it('Test 3: network failure — banner reads "Save failed — network error"', async () => {
    patch.mockResolvedValue(null)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('NetworkError when attempting to fetch'))

    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'A' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const nameInput = screen.getByLabelText(/^Source 1 name$/) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Save failed — network error/)
    })
    fetchSpy.mockRestore()
  })
})

describe('HeatSourceSettings — GSHP source type (INSTRUCTION-242)', () => {
  it('renders COP label (not Efficiency) for gshp source', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'gshp', efficiency: 4.0 }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getByText(/^COP$/)).toBeInTheDocument()
  })

  it('does not render fuel cost block for gshp source (HP-class suppression)', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'gshp', efficiency: 4.0 }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // The carbon factor / fuel cost field labels are gated on isNonHp.
    // For a gshp source isHeatPumpType is true → isNonHp is false → block hidden.
    expect(screen.queryByText(/^Fuel cost/i)).toBeNull()
  })

  it('exposes gshp as a selectable source type in the type picker', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'heat_pump' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // The type picker exposes each source-type literal with underscores
    // converted to spaces. 'gshp' renders as 'gshp' verbatim.
    expect(screen.getByRole('button', { name: 'gshp' })).toBeInTheDocument()
  })
})

/**
 * INSTRUCTION-245 — Settings Heat Source card renders TopicPicker for
 * fuel_cost_entity and carbon_factor_entity on MQTT driver, round-trips
 * MqttTopicInput objects through onChange, and retains the EntityField on
 * the HA driver. Fields render only for non-HP source types (gas_boiler,
 * lpg_boiler, oil_boiler) per existing isNonHp gate.
 */
describe('HeatSourceSettings — MQTT driver fuel cost / carbon factor topics (INSTRUCTION-245)', () => {
  it('MQTT driver: fuel cost TopicPicker JSON-payload checkbox appears after typing a topic', async () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'lpg_boiler', name: 'Boiler' }}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    const input = screen.getByPlaceholderText('qsh/sources/boiler/cost') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'qsh/sources/boiler/cost' } })
    expect(screen.getByText('JSON payload')).toBeInTheDocument()
  })

  it('MQTT driver: pre-existing MqttTopicInput on fuel_cost_entity hydrates and saves the dict form', async () => {
    render(
      <HeatSourceSettings
        heatSource={{
          type: 'lpg_boiler',
          name: 'Boiler',
          fuel_cost_entity: {
            topic: 'qsh/sources/boiler/cost',
            format: 'json',
            json_path: 'value.rate',
          },
        }}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    const input = screen.getByPlaceholderText('qsh/sources/boiler/cost') as HTMLInputElement
    expect(input.value).toBe('qsh/sources/boiler/cost')
    // Dirty the card (any field) and save — the saved payload should retain
    // the object shape on fuel_cost_entity.
    fireEvent.change(screen.getByLabelText('Source 1 name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('heat_sources', expect.any(Array))
    })
    const hsCall = patch.mock.calls.find((c) => c[0] === 'heat_sources')!
    const sources = hsCall[1] as Array<{ fuel_cost_entity?: unknown }>
    expect(sources[0].fuel_cost_entity).toEqual({
      topic: 'qsh/sources/boiler/cost',
      format: 'json',
      json_path: 'value.rate',
    })
  })

  it('HA driver: fuel cost field is a plain entity input (no JSON checkbox)', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'lpg_boiler', name: 'Boiler' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    // EntityField uses the placeholder string passed through.
    expect(screen.getByPlaceholderText('sensor.gas_unit_rate')).toBeInTheDocument()
    expect(screen.queryByText('JSON payload')).toBeNull()
  })

  it('MQTT driver: carbon factor TopicPicker JSON checkbox appears after typing a topic', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'lpg_boiler', name: 'Boiler' }}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    const input = screen.getByPlaceholderText('qsh/grid/co2_factor') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'qsh/grid/co2_factor' } })
    expect(screen.getByText('JSON payload')).toBeInTheDocument()
  })

  it('MQTT driver: pre-existing MqttTopicInput on carbon_factor_entity hydrates and saves the dict form', async () => {
    render(
      <HeatSourceSettings
        heatSource={{
          type: 'lpg_boiler',
          name: 'Boiler',
          carbon_factor_entity: {
            topic: 'qsh/grid/co2_factor',
            format: 'json',
            json_path: 'value.kgco2_per_kwh',
          },
        }}
        driver="mqtt"
        mqtt={{ broker: 'mqtt.local', port: 1883, inputs: {} }}
        onRefetch={noop}
      />,
    )
    const input = screen.getByPlaceholderText('qsh/grid/co2_factor') as HTMLInputElement
    expect(input.value).toBe('qsh/grid/co2_factor')
    fireEvent.change(screen.getByLabelText('Source 1 name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('heat_sources', expect.any(Array))
    })
    const hsCall = patch.mock.calls.find((c) => c[0] === 'heat_sources')!
    const sources = hsCall[1] as Array<{ carbon_factor_entity?: unknown }>
    expect(sources[0].carbon_factor_entity).toEqual({
      topic: 'qsh/grid/co2_factor',
      format: 'json',
      json_path: 'value.kgco2_per_kwh',
    })
  })

  it('HA driver: carbon factor field is a plain entity input (no JSON checkbox)', () => {
    render(
      <HeatSourceSettings
        heatSource={{ type: 'lpg_boiler', name: 'Boiler' }}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getByPlaceholderText('sensor.grid_carbon_intensity')).toBeInTheDocument()
    expect(screen.queryByText('JSON payload')).toBeNull()
  })
})

/**
 * INSTRUCTION-308 — non-primary MQTT sources must persist
 * flow_control.method="mqtt" so resolve_source_routing dispatches their
 * per-source Flow/Mode topics. Scoped to non-primary (§1.7): the primary
 * (payload[0], by name) is NEVER stamped and a stale stamp is stripped. The
 * primary name is computed at the persist() emit point from the OUTGOING
 * payload, so it is robust to in-session removal that reassigns the primary.
 */
describe('HeatSourceSettings — non-primary MQTT method stamp (INSTRUCTION-308)', () => {
  const mqttSrc = (name: string, prefix: string, extra: Record<string, unknown> = {}) => ({
    type: 'gas_boiler' as const,
    name,
    flow_control: { topic: `qsh/${prefix}/flow`, mode_topic: `qsh/${prefix}/mode`, ...extra },
  })

  it('Save stamps method=mqtt on every non-primary source and none on the primary (Task 3c.1)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', flow_control: { topic: 'qsh/hp/flow', mode_topic: 'qsh/hp/mode' } },
          mqttSrc('Boiler', 'boiler'),
          mqttSrc('Immersion', 'imm'),
        ]}
        driver="mqtt"
        onRefetch={noop}
      />,
    )
    // Dirty source 2 so its per-card Save (which persists the full array) enables.
    fireEvent.change(screen.getByLabelText('Source 2 name'), { target: { value: 'Boiler2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 2' }))

    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{
        name?: string
        flow_control?: { method?: string; topic?: string; mode_topic?: string }
      }>
      expect(payload).toHaveLength(3)
      // Primary (index 0) NOT stamped — stays on the shared topic (279).
      expect(payload[0].flow_control?.method).toBeUndefined()
      // Non-primary stamped; per-source topics intact.
      expect(payload[1].flow_control?.method).toBe('mqtt')
      expect(payload[1].flow_control?.topic).toBe('qsh/boiler/flow')
      expect(payload[2].flow_control?.method).toBe('mqtt')
    })
  })

  it('Remove-the-primary recomputes the primary at emit; the new primary is unstamped (Task 3c.2, §1.7 (c))', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', flow_control: { topic: 'qsh/hp/flow', mode_topic: 'qsh/hp/mode' } },
          mqttSrc('Boiler', 'boiler'),
          mqttSrc('Immersion', 'imm'),
        ]}
        driver="mqtt"
        onRefetch={noop}
      />,
    )
    // Remove source 1 (the as-loaded primary) → 'Boiler' becomes payload[0].
    fireEvent.click(screen.getByRole('button', { name: 'Remove source 1' }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ name?: string; flow_control?: { method?: string } }>
      expect(payload).toHaveLength(2)
      // The NEW primary (old index 1) is emitted WITHOUT a method.
      expect(payload[0].name).toBe('Boiler')
      expect(payload[0].flow_control?.method).toBeUndefined()
      // The remaining non-primary still carries it.
      expect(payload[1].name).toBe('Immersion')
      expect(payload[1].flow_control?.method).toBe('mqtt')
    })
  })

  it('Stale method on a source promoted to primary by removal is stripped (Task 3c.3, §1.7 (c))', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', flow_control: { topic: 'qsh/hp/flow', mode_topic: 'qsh/hp/mode' } },
          // Boiler carries a stale method='mqtt' from when it was non-primary.
          mqttSrc('Boiler', 'boiler', { method: 'mqtt' }),
        ]}
        driver="mqtt"
        onRefetch={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove source 1' }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{
        name?: string
        flow_control?: { method?: string; topic?: string; mode_topic?: string }
      }>
      expect(payload).toHaveLength(1)
      expect(payload[0].name).toBe('Boiler')
      // Stale stamp stripped; per-source topics preserved.
      expect(payload[0].flow_control?.method).toBeUndefined()
      expect(payload[0].flow_control?.topic).toBe('qsh/boiler/flow')
    })
  })

  it('HA driver: no method is stamped on save (axis guard)', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP' },
          { type: 'gas_boiler', name: 'Boiler' },
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.change(screen.getByLabelText('Source 2 name'), { target: { value: 'Boiler2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 2' }))

    await waitFor(() => {
      const calls = patch.mock.calls.filter((c) => c[0] === 'heat_sources')
      expect(calls).toHaveLength(1)
      const payload = calls[0][1] as Array<{ flow_control?: { method?: string } }>
      expect(payload[0].flow_control?.method).toBeUndefined()
      expect(payload[1].flow_control?.method).toBeUndefined()
    })
  })
})

/**
 * INSTRUCTION-339C — per-source response_timeout_s (dead-time gate) field:
 * renders with the resolved per-type default as placeholder, materialises the
 * parsed number, flags out-of-range inline, and round-trips a saved value.
 */
describe('HeatSourceSettings — response timeout (INSTRUCTION-339C)', () => {
  it('renders the field with the HP resolved-default placeholder (180)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'HP' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const input = document.getElementById(
      'source-0-response-timeout',
    ) as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.placeholder).toBe('default 180')
    expect(input.value).toBe('')
  })

  it('shows the boiler resolved-default placeholder (300)', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'gas_boiler', name: 'Boiler' } as HeatSourceYamlT]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const input = document.getElementById(
      'source-0-response-timeout',
    ) as HTMLInputElement
    expect(input.placeholder).toBe('default 300')
  })

  it('editing materialises the parsed number and marks the card unsaved', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[{ type: 'heat_pump', name: 'HP' }]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    const input = document.getElementById(
      'source-0-response-timeout',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: '240' } })
    expect(
      (document.getElementById('source-0-response-timeout') as HTMLInputElement)
        .value,
    ).toBe('240')
    expect(screen.getByText(/^\(unsaved\)$/)).toBeInTheDocument()
  })

  it('out-of-range value shows an inline error', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', response_timeout_s: 1000 } as HeatSourceYamlT,
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.getByText(/Must be between 30 and 900/)).toBeInTheDocument()
  })

  it('in-range value shows no inline error', () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', response_timeout_s: 240 } as HeatSourceYamlT,
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    expect(screen.queryByText(/Must be between 30 and 900/)).toBeNull()
    expect(
      (document.getElementById('source-0-response-timeout') as HTMLInputElement)
        .value,
    ).toBe('240')
  })

  it('round-trips a saved response_timeout_s in the persist payload', async () => {
    render(
      <HeatSourceSettings
        heatSource={baseHs}
        heatSources={[
          { type: 'heat_pump', name: 'HP', response_timeout_s: 240 } as HeatSourceYamlT,
        ]}
        driver="ha"
        onRefetch={noop}
      />,
    )
    fireEvent.change(screen.getByLabelText('Source 1 name'), {
      target: { value: 'HP2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save source 1' }))
    await waitFor(() => {
      const hsCall = patch.mock.calls.find((c) => c[0] === 'heat_sources')!
      const sources = hsCall[1] as Array<{ response_timeout_s?: number }>
      expect(sources[0].response_timeout_s).toBe(240)
    })
  })
})
