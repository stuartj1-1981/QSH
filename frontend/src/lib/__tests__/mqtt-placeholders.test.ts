/**
 * Tests for `mqtt-placeholders` helper (INSTRUCTION-241B V3 Task 0).
 *
 * Table-driven coverage of all rules from INSTRUCTION-241 V2 §D-5:
 *  - sources.length <= 1 → legacy `heat_pump/<slot>` form
 *  - sources.length >= 2, unique types → `<type_stem>/<slot>`
 *  - sources.length >= 2, type collision (default mode) → name-disambiguated
 *  - sources.length >= 2, type collision (singleSource:true) → type-only
 */
import { describe, it, expect } from 'vitest'
import {
  mqttSensorPlaceholder,
  mqttControlPlaceholder,
  type HeatSourceYaml,
} from '../mqtt-placeholders'

describe('mqttSensorPlaceholder', () => {
  it('returns legacy heat_pump/<slot> when no sources', () => {
    expect(mqttSensorPlaceholder([], 0, 'flow_temp')).toBe('heat_pump/flow_temp')
  })

  it('returns legacy heat_pump/<slot> when single source', () => {
    const sources: HeatSourceYaml[] = [{ type: 'heat_pump', name: 'primary' }]
    expect(mqttSensorPlaceholder(sources, 0, 'flow_temp')).toBe('heat_pump/flow_temp')
  })

  it('uses type stem when 2+ sources, unique types', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'primary' },
      { type: 'gas_boiler', name: 'boiler' },
    ]
    expect(mqttSensorPlaceholder(sources, 0, 'flow_temp')).toBe('heat_pump/flow_temp')
    expect(mqttSensorPlaceholder(sources, 1, 'flow_temp')).toBe('gas_boiler/flow_temp')
  })

  it('disambiguates with name slug when types collide (default mode)', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'Primary HP' },
      { type: 'heat_pump', name: 'Secondary HP' },
    ]
    expect(mqttSensorPlaceholder(sources, 0, 'flow_temp')).toBe('primary_hp_hp/flow_temp')
    expect(mqttSensorPlaceholder(sources, 1, 'flow_temp')).toBe('secondary_hp_hp/flow_temp')
  })

  it('falls back to source_N when name missing in collision', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump' },
      { type: 'heat_pump' },
    ]
    expect(mqttSensorPlaceholder(sources, 0, 'flow_temp')).toBe('source_1_hp/flow_temp')
    expect(mqttSensorPlaceholder(sources, 1, 'flow_temp')).toBe('source_2_hp/flow_temp')
  })

  it('suppresses name disambiguation when singleSource:true', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'Primary HP' },
      { type: 'heat_pump', name: 'Secondary HP' },
    ]
    expect(
      mqttSensorPlaceholder(sources, 0, 'flow_temp', { singleSource: true }),
    ).toBe('heat_pump/flow_temp')
    expect(
      mqttSensorPlaceholder(sources, 1, 'flow_temp', { singleSource: true }),
    ).toBe('heat_pump/flow_temp')
  })

  it('singleSource:true with unique types still uses type stem', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'primary' },
      { type: 'gas_boiler', name: 'boiler' },
    ]
    expect(
      mqttSensorPlaceholder(sources, 0, 'flow_temp', { singleSource: true }),
    ).toBe('heat_pump/flow_temp')
    expect(
      mqttSensorPlaceholder(sources, 1, 'flow_temp', { singleSource: true }),
    ).toBe('gas_boiler/flow_temp')
  })

  it('boiler type strips _boiler suffix in collision abbreviation', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'gas_boiler', name: 'Boiler A' },
      { type: 'gas_boiler', name: 'Boiler B' },
    ]
    expect(mqttSensorPlaceholder(sources, 0, 'flow_temp')).toBe('boiler_a_gas/flow_temp')
    expect(mqttSensorPlaceholder(sources, 1, 'flow_temp')).toBe('boiler_b_gas/flow_temp')
  })

  it('singleSource:true with empty sources returns legacy', () => {
    expect(mqttSensorPlaceholder([], 0, 'cop', { singleSource: true })).toBe(
      'heat_pump/cop',
    )
  })

  it('long name slug truncated to 24 chars', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'a'.repeat(40) },
      { type: 'heat_pump', name: 'b'.repeat(40) },
    ]
    // 24 char "a" + "_hp/flow_temp"
    expect(mqttSensorPlaceholder(sources, 0, 'flow_temp')).toBe(
      `${'a'.repeat(24)}_hp/flow_temp`,
    )
  })
})

describe('mqttControlPlaceholder', () => {
  it('returns legacy when no/one source', () => {
    expect(mqttControlPlaceholder([], 0, 'flow_temp/set')).toBe(
      'heat_pump/flow_temp/set',
    )
    const single: HeatSourceYaml[] = [{ type: 'heat_pump' }]
    expect(mqttControlPlaceholder(single, 0, 'mode/set')).toBe('heat_pump/mode/set')
  })

  it('uses type stem for unique types', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump' },
      { type: 'gas_boiler' },
    ]
    expect(mqttControlPlaceholder(sources, 0, 'flow_temp/set')).toBe(
      'heat_pump/flow_temp/set',
    )
    expect(mqttControlPlaceholder(sources, 1, 'mode/set')).toBe('gas_boiler/mode/set')
  })

  it('disambiguates with name slug on collision', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'Primary' },
      { type: 'heat_pump', name: 'Backup' },
    ]
    expect(mqttControlPlaceholder(sources, 1, 'mode/set')).toBe(
      'backup_hp/mode/set',
    )
  })

  it('singleSource:true suppresses disambiguation', () => {
    const sources: HeatSourceYaml[] = [
      { type: 'heat_pump', name: 'Primary' },
      { type: 'heat_pump', name: 'Backup' },
    ]
    expect(
      mqttControlPlaceholder(sources, 1, 'mode/set', { singleSource: true }),
    ).toBe('heat_pump/mode/set')
  })
})
