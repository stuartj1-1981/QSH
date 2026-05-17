import { describe, it, expect } from 'vitest'
import { extractTopic, extractFormat, extractJsonPath, asTopicInput } from '../mqttTopic'
import type { MqttTopicInput } from '../../types/config'

describe('mqttTopic — extractTopic', () => {
  it('returns empty string for undefined', () => {
    expect(extractTopic(undefined)).toBe('')
  })

  it('returns empty string for null', () => {
    expect(extractTopic(null)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(extractTopic('')).toBe('')
  })

  it('returns the string itself for a non-empty string', () => {
    expect(extractTopic('sensor.gas_unit_rate')).toBe('sensor.gas_unit_rate')
  })

  it('returns the topic from a full object', () => {
    const v: MqttTopicInput = { topic: 'qsh/cost', format: 'json', json_path: 'value.rate' }
    expect(extractTopic(v)).toBe('qsh/cost')
  })

  it('returns empty string when the object lacks a topic field', () => {
    // The schema requires topic; this case covers stale/malformed in-memory state.
    expect(extractTopic({ topic: '' } as MqttTopicInput)).toBe('')
  })
})

describe('mqttTopic — extractFormat', () => {
  it('returns undefined for undefined / null / empty string', () => {
    expect(extractFormat(undefined)).toBeUndefined()
    expect(extractFormat(null)).toBeUndefined()
    expect(extractFormat('')).toBeUndefined()
  })

  it('returns undefined for any plain string', () => {
    expect(extractFormat('sensor.foo')).toBeUndefined()
  })

  it('returns json for an object with format json', () => {
    expect(extractFormat({ topic: 'qsh/c', format: 'json' })).toBe('json')
  })

  it('returns plain for an object with format plain', () => {
    expect(extractFormat({ topic: 'qsh/c', format: 'plain' })).toBe('plain')
  })

  it('returns undefined for an object without a format field', () => {
    expect(extractFormat({ topic: 'qsh/c' } as MqttTopicInput)).toBeUndefined()
  })
})

describe('mqttTopic — extractJsonPath', () => {
  it('returns undefined for undefined / null / empty string', () => {
    expect(extractJsonPath(undefined)).toBeUndefined()
    expect(extractJsonPath(null)).toBeUndefined()
    expect(extractJsonPath('')).toBeUndefined()
  })

  it('returns undefined for any plain string', () => {
    expect(extractJsonPath('sensor.foo')).toBeUndefined()
  })

  it('returns the json_path from a full object', () => {
    expect(
      extractJsonPath({ topic: 'qsh/c', format: 'json', json_path: 'value.rate' }),
    ).toBe('value.rate')
  })

  it('returns undefined when the object has no json_path field', () => {
    expect(extractJsonPath({ topic: 'qsh/c', format: 'json' })).toBeUndefined()
  })
})

describe('mqttTopic — asTopicInput', () => {
  it('returns undefined for undefined / null / empty string', () => {
    expect(asTopicInput(undefined)).toBeUndefined()
    expect(asTopicInput(null)).toBeUndefined()
    expect(asTopicInput('')).toBeUndefined()
  })

  it('wraps a non-empty string as { topic, format: plain }', () => {
    expect(asTopicInput('qsh/legacy/topic')).toEqual({
      topic: 'qsh/legacy/topic',
      format: 'plain',
    })
  })

  it('passes through a full object unchanged', () => {
    const v: MqttTopicInput = { topic: 'qsh/c', format: 'json', json_path: 'value.rate' }
    expect(asTopicInput(v)).toBe(v)
  })

  it('passes through an object lacking optional fields', () => {
    const v: MqttTopicInput = { topic: 'qsh/c' } as MqttTopicInput
    expect(asTopicInput(v)).toBe(v)
  })
})
