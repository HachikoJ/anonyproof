import type { CorsOptions } from 'cors'

function canonicalHttpOrigin(value: string) {
  try {
    const parsed = new URL(value)
    if (value.includes('*') || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) return null
    return parsed.origin
  } catch {
    return null
  }
}

// No implicit main-domain or localhost fallback. Configuration contains exact,
// canonical origins, not URLs whose path/credentials would silently be dropped.
export function parseAllowedOrigins(configured: string | undefined) {
  if (!configured?.trim()) throw new Error('必须显式配置 CORS_ORIGINS（准确的 http/https Origin 列表）')
  const origins = configured.split(',').map(value => value.trim())
  if (origins.some(origin => !canonicalHttpOrigin(origin))) {
    throw new Error('CORS_ORIGINS 只能包含准确的 http/https Origin，不能含通配符、路径、凭证或空项')
  }
  return Object.freeze(Array.from(new Set(origins)))
}

export function isTrustedRequestOrigin(origin: string | undefined, allowedOrigins: readonly string[]) {
  return Boolean(origin && canonicalHttpOrigin(origin) && allowedOrigins.includes(origin))
}

export function exactCorsOrigin(allowedOrigins: readonly string[]): CorsOptions['origin'] {
  return (origin, callback) => callback(null, isTrustedRequestOrigin(origin, allowedOrigins))
}

