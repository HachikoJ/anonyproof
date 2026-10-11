'use client'

import { useEffect, useState } from 'react'

export type DemoConfig = {
  demoMode: boolean
  adminPassword?: string
  deviceId?: string
  notice?: string
  examples?: { id: string; category: string; label: string; content: string }[]
  userComments?: DemoChoice[]
  adminComments?: DemoChoice[]
  solutions?: DemoChoice[]
}
export type DemoChoice = { id: string; label: string; content: string }

export function useDemoConfig() {
  const [config, setConfig] = useState<DemoConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    fetch('/anonyproof/api/demo/config', {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuration unavailable')
        return response.json() as Promise<DemoConfig>
      })
      .then((data) => {
        if (!data || typeof data.demoMode !== 'boolean' || (data.demoMode &&
          ![data.examples, data.userComments, data.adminComments, data.solutions].every(items =>
            Array.isArray(items) && items.length > 0 && items.every(item =>
              typeof item.id === 'string' && typeof item.label === 'string' && typeof item.content === 'string')))) {
          throw new Error('Configuration invalid')
        }
        if (active) {
          setConfig(data)
        }
      })
      .catch(() => { if (active) setError('无法确认当前站点模式，输入和提交已暂停。请刷新后重试。') })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return { config, loading, error }
}
