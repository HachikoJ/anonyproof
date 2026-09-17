import { useCallback, useEffect, useState } from 'react'

const DEVICE_ID_KEY = 'anonyproof_device_id'
const RECOVERY_CODE_KEY = 'anonyproof_recovery_code'
const INSTALL_KEY_KEY = 'anonyproof_install_key'

type IdentityResponse = {
  success: boolean
  deviceId?: string
  recoveryCode?: string
  created?: boolean
  adoptedLegacyDevice?: boolean
  error?: string
}

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value)
  } catch {
    // 隐私模式下 localStorage 可能不可用，此时仍可依赖 Cookie 完成本次访问。
  }
}

function persistIdentity(data: IdentityResponse) {
  if (data.deviceId) writeStored(DEVICE_ID_KEY, data.deviceId)
  if (data.recoveryCode) writeStored(RECOVERY_CODE_KEY, data.recoveryCode)
}

let memoryInstallKey = ''

function createInstallKey() {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32)
    window.crypto.getRandomValues(bytes)
    return btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

// 安装密钥用于同一浏览器在 Cookie 失效后继续拿到原身份；它只在本地保存，
// 与恢复码分工不同：前者负责本机续接，后者负责换浏览器找回。
function getInstallKey() {
  if (memoryInstallKey) return memoryInstallKey

  const stored = readStored(INSTALL_KEY_KEY)
  if (stored) {
    memoryInstallKey = stored
    return stored
  }

  memoryInstallKey = createInstallKey()
  writeStored(INSTALL_KEY_KEY, memoryInstallKey)
  return memoryInstallKey
}

async function fetchIdentity(): Promise<IdentityResponse> {
  const storedDeviceId = readStored(DEVICE_ID_KEY)
  const storedRecoveryCode = readStored(RECOVERY_CODE_KEY)
  const headers: Record<string, string> = {
    'X-AnonyProof-Install-Key': getInstallKey(),
  }
  if (storedDeviceId) headers['X-AnonyProof-Device-Id'] = storedDeviceId
  if (storedRecoveryCode) headers['X-AnonyProof-Recovery-Code'] = storedRecoveryCode

  const response = await fetch('/anonyproof/api/identity', {
    cache: 'no-store',
    headers,
  })
  const data = await response.json().catch(() => null) as IdentityResponse | null
  if (!response.ok || !data?.success || !data.deviceId) {
    throw new Error(data?.error || '无法初始化本机身份')
  }
  return data
}

let initialIdentityRequest: Promise<IdentityResponse> | null = null

// 并发调用（例如 React 严格模式重复挂载）共用同一次身份请求，避免同一浏览器被签发两个身份，
// 导致本地标识和 Cookie 指向不同数据。刚创建或接管身份时再确认一次，以 Cookie 实际落地的身份为准。
function loadIdentity() {
  if (!initialIdentityRequest) {
    initialIdentityRequest = (async () => {
      const data = await fetchIdentity()
      persistIdentity(data)

      if (data.created || data.adoptedLegacyDevice) {
        const confirmed = await fetchIdentity().catch(() => null)
        if (confirmed) {
          persistIdentity(confirmed)
          return confirmed
        }
      }

      return data
    })().catch((error) => {
      initialIdentityRequest = null
      throw error
    })
  }

  return initialIdentityRequest
}

export function useCrypto() {
  const [deviceId, setDeviceId] = useState<string>('')
  const [recoveryCode, setRecoveryCode] = useState<string>('')
  const [identityLoading, setIdentityLoading] = useState(true)
  const [identityError, setIdentityError] = useState('')

  useEffect(() => {
    let active = true
    loadIdentity()
      .then((data) => {
        if (!active || !data.deviceId) return
        setDeviceId(data.deviceId)
        setRecoveryCode(data.recoveryCode || readStored(RECOVERY_CODE_KEY))
        setIdentityError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        // 页面本身仍可阅读，需要身份的操作会给出可重试的错误提示。
        setIdentityError(error instanceof Error ? error.message : '无法初始化本机身份')
      })
      .finally(() => {
        if (active) setIdentityLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const recoverIdentity = useCallback(async (code: string) => {
    const response = await fetch('/anonyproof/api/identity/recover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AnonyProof-Install-Key': getInstallKey(),
      },
      body: JSON.stringify({ recoveryCode: code }),
    })
    const data = await response.json().catch(() => null) as IdentityResponse | null
    if (!response.ok || !data?.success || !data.deviceId) {
      throw new Error(data?.error || '恢复码无效')
    }

    persistIdentity(data)
    initialIdentityRequest = null
    setDeviceId(data.deviceId)
    setRecoveryCode(data.recoveryCode || code)
    return data.deviceId
  }, [])

  // 加密函数 - 降级方案：如果Web Crypto API不可用，使用简单Base64编码
  const encrypt = async (content: string): Promise<string> => {
    try {
      // 检查是否支持 Web Crypto API
      if (!window.crypto || !window.crypto.subtle) {
        console.warn('Web Crypto API不可用，使用Base64编码')
        // 降级方案：简单Base64编码
        return btoa(unescape(encodeURIComponent(content)))
      }

      // 生成随机密钥
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )

      // 生成 IV
      const iv = crypto.getRandomValues(new Uint8Array(12))

      // 加密内容
      const encodedContent = new TextEncoder().encode(content)
      const encryptedContent = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encodedContent
      )

      // 导出密钥
      const exportedKey = await crypto.subtle.exportKey('raw', key)

      // 组合: iv + key + encrypted_content
      const combined = new Uint8Array(
        iv.length + exportedKey.byteLength + encryptedContent.byteLength
      )
      combined.set(iv)
      combined.set(new Uint8Array(exportedKey), iv.length)
      combined.set(new Uint8Array(encryptedContent), iv.length + exportedKey.byteLength)

      // 转换为 base64
      const base64 = btoa(Array.from(combined, b => String.fromCharCode(b)).join(''))

      return base64
    } catch (error) {
      console.error('加密失败，使用降级方案:', error)
      // 最终降级：Base64编码
      try {
        return btoa(unescape(encodeURIComponent(content)))
      } catch (e) {
        console.error('Base64编码也失败:', e)
        throw new Error('加密失败，请使用现代浏览器访问')
      }
    }
  }

  // 解密函数（用于管理后台，如果需要）
  const decrypt = async (encryptedBase64: string): Promise<string> => {
    try {
      // 解码 base64
      const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0))

      // 分离 iv, key, encrypted_content
      const iv = combined.slice(0, 12)
      const keyData = combined.slice(12, 44)
      const encryptedContent = combined.slice(44)

      // 导入密钥
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )

      // 解密
      const decryptedContent = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedContent
      )

      // 解码
      return new TextDecoder().decode(decryptedContent)
    } catch (error) {
      console.error('解密失败:', error)
      throw new Error('解密失败')
    }
  }

  return {
    deviceId,
    recoveryCode,
    recoverIdentity,
    identityLoading,
    identityError,
    encrypt,
    decrypt,
  }
}
