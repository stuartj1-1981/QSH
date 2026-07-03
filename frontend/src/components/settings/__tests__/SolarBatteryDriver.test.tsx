import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../hooks/useConfig', () => ({
  patchOrDelete: vi.fn().mockResolvedValue({}),
}))

import { patchOrDelete } from '../../../hooks/useConfig'

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

// INSTRUCTION-227C Task 6 — mock useSysid so the new observed-kWp row
// has predictable data. Set the return value per-test to exercise each
// of the four states from the 227B envelope contract.
const mockUseSysid = vi.fn((): { data: unknown; error: string | null } => ({
  data: null,
  error: null,
}))
vi.mock('../../../hooks/useSysid', () => ({
  useSysid: () => mockUseSysid(),
}))

import { SolarBatterySettings } from '../SolarBatterySettings'

const noop = () => {}

describe('SolarBatterySettings driver branching', () => {
  describe('Solar section', () => {
    it('HA driver: renders EntityField for solar production', () => {
      render(
        <SolarBatterySettings
          solar={{ production_entity: 'sensor.solar_power' }}
          driver="ha"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Solar Production Entity')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sensor.solar_power')).toBeInTheDocument()
      expect(screen.queryByText('Solar Production Topic')).toBeNull()
    })

    it('MQTT driver: renders TopicField for solar production', () => {
      render(
        <SolarBatterySettings
          solar={{ production_topic: 'solar/production_w' }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Solar Production Topic')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('solar/production_w')).toBeInTheDocument()
      expect(screen.queryByText('Solar Production Entity')).toBeNull()
    })
  })

  describe('Battery section', () => {
    it('HA driver: renders EntityField for battery SoC', () => {
      // soc_entity is set, so hasBattery starts true — content is already expanded
      render(
        <SolarBatterySettings
          battery={{ soc_entity: 'sensor.battery_soc' }}
          driver="ha"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Battery SoC Entity')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sensor.battery_soc')).toBeInTheDocument()
      expect(screen.queryByText('Battery SoC Topic')).toBeNull()
    })

    it('MQTT driver: renders TopicField for battery SoC', () => {
      render(
        <SolarBatterySettings
          battery={{ soc_topic: 'battery/soc_pct' }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Battery SoC Topic')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('battery/soc_pct')).toBeInTheDocument()
      expect(screen.queryByText('Battery SoC Entity')).toBeNull()
    })
  })

  describe('Grid section', () => {
    it('HA driver: renders EntityField for grid power', () => {
      // Battery must be expanded for grid to show — soc_entity triggers hasBattery=true
      render(
        <SolarBatterySettings
          battery={{ soc_entity: 'sensor.battery_soc' }}
          grid={{ power_entity: 'sensor.grid_power' }}
          driver="ha"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Grid Power Entity')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sensor.grid_power')).toBeInTheDocument()
      expect(screen.queryByText('Grid Power Topic')).toBeNull()
    })

    it('MQTT driver: renders TopicField for grid power', () => {
      render(
        <SolarBatterySettings
          battery={{ soc_topic: 'battery/soc_pct' }}
          grid={{ power_topic: 'grid/import_w' }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      expect(screen.getByText('Grid Power Topic')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('grid/import_w')).toBeInTheDocument()
      expect(screen.queryByText('Grid Power Entity')).toBeNull()
    })
  })
})


// ── INSTRUCTION-394 — Grid card decoupling + single-writer MQTT topics ──

describe('SolarBatterySettings — grid decoupling + single-writer (INSTRUCTION-394)', () => {
  const getCheckbox = (labelText: string): HTMLInputElement => {
    const label = screen.getByText(labelText).closest('label') as HTMLLabelElement
    return label.querySelector('input[type="checkbox"]') as HTMLInputElement
  }

  beforeEach(() => {
    vi.mocked(patchOrDelete).mockClear().mockResolvedValue({})
    mockUseSysid.mockReturnValue({ data: null, error: null })
  })

  it('HA: grid card visible + editable with battery unticked', () => {
    render(
      <SolarBatterySettings
        grid={{ power_entity: 'sensor.grid_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('I have a grid import/export meter')).toBeInTheDocument()
    expect(screen.getByText('Grid Power Entity')).toBeInTheDocument()
    // Battery card collapsed (no soc config).
    expect(screen.queryByText('Battery SoC Entity')).toBeNull()
  })

  it('MQTT: grid card visible + editable with battery unticked', () => {
    render(
      <SolarBatterySettings
        mqtt={{ broker: 'x', port: 1883, inputs: { grid_power: { topic: 'grid/power' } } }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(screen.getByText('Grid Power Topic')).toBeInTheDocument()
    expect(screen.queryByText('Battery SoC Topic')).toBeNull()
  })

  it('F-394-1: hasGrid initialises true from a voltage-only section (HA)', () => {
    render(
      <SolarBatterySettings grid={{ nominal_voltage: 230 }} driver="ha" onRefetch={noop} />
    )
    expect(getCheckbox('I have a grid import/export meter').checked).toBe(true)
    expect(screen.getByText('Grid Power Entity')).toBeInTheDocument()
  })

  it('F-394-1: hasGrid initialises true from { power_entity } (HA)', () => {
    render(
      <SolarBatterySettings
        grid={{ power_entity: 'sensor.grid_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    expect(getCheckbox('I have a grid import/export meter').checked).toBe(true)
  })

  it('D-1(ii): MQTT hasGrid initialises true from canonical grid_power with NO grid section', () => {
    render(
      <SolarBatterySettings
        mqtt={{ broker: 'x', port: 1883, inputs: { grid_power: { topic: 'grid/power' } } }}
        driver="mqtt"
        onRefetch={noop}
      />
    )
    expect(getCheckbox('I have a grid import/export meter').checked).toBe(true)
    expect(screen.getByText('Grid Power Topic')).toBeInTheDocument()
  })

  it('save: hasGrid true + hasBattery false PATCHes grid, deletes battery', async () => {
    render(
      <SolarBatterySettings
        grid={{ power_entity: 'sensor.grid_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => {
      expect(vi.mocked(patchOrDelete)).toHaveBeenCalled()
    })
    const calls = vi.mocked(patchOrDelete).mock.calls
    const gridCall = calls.find((c) => c[0] === 'grid')
    const batteryCall = calls.find((c) => c[0] === 'battery')
    expect(gridCall?.[1]).toBe(true)
    expect(batteryCall?.[1]).toBe(false)
  })

  it('F-394-1: save with an untouched voltage-only grid section preserves it', async () => {
    render(
      <SolarBatterySettings grid={{ nominal_voltage: 230 }} driver="ha" onRefetch={noop} />
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(vi.mocked(patchOrDelete)).toHaveBeenCalled())
    const gridCall = vi.mocked(patchOrDelete).mock.calls.find((c) => c[0] === 'grid')
    expect(gridCall?.[1]).toBe(true)
    expect((gridCall?.[2] as Record<string, unknown>).nominal_voltage).toBe(230)
  })

  describe('MQTT single-writer save', () => {
    let fetchMock: ReturnType<typeof vi.fn>
    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
      vi.stubGlobal('fetch', fetchMock)
    })

    const bodyOf = (): { inputs?: Record<string, unknown> } => {
      const mqttCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('config/mqtt'))
      expect(mqttCall).toBeTruthy()
      return JSON.parse((mqttCall![1] as RequestInit).body as string).data
    }

    it('D-1(i): editing MQTT grid topic PATCHes mqtt.inputs.grid_power, no grid.power_topic', async () => {
      render(
        <SolarBatterySettings
          mqtt={{ broker: 'x', port: 1883, inputs: { grid_power: { topic: 'old/grid' } } }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      const input = screen.getByPlaceholderText('grid/import_w') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'new/grid' } })
      fireEvent.click(screen.getByText('Save Changes'))
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const data = bodyOf()
      expect((data.inputs?.grid_power as { topic: string }).topic).toBe('new/grid')
      // No code path writes grid.power_topic — all grid section PATCHes are stripped.
      const gridSectionCalls = vi.mocked(patchOrDelete).mock.calls.filter((c) => c[0] === 'grid')
      for (const c of gridSectionCalls) {
        expect((c[2] as Record<string, unknown>)?.power_topic).toBeUndefined()
      }
    })

    it('editing a dict-form canonical entry preserves format/json_path', async () => {
      render(
        <SolarBatterySettings
          mqtt={{
            broker: 'x', port: 1883,
            inputs: { grid_power: { topic: 'old', format: 'json', json_path: '$.p' } },
          }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      const input = screen.getByPlaceholderText('grid/import_w') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'new' } })
      fireEvent.click(screen.getByText('Save Changes'))
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(bodyOf().inputs?.grid_power).toEqual({ topic: 'new', format: 'json', json_path: '$.p' })
    })

    it('D-1(ii): unticking hasGrid on MQTT deletes mqtt.inputs.grid_power', async () => {
      render(
        <SolarBatterySettings
          mqtt={{ broker: 'x', port: 1883, inputs: { grid_power: { topic: 'x' } } }}
          driver="mqtt"
          onRefetch={noop}
        />
      )
      fireEvent.click(getCheckbox('I have a grid import/export meter'))
      fireEvent.click(screen.getByText('Save Changes'))
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(bodyOf().inputs?.grid_power).toBeUndefined()
    })
  })
})


// ── INSTRUCTION-227C Task 6 — observed solar capacity row ────────────


describe('SolarBatterySettings observed solar capacity (INSTRUCTION-227C)', () => {
  beforeEach(() => {
    mockUseSysid.mockReset()
    mockUseSysid.mockReturnValue({ data: null, error: null })
  })

  it('shows "—" placeholder when value is null (sysid state 1 or 2)', () => {
    mockUseSysid.mockReturnValue({
      data: { rooms: {}, installation_solar_capacity_kw: null },
      error: null,
    })
    render(
      <SolarBatterySettings
        solar={{ production_entity: 'sensor.solar_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    const row = screen.getByTestId('solar-observed-capacity-row')
    expect(row.textContent).toContain('Solar production capacity (observed)')
    expect(row.textContent).toContain('—')
  })

  it('shows value with "(learning — N/50)" suffix when immature (state 3)', () => {
    mockUseSysid.mockReturnValue({
      data: {
        rooms: {},
        installation_solar_capacity_kw: {
          value: 3.2,
          observations: 12,
          mature: false,
          last_updated_ts: 1700000000.0,
        },
      },
      error: null,
    })
    render(
      <SolarBatterySettings
        solar={{ production_entity: 'sensor.solar_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    const row = screen.getByTestId('solar-observed-capacity-row')
    expect(row.textContent).toContain('3.2 kW')
    expect(row.textContent).toContain('learning')
    expect(row.textContent).toContain('12/50')
  })

  it('shows value without learning suffix when mature (state 4)', () => {
    mockUseSysid.mockReturnValue({
      data: {
        rooms: {},
        installation_solar_capacity_kw: {
          value: 4.5,
          observations: 50,
          mature: true,
          last_updated_ts: 1700000000.0,
        },
      },
      error: null,
    })
    render(
      <SolarBatterySettings
        solar={{ production_entity: 'sensor.solar_power' }}
        driver="ha"
        onRefetch={noop}
      />
    )
    const row = screen.getByTestId('solar-observed-capacity-row')
    expect(row.textContent).toContain('4.5 kW')
    expect(row.textContent).not.toContain('learning')
    expect(row.textContent).not.toContain('/50')
  })

  it('row is hidden when "I have solar panels" is unchecked', () => {
    // No solar config → checkbox unchecked → solar inner block hidden.
    render(<SolarBatterySettings driver="ha" onRefetch={noop} />)
    expect(screen.queryByTestId('solar-observed-capacity-row')).toBeNull()
  })
})
