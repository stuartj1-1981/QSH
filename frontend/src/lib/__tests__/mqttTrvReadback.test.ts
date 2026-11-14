// INSTRUCTION-627B T7(a) — the read and write helpers of the TRV setpoint readback.
import { describe, it, expect } from 'vitest'
import { readbackJsonPath, readbackTopic, readbackTopics, writeReadback } from '../mqttTrvReadback'

describe('mqttTrvReadback (INSTRUCTION-627B)', () => {
  it('reads the topic and the JSON key of each form', () => {
    expect([readbackTopic(undefined), readbackJsonPath(undefined)]).toEqual(['', ''])
    expect([readbackTopic('a/b'), readbackJsonPath('a/b')]).toEqual(['a/b', ''])
    const json = { topic: 'z/trv', format: 'json' as const, json_path: 'occupied_heating_setpoint' }
    expect([readbackTopic(json), readbackJsonPath(json)]).toEqual(['z/trv', 'occupied_heating_setpoint'])
    const plain = { topic: 'a', format: 'plain' as const, json_path: 'x' }
    expect([readbackTopic(plain), readbackJsonPath(plain)]).toEqual(['a', ''])
    const list = [json, 'z/second']
    expect([readbackTopic(list), readbackJsonPath(list)]).toEqual(['z/trv', 'occupied_heating_setpoint'])
  })

  it('lists every topic that is not blank', () => {
    expect(readbackTopics(undefined)).toEqual([])
    expect(readbackTopics('  ')).toEqual([])
    expect(readbackTopics('a/b')).toEqual(['a/b'])
    expect(readbackTopics(['a/b', '', { topic: ' c/d ' }, { topic: '' }, '  '])).toEqual(['a/b', 'c/d'])
  })

  it('writes a string, a mapping, or nothing', () => {
    expect(writeReadback('a', { topic: '  ', jsonPath: 'x' })).toBeUndefined()
    expect(writeReadback(undefined, { topic: ' z/trv ', jsonPath: '' })).toBe('z/trv')
    expect(writeReadback('z/trv', { topic: 'z/trv', jsonPath: 'occupied_heating_setpoint' })).toEqual({
      topic: 'z/trv', format: 'json', json_path: 'occupied_heating_setpoint',
    })
    const mapping = { topic: 'z/trv', format: 'json' as const, json_path: 'occupied_heating_setpoint' }
    expect(writeReadback(mapping, { topic: 'z/trv', jsonPath: '' })).toBe('z/trv')
  })

  it('keeps the other keys of the earlier mapping', () => {
    const prev = { topic: 'z/trv', format: 'json' as const, json_path: 'k', category: 'setpoint' }
    expect(writeReadback(prev, { topic: 'z/trv', jsonPath: 'k2' })).toEqual({
      topic: 'z/trv', format: 'json', json_path: 'k2', category: 'setpoint',
    })
    expect(writeReadback(prev, { topic: 'z/trv', jsonPath: '' })).toEqual({
      topic: 'z/trv', category: 'setpoint',
    })
  })
})
