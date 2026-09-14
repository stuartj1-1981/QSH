import { describe, it, expect } from 'vitest'
import { roomLabel, roomLabelTitleCase } from '../roomLabel'

describe('roomLabel', () => {
  it('replaces underscores when no room object is passed', () => {
    expect(roomLabel('living_room')).toBe('living room')
  })

  it('replaces underscores when display_name is absent', () => {
    expect(roomLabel('living_room', {})).toBe('living room')
  })

  it('replaces underscores when display_name is null', () => {
    expect(roomLabel('living_room', { display_name: null })).toBe('living room')
  })

  it('replaces underscores when display_name is empty', () => {
    expect(roomLabel('living_room', { display_name: '' })).toBe('living room')
  })

  it('replaces underscores when display_name is whitespace-only', () => {
    expect(roomLabel('living_room', { display_name: '   ' })).toBe('living room')
  })

  it('returns the trimmed display_name verbatim when set', () => {
    expect(roomLabel('living_room', { display_name: '  Snug  ' })).toBe('Snug')
  })

  it('does not re-case a mixed-case display_name', () => {
    expect(roomLabel('living_room', { display_name: 'en-suite WC' })).toBe('en-suite WC')
  })

  it('handles a key with multiple underscores when no label is set', () => {
    expect(roomLabel('upstairs_en_suite_wc')).toBe('upstairs en suite wc')
  })
})

describe('roomLabelTitleCase', () => {
  it('title-cases the key when no room object is passed', () => {
    expect(roomLabelTitleCase('living_room')).toBe('Living Room')
  })

  it('title-cases the key when display_name is absent', () => {
    expect(roomLabelTitleCase('living_room', {})).toBe('Living Room')
  })

  it('title-cases the key when display_name is null', () => {
    expect(roomLabelTitleCase('living_room', { display_name: null })).toBe('Living Room')
  })

  it('title-cases the key when display_name is empty', () => {
    expect(roomLabelTitleCase('living_room', { display_name: '' })).toBe('Living Room')
  })

  it('title-cases the key when display_name is whitespace-only', () => {
    expect(roomLabelTitleCase('living_room', { display_name: '   ' })).toBe('Living Room')
  })

  it('returns the trimmed display_name verbatim when set', () => {
    expect(roomLabelTitleCase('living_room', { display_name: '  Snug  ' })).toBe('Snug')
  })

  it('does NOT re-case a mixed-case display_name', () => {
    expect(roomLabelTitleCase('living_room', { display_name: 'en-suite WC' })).toBe('en-suite WC')
  })

  it('handles a key with multiple underscores when no label is set', () => {
    expect(roomLabelTitleCase('upstairs_en_suite_wc')).toBe('Upstairs En Suite Wc')
  })
})
