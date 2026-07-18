// INSTRUCTION-418 D3 — the 214 mirror protocol becomes mechanical.
//
// Every mirrored constant in sysidConstants.ts carries a structured
// `@source <path>:<line>` tag. This test parses each
// (constant, citedPath, citedLine) triple, reads the cited source line from
// the repo, and asserts the line contains the constant's name AND its
// mirrored value. Citation drift now fails the suite instead of waiting for
// the next field diagnosis (the protocol failed silently twice before this:
// line drift after refactors, and formula drift after INSTRUCTION-323).

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
  citedLine: number
}

function parseCitations(src: string): Citation[] {
  // Matches: `@source <path>:<line> */` followed by
  // `export const <NAME> = <VALUE>` (possibly with intervening comment
  // close on the same or next line).
  const re =
    /@source\s+([\w./-]+):(\d+)\s*\*\/\s*\nexport const (\w+) = ([\d.]+)/g
  const out: Citation[] = []
  for (const m of src.matchAll(re)) {
    out.push({
      citedPath: m[1],
      citedLine: parseInt(m[2], 10),
      name: m[3],
      value: m[4],
    })
  }
  return out
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
    '$name cites $citedPath:$citedLine and the cited line defines it',
    ({ name, value, citedPath, citedLine }) => {
      const sourceLines = readFileSync(join(addonRoot, citedPath), 'utf-8').split(
        '\n',
      )
      expect(citedLine).toBeLessThanOrEqual(sourceLines.length)
      const line = sourceLines[citedLine - 1]
      expect(line, `cited line ${citedPath}:${citedLine}`).toContain(name)
      expect(line, `cited line ${citedPath}:${citedLine}`).toContain(value)
    },
  )
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
