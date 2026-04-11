import { useEffect, useState } from 'react'
import type { StatusResponse } from '../types/api'
import { apiUrl } from '../lib/api'

export function useStatus() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(apiUrl('api/status'))
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  return { data, error }
}
