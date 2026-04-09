import { useEffect, useState } from 'react'
import type { RoomsResponse } from '../types/api'
import { apiUrl } from '../lib/api'

export function useRooms() {
  const [data, setData] = useState<RoomsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(apiUrl('api/status/rooms'))
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  return { data, error }
}
