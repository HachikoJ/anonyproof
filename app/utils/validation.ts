// 输入验证工具

/**
 * 验证反馈内容
 */
export function validateFeedbackContent(content: string): {
  valid: boolean
  error?: string
} {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: '内容不能为空' }
  }

  const trimmed = content.trim()

  if (trimmed.length < 10) {
    return { valid: false, error: '内容过短（至少 10 个字符）' }
  }

  if (trimmed.length > 10000) {
    return { valid: false, error: '内容过长（最多 10000 个字符）' }
  }

  // 检查是否包含潜在的 XSS 攻击（虽然 React 会自动转义，但双重保护）
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /onerror/i,
    /onclick/i,
    /onload/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(content)) {
      return { valid: false, error: '内容包含不安全的字符' }
    }
  }

  return { valid: true }
}

/**
 * 验证分类
 */
export function validateCategory(category: string): boolean {
  const validCategories = ['suggestion', 'complaint', 'report']
  return validCategories.includes(category)
}

/**
 * 验证设备 ID
 */
export function validateDeviceId(deviceId: string): boolean {
  if (!deviceId || typeof deviceId !== 'string') {
    return false
  }

  // 检查长度（UUID 通常是 36 字符，自定义 device-id 也应该在合理范围）
  if (deviceId.length < 10 || deviceId.length > 100) {
    return false
  }

  return true
}

/**
 * 验证反馈 ID
 */
export function validateFeedbackId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false
  }

  // UUID 格式验证
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

/**
 * 清理用户输入（去除多余空格、特殊字符等）
 */
export function sanitizeInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}
