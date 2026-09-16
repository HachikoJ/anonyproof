'use client'

import { useEffect, useState } from 'react'
import { demoPageSessionHeaders } from '../utils/pageSession'

export type DemoConfig = {
  demoMode: boolean
  adminPassword?: string
  deviceId?: string
  notice?: string
}

export function useDemoConfig() {
  const [config, setConfig] = useState<DemoConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    fetch('/anonyproof/api/demo/config', {
      cache: 'no-store',
      headers: demoPageSessionHeaders(),
    })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json() as Promise<DemoConfig>
      })
      .then((data) => {
        if (active && data && typeof data.demoMode === 'boolean') {
          setConfig(data)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return { config, loading }
}
