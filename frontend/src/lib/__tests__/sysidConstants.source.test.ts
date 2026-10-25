// INSTRUCTION-418 D3, INSTRUCTION-570N — the 214 mirror protocol is mechanical.
//
// Every mirrored constant in sysidConstants.ts carries a structured
// `@source <path>::<NAME>` tag. This test parses each
// (constant, citedPath, citedName) triple, finds the module-level line of
// the cited file that defines citedName, and asserts that there is exactly
// one such line and that it gives the constant's mirrored value. The tag
// names the constant and not a line, so a change that only moves lines in
// the cited file does not fail the suite; a changed value, a renamed
// constant or a second definition does.

/// <reference types="node" />
// The node types reference is scoped to this test: the suite runs under
// vitest (node runtime) and reads repo files — app code never does.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
// frontend/src/lib/__tests__ → up 4 = quantum_swarm_heating/ (the add-on
// root, which contains both qsh/ and frontend/).
const addonRoot = resolve(testDir, '../../../..')
const constantsSource = readFileSync(
  join(addonRoot, 'frontend/src/lib/sysidConstants.ts'),
  'utf-8',
)

interface Citation {
  name: string
  value: string
  citedPath: string
  citedName: string
}

function parseCitations(src: string): Citation[] {
  // Matches: `@source <path>::<NAME> */` followed by
  // `export const <NAME> = <VALUE>` on the next line.
  const re =
    /@source\s+([\w./-]+)::(\w+)\s*\*\/\s*\nexport const (\w+) = ([\d.]+)/g
  const out: Citation[] = []
  for (const m of src.matchAll(re)) {
    out.push({
      citedPath: m[1],
      citedName: m[2],
      name: m[3],
      value: m[4],
    })
  }
  return out
}

// The lines of a Python source that define `name` at module level: the line
// starts with the name, then optional spaces, then `=`. An indented line, a
// longer name that starts with `name`, and a comparison are not definitions.
function definitionLines(pySource: string, name: string): string[] {
  const re = new RegExp(`^${name}\\s*=(?!=)`)
  return pySource.split('\n').filter((line) => re.test(line))
}

// The number that a definition line gives: the right-hand side is one plain
// number, and only a comment may follow it. Any other right-hand side (an
// expression, an underscore in a number, an exponent) gives null, so the
// test fails on it and does not read only the start of it.
function definedValue(line: string, name: string): number | null {
  const m = new RegExp(`^${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*(?:#.*)?$`).exec(line)
  return m ? Number(m[1]) : null
}

describe('sysidConstants @source citations (INSTRUCTION-418)', () => {
  const citations = parseCitations(constantsSource)

  it('every exported constant carries a machine-checkable @source tag', () => {
    const exported = [...constantsSource.matchAll(/export const (\w+) =/g)].map(
      (m) => m[1],
    )
    expect(exported.length).toBeGreaterThan(0)
    expect(citations.map((c) => c.name).sort()).toEqual(exported.sort())
  })

  it.each(parseCitations(constantsSource))(
    '$name cites $citedPath::$citedName, which defines it once with the mirrored value',
    ({ name, value, citedPath, citedName }) => {
      const source = readFileSync(join(addonRoot, citedPath), 'utf-8')
      expect(citedName).toBe(name)
      const lines = definitionLines(source, citedName)
      expect(lines, `module-level definitions of ${citedName} in ${citedPath}`).toHaveLength(1)
      expect(definedValue(lines[0], citedName), lines[0]).toBe(Number(value))
    },
  )
})

describe('the definition finder (INSTRUCTION-570N)', () => {
  it('finds a definition wherever it is in the file', () => {
    const before = 'import os\nFOO = 10  # note\n'
    const after = 'import os\nimport sys\n\nFOO = 10  # note\n'
    expect(definitionLines(before, 'FOO')).toEqual(['FOO = 10  # note'])
    expect(definitionLines(after, 'FOO')).toEqual(['FOO = 10  # note'])
  })

  it('does not take an indented line, a longer name or a comparison', () => {
    const src = 'def f():\n    FOO = 3\nFOO_BAR = 4\nFOO == 5\n'
    expect(definitionLines(src, 'FOO')).toEqual([])
  })

  it('returns each module-level definition, so a second one is seen', () => {
    const src = 'FOO = 10\nx = 1\nFOO = 12\n'
    expect(definitionLines(src, 'FOO')).toHaveLength(2)
  })

  it('reads one plain number, so 10 is not 100, 5.0 is 5 and an expression gives none', () => {
    expect(definedValue('FOO = 100', 'FOO')).not.toBe(Number('10'))
    expect(definedValue('FOO = 5.0', 'FOO')).toBe(Number('5.0'))
    expect(definedValue('FOO = 10  # note', 'FOO')).toBe(10)
    expect(definedValue('FOO = bar(1)', 'FOO')).toBeNull()
    expect(definedValue('FOO = 10_000', 'FOO')).toBeNull()
    expect(definedValue('FOO = 100e1', 'FOO')).toBeNull()
    expect(definedValue('FOO = 0.8 + 0.1', 'FOO')).toBeNull()
    expect(definedValue('FOO = 7200 // 2', 'FOO')).toBeNull()
  })
})

describe('no count-implies-full confidence claim survives (INSTRUCTION-418 QG3)', () => {
  it('frontend/src contains no "reaches 1.0" or "reaches full" copy', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === '__tests__' || entry === 'node_modules') continue
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) {
          walk(p)
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const text = readFileSync(p, 'utf-8')
          if (text.includes('reaches 1.0') || text.includes('reaches full')) {
            offenders.push(p)
          }
        }
      }
    }
    walk(join(addonRoot, 'frontend/src'))
    expect(offenders).toEqual([])
  })
})
