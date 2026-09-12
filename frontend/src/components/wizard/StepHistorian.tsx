import { useState } from 'react'
import { HistorianChoice } from '../settings/HistorianChoice'
import { useHistorianSetup } from '../../hooks/useHistorianSetup'
import {
  applyHistorianAction,
  deriveHistorianMode,
  type HistorianAction,
} from '../../lib/historianMode'
import type { QshConfigYaml, HistorianYaml } from '../../types/config'

interface StepHistorianProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

export function StepHistorian({ config, onUpdate }: StepHistorianProps) {
  const { data: setup, error, refresh } = useHistorianSetup()

  // The section as this wizard run found it. Every action is applied to
  // THIS value, and the mode is derived from it — never from a section an
  // earlier action in the same run already wrote.
  //
  // Review finding L5, carried by DISPATCH-NOTE-524C-2026-09-11.md: deriving
  // from the written section makes tick-then-untick destructive. On a re-run
  // with `{ enabled: false, host: 'x' }` and a `none` record, the tick writes
  // BUILTIN; the untick would then derive `builtin` from what it just wrote
  // and deploy `backend: qsdb, store.shadow: false` with `enabled: false` —
  // a section the user never had. Holding the hydrated value makes the
  // untick restore it exactly.
  const [hydrated] = useState<HistorianYaml | undefined>(config.historian)

  const hydratedOn = hydrated?.enabled === true
  const [checked, setChecked] = useState(hydratedOn)

  const mode = deriveHistorianMode(hydrated, setup)

  const onAction = (action: HistorianAction) => {
    const nextChecked =
      action === 'disable' ? false : action === 'enable' ? true : checked
    setChecked(nextChecked)

    // Back where we started: put the hydrated section back exactly, so a
    // tick followed by an untick leaves the deploy unchanged.
    if ((action === 'enable' || action === 'disable') && nextChecked === hydratedOn) {
      onUpdate('historian', hydrated)
      return
    }

    const result = applyHistorianAction(hydrated, mode, action)
    if (result !== null) onUpdate('historian', result)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-bold text-[var(--text)]">Historian</h2>
        <p className="text-sm text-[var(--text-dim)]">
          QSH can keep a history of your heating in its own store on this
          system. Charts, statistics and savings reports use it. It is off
          unless you turn it on. You can change this later in Settings &rarr;
          Historian.
        </p>
      </div>

      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <HistorianChoice
          section={hydrated}
          setup={setup}
          error={error}
          checked={checked}
          onAction={onAction}
          onRetry={refresh}
        />
      </div>
    </div>
  )
}
