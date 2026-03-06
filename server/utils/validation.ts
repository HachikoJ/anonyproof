// 后端验证工具

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

  if (deviceId.length < 10 || deviceId.length > 100) {
    return false
  }

  return true
}

/**
 * 验证状态
 */
export function validateStatus(status: string): boolean {
  const validStatuses = ['pending', 'reviewed', 'resolved']
  return validStatuses.includes(status)
}

/**
 * 清理输入
 */
export function sanitizeInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}
