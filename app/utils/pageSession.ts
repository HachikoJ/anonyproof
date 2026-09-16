const STORAGE_KEY = 'anonyproof-demo-page-session'

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

let pageSessionId = ''

function isHardReload() {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return false
  }

  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  return entry?.type === 'reload'
}

// 同一个标签页内复用同一个会话标识：站内跳转、软导航和接口轮询都不会重复触发演示数据重置。
// 只有新开标签页或用户手动刷新时才生成新标识，让演示状态在“新访客进入”时恢复一次。
export function getDemoPageSessionId() {
  if (typeof window === 'undefined') return ''
  if (pageSessionId) return pageSessionId

  const forceNew = isHardReload()

  try {
    if (!forceNew) {
      const stored = window.sessionStorage.getItem(STORAGE_KEY)
      if (stored) {
        pageSessionId = stored
        return pageSessionId
      }
    }

    pageSessionId = createId()
    window.sessionStorage.setItem(STORAGE_KEY, pageSessionId)
    return pageSessionId
  } catch {
    pageSessionId = createId()
    return pageSessionId
  }
}

export function demoPageSessionHeaders(): Record<string, string> {
  const id = getDemoPageSessionId()
  return id ? { 'x-anonyproof-demo-session': id } : {}
}
