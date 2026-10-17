// INSTRUCTION-581 T7 — the list helpers of the output topic fields. Cases Y1 to
// Y10, numbered as in T7 of the instruction.
import { describe, it, expect } from 'vitest'
import {
  addTopicSlot,
  dropEmptyTopics,
  removeTopicAt,
  setTopicAt,
  shapeTopics,
  topicsOf,
} from '../topicList'

describe('topicList (INSTRUCTION-581)', () => {
  it('Y1: topicsOf returns a new array for string, list and undefined', () => {
    expect(topicsOf(undefined)).toEqual([])
    expect(topicsOf('a')).toEqual(['a'])
    const src = ['a', 'b']
    const out = topicsOf(src)
    expect(out).toEqual(['a', 'b'])
    expect(out).not.toBe(src)
  })

  it('Y2: shapeTopics collapses none, one and many', () => {
    expect(shapeTopics([])).toBeUndefined()
    expect(shapeTopics([''])).toBeUndefined()
    expect(shapeTopics(['a'])).toBe('a')
    expect(shapeTopics(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('Y3: setTopicAt keeps a list a list and keeps blank entries', () => {
    expect(setTopicAt(['a', 'b'], 0, '')).toEqual(['', 'b'])
    expect(setTopicAt(['a', ''], 1, 'b')).toEqual(['a', 'b'])
    expect(setTopicAt(['a', 'b'], 1, '')).toEqual(['a', ''])
  })

  it('Y4: setTopicAt on a string or undefined', () => {
    expect(setTopicAt(undefined, 0, 'x')).toBe('x')
    expect(setTopicAt('a', 0, 'x')).toBe('x')
    expect(setTopicAt('a', 0, '')).toBeUndefined()
    expect(setTopicAt('a', 1, 'b')).toEqual(['a', 'b'])
  })

  it('Y5: setTopicAt pads a gap with blank entries', () => {
    expect(setTopicAt('a', 2, 'c')).toEqual(['a', '', 'c'])
  })

  it('Y6: addTopicSlot', () => {
    expect(addTopicSlot(undefined)).toEqual(['', ''])
    expect(addTopicSlot('a')).toEqual(['a', ''])
    expect(addTopicSlot(['a', 'b'])).toEqual(['a', 'b', ''])
  })

  it('Y7: removeTopicAt collapses to a string at one entry', () => {
    expect(removeTopicAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
    expect(removeTopicAt(['a', 'b'], 1)).toBe('a')
    expect(removeTopicAt(['a', ''], 1)).toBe('a')
  })

  it('Y8: dropEmptyTopics removes blank entries and collapses', () => {
    expect(dropEmptyTopics(['a', ''])).toBe('a')
    expect(dropEmptyTopics(['', ''])).toBeUndefined()
    expect(dropEmptyTopics(['a', ' ', 'b'])).toEqual(['a', 'b'])
    expect(dropEmptyTopics('a')).toBe('a')
    expect(dropEmptyTopics('')).toBeUndefined()
    expect(dropEmptyTopics(undefined)).toBeUndefined()
  })

  it('Y9: dropEmptyTopics drops an entry that is not a string and does not throw', () => {
    expect(dropEmptyTopics([5, 'a'] as unknown as string[])).toBe('a')
    expect(dropEmptyTopics(5 as unknown as string)).toBeUndefined()
  })

  it('Y10: no function changes its input', () => {
    const src = ['a', 'b']
    setTopicAt(src, 0, 'x')
    addTopicSlot(src)
    removeTopicAt(src, 1)
    dropEmptyTopics(src)
    expect(src).toEqual(['a', 'b'])
  })
})
