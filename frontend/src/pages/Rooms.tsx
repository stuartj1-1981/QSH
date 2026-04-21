import { useState, useMemo } from 'react'
import { useLive } from '../hooks/useLive'
import { useRooms } from '../hooks/useRooms'
import { useSysid } from '../hooks/useSysid'
import { useRoomHistory } from '../hooks/useHistory'
import { useRawConfig } from '../hooks/useConfig'
import { buildEntityMap } from '../hooks/entityMap'
import { RoomCard } from '../components/RoomCard'
import { RoomDetail } from '../components/RoomDetail'
import { MultiRoomTempChart } from '../components/MultiRoomTempChart'

interface RoomsProps {
  engineering: boolean
}

export function Rooms({ engineering }: RoomsProps) {
  const { data: live } = useLive()
  const { data: initial } = useRooms()
  const { data: sysidData } = useSysid()
  const { data: roomHistory } = useRoomHistory(['temp'], 24)
  const { data: configData } = useRawConfig()
  const entityMap = useMemo(() => buildEntityMap(configData), [configData])
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)

  const rooms = live?.rooms ?? initial?.rooms ?? {}
  const boostRooms = live?.boost?.rooms ?? {}
  const comfortTempActive =
    live?.status?.comfort_temp_active ?? live?.status?.comfort_temp ?? null

  return (
    <div className="max-w-5xl">
      <h2 className="text-xl font-bold mb-4">Rooms</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Object.entries(rooms).map(([name, room]) => (
          <RoomCard
            key={name}
            name={name}
            room={room}
            boost={boostRooms[name]}
            onClick={() => setSelectedRoom(name)}
            entityIds={entityMap?.rooms[name]}
            engineering={engineering}
            comfortTempActive={comfortTempActive}
          />
        ))}
      </div>

      {/* Multi-room temperature overlay */}
      {Object.keys(roomHistory).length > 0 && (
        <div className="mt-4">
          <MultiRoomTempChart roomHistory={roomHistory} />
        </div>
      )}

      {Object.keys(rooms).length === 0 && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          Waiting for pipeline data...
        </div>
      )}

      {/* Room detail modal */}
      {selectedRoom && rooms[selectedRoom] && (
        <RoomDetail
          name={selectedRoom}
          room={rooms[selectedRoom]}
          sysid={sysidData?.rooms?.[selectedRoom]}
          boost={boostRooms[selectedRoom]}
          engineering={engineering}
          onClose={() => setSelectedRoom(null)}
          entityIds={entityMap?.rooms[selectedRoom]}
        />
      )}
    </div>
  )
}
