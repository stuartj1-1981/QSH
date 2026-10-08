// INSTRUCTION-572B T6 — the mode readers, the writer and the texts. Cases L1
// to L8, numbered as in T6 of the instruction.
import { describe, it, expect } from 'vitest'
import {
  WINDOW_INFERENCE_MODES,
  readInferenceMode,
  selectedInferenceMode,
  writeInferenceMode,
} from '../windowSettings'
import { WINDOW_INFERENCE, WINDOW_INFERENCE_LABEL } from '../helpText'

// The values and the sections that the rule of 572A refuses
// (test_window_detection_write_572a.py, _BAD_VALUES and _BAD_SECTIONS).
const BAD_VALUES: [string, unknown][] = [
  ['false, a bare YAML off', false],
  ['true, a bare YAML on', true],
  ['null', null],
  ['the text off', 'off'],
  ['the text on', 'on'],
  ['a name in capitals', 'ACT'],
  ['a name with a space before it', ' act'],
  ['a name with a space after it', 'act '],
  ['a name with a line end', 'act\n'],
  ['a name with a tab after it', 'act\t'],
  ['a name with a carriage return after it', 'act\r'],
  ['a name with a no-break space after it', 'act\u00a0'],
  ['a number', 1],
  ['a list', ['act']],
  ['a map', {}],
]
const BAD_SECTIONS: [string, unknown][] = [
  ['a string', 'observe'],
  ['a list', ['observe']],
  ['a number', 3],
  ['true', true],
  ['false, a bare YAML off', false],
]

describe('windowSettings (INSTRUCTION-572B)', () => {
  it('(L1) the three names are in the order disabled, observe, act', () => {
    expect([...WINDOW_INFERENCE_MODES]).toEqual(['disabled', 'observe', 'act'])
  })

  it.each(['disabled', 'observe', 'act'] as const)('(L2) a section that holds %s gives it, selected and running', (mode) => {
    expect(selectedInferenceMode({ inference: mode })).toBe(mode)
    expect(readInferenceMode({ inference: mode })).toBe(mode)
  })

  it.each([
    ['no section', undefined],
    ['a null section', null],
    ['an empty map', {}],
    ['a map with another key', { note: 'x' }],
  ])('(L3) %s gives disabled, selected and running', (_label, section) => {
    expect(selectedInferenceMode(section)).toBe('disabled')
    expect(readInferenceMode(section)).toBe('disabled')
  })

  it.each(BAD_VALUES)('(L4) a mode that is %s gives no selection, and runs disabled', (_label, value) => {
    expect(selectedInferenceMode({ inference: value })).toBeNull()
    expect(readInferenceMode({ inference: value })).toBe('disabled')
  })

  it.each(BAD_SECTIONS)('(L5) a section that is %s gives no selection, and runs disabled', (_label, section) => {
    expect(selectedInferenceMode(section)).toBeNull()
    expect(readInferenceMode(section)).toBe('disabled')
  })

  it('(L6) writeInferenceMode keeps the stored keys and sets the mode', () => {
    const stored = { inference: 'observe', note: 'x' }
    expect(writeInferenceMode(stored, 'act')).toEqual({ inference: 'act', note: 'x' })
    // The stored object is not changed.
    expect(stored).toEqual({ inference: 'observe', note: 'x' })
  })

  it.each([
    ['no section', undefined],
    ['null', null],
    ['a string', 'observe'],
    ['a list', ['observe']],
  ])('(L7) writeInferenceMode gives the mode only for %s', (_label, section) => {
    expect(writeInferenceMode(section, 'observe')).toEqual({ inference: 'observe' })
  })

  it('(L8) each text equals its text in T1, character for character', () => {
    // Literals copied byte for byte from T1 of the instruction; not imported.
    expect(WINDOW_INFERENCE.title).toBe('Open-Window Detection Without a Sensor')
    expect(WINDOW_INFERENCE.intro).toBe(
      'QSH can infer an open window in a room that has no window sensor. It measures only in long periods with the heat source off, and it compares the heat loss of the room with the normal value for that room. QSH first learns the normal value of each room, which needs many hours of such periods. The function needs a power measurement of the heat source and an outdoor temperature.',
    )
    expect(WINDOW_INFERENCE.disabled).toBe('QSH does not infer an open window.')
    expect(WINDOW_INFERENCE.observe).toBe(
      'QSH measures only. It writes the heat-loss ratio and the inferred window state to the historian, and the inferred state to the log. It does not change the heating, and it sends no notification.',
    )
    expect(WINDOW_INFERENCE.act).toBe(
      'QSH also acts on a room that it infers open. It sends one notification and takes no learning sample from that room. The room can fall up to 1.5°C below its target before it starts the heat source. A boost has priority. A room with a window sensor that reads closed is not changed. If the detection is incorrect, the room calls for heat up to 1.5°C lower than its target for as long as the state lasts.',
    )
    expect(WINDOW_INFERENCE.invalid).toBe(
      'The stored value is not a mode, and QSH reads it as Off. To correct it, select a mode and store the configuration.',
    )
    expect(WINDOW_INFERENCE_LABEL).toEqual({ disabled: 'Off', observe: 'Observe', act: 'Act' })
  })
})
