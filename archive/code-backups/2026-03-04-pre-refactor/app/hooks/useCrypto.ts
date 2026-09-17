import { useState, useEffect } from 'react'

export function useCrypto() {
  const [deviceId, setDeviceId] = useState<string>('')

  useEffect(() => {
    // 生成或获取设备 ID
    let did = localStorage.getItem('anonyproof_device_id')
    if (!did) {
      // 使用兼容性更好的方法生成UUID
      did = 'device-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9)
      localStorage.setItem('anonyproof_device_id', did)
    }
    setDeviceId(did)
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
    encrypt,
    decrypt,
  }
}
