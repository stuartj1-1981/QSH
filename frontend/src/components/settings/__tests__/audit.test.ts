import { describe, it, expect } from 'vitest'

const modules = import.meta.glob('../*.tsx', { query: '?raw', eager: true, import: 'default' }) as Record<string, string>

const DRIVER_AGNOSTIC_FILES = [
  'ThermalSettings.tsx',
  'HistorianSettings.tsx',
  'DataSharingSettings.tsx',
  'SourceSelectionSettings.tsx',
  'SystemSettings.tsx',
  'BackupRestore.tsx',
  'SeasonalTuningSettings.tsx',
]

describe('Driver-agnostic settings audit (INSTRUCTION-88D)', () => {
  for (const file of DRIVER_AGNOSTIC_FILES) {
    describe(file, () => {
      const key = `../${file}`
      const content = modules[key]

      it('file is loadable', () => {
        expect(content).toBeDefined()
      })

      it('has audit comment in first 5 lines', () => {
        const lines = (content as string).split('\n').slice(0, 5).join('\n')
        expect(lines).toContain('// Driver-agnostic: ')
      })

      it('does not contain <EntityField', () => {
        expect(content).not.toContain('<EntityField')
      })

      it('does not contain <TopicField', () => {
        expect(content).not.toContain('<TopicField')
      })

      it('does not import useEntityResolve', () => {
        expect(content).not.toContain('useEntityResolve')
      })

      it('does not import useMqttTopicScan', () => {
        expect(content).not.toContain('useMqttTopicScan')
      })
    })
  }
})
