import { useEffect, useState } from 'react'
import type { SysidResponse } from '../types/api'
import { apiUrl } from '../lib/api'

export function useSysid() {
  const [data, setData] = useState<SysidResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(apiUrl('api/sysid'))
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  return { data, error }
}
