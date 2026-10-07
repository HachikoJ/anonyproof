// 后端验证工具

export const MAX_CONTENT_CHARACTERS = 10000
// UTF-8 uses at most three bytes per UTF-16 code unit. Legacy AES-GCM
// envelope: 12-byte IV + 32-byte key + 16-byte tag, encoded as base64.
export const MAX_ENCRYPTED_CONTENT_BYTES = Math.ceil((3 * MAX_CONTENT_CHARACTERS + 60) / 3) * 4

/**
 * 验证反馈内容
 */
export function validateFeedbackContent(content: unknown): {
  valid: boolean
  error?: string
} {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: '内容不能为空' }
  }

  const trimmed = content.trim()

  if (!trimmed) {
    return { valid: false, error: '内容不能为空' }
  }

  if (content.length > MAX_CONTENT_CHARACTERS) {
    return { valid: false, error: '内容过长（最多 10000 个字符）' }
  }

  return { valid: true }
}

export function validateCommentContent(content: unknown): { valid: boolean; error?: string } {
  if (typeof content !== 'string') return { valid: false, error: '评论内容必须为文本' }
  const trimmed = content.trim()
  if (trimmed.length < 2) return { valid: false, error: '评论内容至少需要 2 个字符' }
  if (trimmed.length > 1000 || Buffer.byteLength(trimmed, 'utf8') > 3000) {
    return { valid: false, error: '评论内容不能超过 1000 个字符' }
  }
  return { valid: true }
}

export function validateSolutionContent(solution: unknown, status: string): { valid: boolean; error?: string } {
  if (solution !== undefined && typeof solution !== 'string') {
    return { valid: false, error: '处理说明必须为文本' }
  }
  const content = solution ?? ''
  if (content.length > MAX_CONTENT_CHARACTERS || Buffer.byteLength(content, 'utf8') > 30000) {
    return { valid: false, error: '处理说明不能超过 10000 个字符' }
  }
  if (status !== 'in_progress' && content.trim().length < 10) {
    return { valid: false, error: '标记为已办结或暂无法处理时，处理说明必须至少 10 个字符' }
  }
  return { valid: true }
}

/**
 * 验证分类
 */
export function validateCategory(category: unknown): category is string {
  const validCategories = ['suggestion', 'complaint', 'report']
  return typeof category === 'string' && validCategories.includes(category)
}

/**
 * 验证设备 ID
 */
export function validateDeviceId(deviceId: unknown): deviceId is string {
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
export function validateStatus(status: unknown): status is string {
  const validStatuses = ['in_progress', 'resolved', 'no_solution']
  return typeof status === 'string' && validStatuses.includes(status)
}

/**
 * 清理输入
 */
export function sanitizeInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}
