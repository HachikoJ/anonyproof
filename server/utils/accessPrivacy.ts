// Only fixed classifications and route names leave request memory. Source IP
// remains in the approved seven-day raw DB window, never application log files.
const botPatterns = [
  [/googlebot/i,'Google'],[/bingbot/i,'Bing'],[/slurp/i,'Yahoo'],[/duckduckbot/i,'DuckDuckGo'],
  [/baiduspider/i,'Baidu'],[/yandexbot/i,'Yandex'],[/facebookexternalhit/i,'Facebook'],
  [/twitterbot/i,'Twitter'],[/linkedinbot/i,'LinkedIn'],[/whatsapp/i,'WhatsApp'],[/applebot/i,'Apple'],
  [/semrushbot/i,'Semrush'],[/ahrefsbot/i,'Ahrefs'],[/mj12bot/i,'MJ12'],[/dotbot/i,'Dot'],
  [/crawler/i,'Crawler'],[/spider/i,'Spider'],[/bot/i,'Generic'],
] as const
const families = ['Edge','Opera','Samsung','Firefox','Chrome','Safari','Other']
const classifications = new Set(['unknown','client:script',...families.map(value=>`browser:${value}`),...botPatterns.map(([,name])=>`bot:${name}`)])
export function classifyUserAgent(value: unknown): string {
  const text = typeof value === 'string' ? value : ''
  if (classifications.has(text)) return text
  if (!text.trim()) return 'unknown'
  for (const [pattern,name] of botPatterns) if (pattern.test(text)) return `bot:${name}`
  if (/curl|wget|python|java|perl|ruby|php|go-http|requests|http\.rb|okhttp|axios|node-fetch/i.test(text)) return 'client:script'
  for (const [pattern,name] of [[/edg(?:e|a|ios)?\//i,'Edge'],[/opr\/|opera/i,'Opera'],[/samsungbrowser\//i,'Samsung'],[/firefox\/|fxios\//i,'Firefox'],[/chrome\/|chromium\/|crios\//i,'Chrome'],[/safari\//i,'Safari']] as const) {
    if (pattern.test(text)) return `browser:${name}`
  }
  return 'browser:Other'
}
const staticRoutes = new Set(['/', '/health', '/api/demo/config', '/api/identity', '/api/identity/recover',
  '/api/admin/auth/login','/api/admin/login','/api/admin/auth/session','/api/admin/session',
  '/api/admin/auth/logout','/api/admin/logout','/api/admin/access/stats','/api/admin/access/logs',
  '/api/admin/access/suspicious','/api/admin/access/blacklist','/api/stats','/api/feedback',
  '/api/admin/feedbacks','/api/admin/logs','/api/notifications','/api/notifications/unread-count',
  '/api/notifications/read-all','/unmatched'])
const dynamicRoutes = [
  [/^\/api\/admin\/access\/blacklist\/[^/]+\/?$/,'/api/admin/access/blacklist/:ip'],
  [/^\/api\/admin\/feedback\/[^/]+\/status\/?$/,'/api/admin/feedback/:id/status'],
  [/^\/api\/admin\/feedback\/[^/]+\/comments\/?$/,'/api/admin/feedback/:feedbackId/comments'],
  [/^\/api\/admin\/feedback\/[^/]+\/?$/,'/api/admin/feedback/:id'],
  [/^\/api\/feedback\/device\/[^/]+\/?$/,'/api/feedback/device/:deviceId'],
  [/^\/api\/feedback\/[^/]+\/comments\/?$/,'/api/feedback/:feedbackId/comments'],
  [/^\/api\/feedback\/[^/]+\/?$/,'/api/feedback/:feedbackId'],
  [/^\/api\/notifications\/[^/]+\/read\/?$/,'/api/notifications/:id/read'],
  [/^\/api\/notifications\/[^/]+\/unread\/?$/,'/api/notifications/:id/unread'],
] as const
export function accessRouteTemplate(value: unknown): string {
  const path = typeof value === 'string' ? value.split(/[?#]/,1)[0] : ''
  const normalized = path.length > 1 ? path.replace(/\/$/,'') : path
  if (staticRoutes.has(normalized)) return normalized
  for (const [pattern,template] of dynamicRoutes) if (pattern.test(path)) return template
  return '/unmatched'
}
const suspiciousReasons = new Set(['Empty User-Agent','Script-like User-Agent','Sensitive path access'])
export function safeSuspiciousReason(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parts = value.split(', ')
  return parts.every(part=>suspiciousReasons.has(part)) ? parts.join(', ') : 'Other'
}
const rateLimitReasons = new Set(['Strict rate limit exceeded','Feedback submission rate limit exceeded',
  'Admin API rate limit exceeded','General API rate limit exceeded','Unauthorized admin access attempt'])
export function safeRateLimitReason(value: string) {
  return rateLimitReasons.has(value) ? value : 'Rate limit exceeded'
}
export function safeAccessErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^SQLITE_[A-Z_]+$/.test(code) ? code : 'ACCESS_LOG_ERROR'
}
export function displayAccessLog<T extends {user_agent?:unknown;path:unknown;suspicious_reason?:unknown}>(entry: T) {
  return { ...entry, user_agent: classifyUserAgent(entry.user_agent), path: accessRouteTemplate(entry.path),
    ...(Object.prototype.hasOwnProperty.call(entry,'suspicious_reason') ? {suspicious_reason:safeSuspiciousReason(entry.suspicious_reason)} : {}) }
}
