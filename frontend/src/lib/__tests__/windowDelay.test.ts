// INSTRUCTION-572D T4 — the delay parser, the range and the help text. Cases
// Y1 to Y3, numbered as in T4 of the instruction.
import { describe, it, expect } from 'vitest'
import { WINDOW_OPEN_DELAY_MAX_S, WINDOW_OPEN_DELAY_MIN_S, parseWindowOpenDelay } from '../windowDelay'
import { WINDOW_DELAY } from '../helpText'

describe('windowDelay (INSTRUCTION-572D)', () => {
  it.each([
    ['', undefined],
    ['   ', undefined],
    ['abc', undefined],
    ['Infinity', undefined],
    ['0', 0],
    ['60', 60],
    [' 60 ', 60],
    ['600', 600],
    ['601', 600],
    ['900', 600],
    ['-5', 0],
    ['90.4', 90],
    ['90.5', 91],
    ['1e3', 600],
  ])('(Y1) parseWindowOpenDelay(%j) gives %j', (text, expected) => {
    expect(parseWindowOpenDelay(text)).toBe(expected)
  })

  it('(Y2) the range is 0 to 600 seconds', () => {
    expect(WINDOW_OPEN_DELAY_MIN_S).toBe(0)
    expect(WINDOW_OPEN_DELAY_MAX_S).toBe(600)
  })

  it('(Y3) the help text equals its text in T1, character for character', () => {
    // The literal is copied byte for byte from T1 of the instruction; not imported.
    expect(WINDOW_DELAY.help).toBe(
      'The time that the contact must stay open before QSH treats the window as open. The range is 0 to 600 seconds. An empty field gives 60 seconds.',
    )
  })
})
