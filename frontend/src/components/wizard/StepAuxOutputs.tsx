/**
 * INSTRUCTION-162B Task 2: Wizard step for per-room auxiliary outputs.
 *
 * Reuses the same AuxOutputEditor sub-form built in 162A. Threads the
 * useEntityResolve resolver across all configured aux entity IDs so the
 * editor's EntityField can render friendly names and live state alongside
 * the entity ID — V2 / H4 requires this is not omitted, since the wizard is
 * where new installs configure auxiliary outputs for the first time and
 * resolver-driven feedback matters most here.
 */
import { useMemo } from 'react'
import { AuxOutputEditor } from '../settings/AuxOutputEditor'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import type { AuxiliaryOutputYaml, Driver, QshConfigYaml, RoomConfigYaml } from '../../types/config'

interface StepAuxOutputsProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

export function StepAuxOutputs({ config, onUpdate }: StepAuxOutputsProps) {
  const rooms = useMemo(
    () => config.rooms ?? ({} as Record<string, RoomConfigYaml>),
    [config.rooms],
  )
  const driver: Driver = (config.driver as Driver) ?? 'ha'
  const roomNames = Object.keys(rooms)

  // Collect every configured ha_entity across rooms so the resolver issues a
  // single batched lookup. Filter out empty/undefined to avoid useless 404s.
  const allAuxEntityIds = useMemo(
    () =>
      Object.values(rooms)
        .map((r) => r.auxiliary_output?.ha_entity)
        .filter((s): s is string => Boolean(s)),
    [rooms],
  )
  const { resolved } = useEntityResolve(allAuxEntityIds, driver)

  if (roomNames.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text)] mb-2">Auxiliary outputs</h2>
          <p className="text-sm text-[var(--text-muted)]">
            No rooms defined yet. Use the previous step to add rooms before configuring auxiliary outputs.
          </p>
        </div>
      </div>
    )
  }

  const updateRoomAux = (
    roomName: string,
    next: AuxiliaryOutputYaml | null,
  ) => {
    const updated: RoomConfigYaml = { ...rooms[roomName], auxiliary_output: next }
    onUpdate('rooms', { ...rooms, [roomName]: updated })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Auxiliary outputs</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure per-room boolean outputs (panel heaters, electric mats,
          extract fans). Skip rooms that don&apos;t have one — defaults are correct
          for most installs.
        </p>
      </div>

      <div className="space-y-4">
        {roomNames.map((name) => {
          const room = rooms[name]
          return (
            <section
              key={name}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3"
            >
              <header>
                <h3 className="text-sm font-medium text-[var(--text)]">
                  {name.replace(/_/g, ' ')}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Control mode: {room.control_mode || 'indirect'}
                </p>
              </header>
              <AuxOutputEditor
                value={room.auxiliary_output}
                onChange={(next) => updateRoomAux(name, next)}
                driver={driver}
                controlMode={room.control_mode}
                resolved={resolved}
              />
            </section>
          )
        })}
      </div>
    </div>
  )
}
