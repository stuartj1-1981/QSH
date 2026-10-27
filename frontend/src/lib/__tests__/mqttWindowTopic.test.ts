// INSTRUCTION-604B T6 — the read and write helpers of the MQTT window contact.
import { describe, it, expect } from 'vitest'
import { windowInvert, windowJsonPath, windowTopic, writeWindowTopic } from '../mqttWindowTopic'

describe('mqttWindowTopic (INSTRUCTION-604B)', () => {
  it('(H1) reads the topic, the JSON key and the invert flag', () => {
    expect([windowTopic(undefined), windowJsonPath(undefined), windowInvert(undefined)]).toEqual(['', '', false])
    expect([windowTopic('a/b'), windowJsonPath('a/b'), windowInvert('a/b')]).toEqual(['a/b', '', false])
    const json = { topic: 'a', format: 'json' as const, json_path: 'contact', invert: true }
    expect([windowTopic(json), windowJsonPath(json), windowInvert(json)]).toEqual(['a', 'contact', true])
    const plain = { topic: 'a', format: 'plain' as const, json_path: 'x' }
    expect([windowTopic(plain), windowJsonPath(plain), windowInvert(plain)]).toEqual(['a', '', false])
  })

  it('(H2) writes a string, a mapping, or nothing', () => {
    expect(writeWindowTopic('a', { topic: '  ', jsonPath: 'contact', invert: true })).toBeUndefined()
    expect(writeWindowTopic(undefined, { topic: 'z/win', jsonPath: '', invert: false })).toBe('z/win')
    expect(writeWindowTopic('z/win', { topic: 'z/win', jsonPath: 'contact', invert: false })).toEqual({
      topic: 'z/win', format: 'json', json_path: 'contact',
    })
    expect(writeWindowTopic('z/win', { topic: 'z/win', jsonPath: '', invert: true })).toEqual({
      topic: 'z/win', invert: true,
    })
    const mapping = { topic: 'z/win', format: 'json' as const, json_path: 'contact', invert: true }
    expect(writeWindowTopic(mapping, { topic: 'z/win', jsonPath: '', invert: false })).toBe('z/win')
  })

  it('(H3) keeps the other keys of the earlier mapping', () => {
    const availability = { topic: 'z/win/availability', online_match: '$.state == "online"' }
    const prev = { topic: 'z/win', availability } as unknown as Parameters<typeof writeWindowTopic>[0]
    expect(writeWindowTopic(prev, { topic: 'z/other', jsonPath: '', invert: false })).toEqual({
      topic: 'z/other', availability,
    })
    expect(writeWindowTopic(prev, { topic: 'z/win', jsonPath: 'contact', invert: false })).toEqual({
      topic: 'z/win', availability, format: 'json', json_path: 'contact',
    })
    expect(writeWindowTopic(prev, { topic: 'z/win', jsonPath: '', invert: true })).toEqual({
      topic: 'z/win', availability, invert: true,
    })
  })
})
