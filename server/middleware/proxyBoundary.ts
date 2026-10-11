import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { Request, RequestHandler } from 'express'

export const PROXY_AUTH_HEADER = 'x-anonyproof-proxy-auth'
const forwardedHeaders = ['forwarded', 'x-forwarded-for', 'x-real-ip',
  'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto',
  'x-forwardedfor', 'x-forwardedproto']

function removeHeaders(req: Request, names: string[]) {
  for (const name of names) delete req.headers[name]
  req.rawHeaders = req.rawHeaders.filter((_, index, values) =>
    !names.includes(values[index - index % 2].toLowerCase()))
}
function loopback(address?: string) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Only an authenticated, normalized ingress may supply a source identity. */
export function createProxyBoundary(env: NodeJS.ProcessEnv): RequestHandler {
  const enabled = env.TRUST_PROXY === '1'
  if (env.TRUST_PROXY !== undefined && !['0', '1'].includes(env.TRUST_PROXY)) {
    throw new Error('TRUST_PROXY must be 0 or 1')
  }
  const configured = env.PROXY_AUTH_KEY || ''
  const expected = Buffer.from(configured, 'base64')
  if (enabled && (expected.length < 32 || expected.length > 64 || expected.toString('base64') !== configured)) {
    throw new Error('Proxy mode requires an independent 32-64 byte base64 PROXY_AUTH_KEY')
  }
  return (req, res, next) => {
    const supplied = req.get(PROXY_AUTH_HEADER) || ''
    const occurrences = req.rawHeaders.filter((value, index) =>
      index % 2 === 0 && value.toLowerCase() === PROXY_AUTH_HEADER).length
    removeHeaders(req, [PROXY_AUTH_HEADER])
    if (!enabled || !(req.path === '/api' || req.path.startsWith('/api/'))) {
      removeHeaders(req, forwardedHeaders)
      return next()
    }
    const candidate = Buffer.from(supplied)
    const encoded = Buffer.from(configured)
    const source = req.get('x-forwarded-for') || ''
    const sourceOccurrences = req.rawHeaders.filter((value, index) =>
      index % 2 === 0 && value.toLowerCase() === 'x-forwarded-for').length
    if (!loopback(req.socket.remoteAddress) || occurrences !== 1 ||
        candidate.length !== encoded.length || !timingSafeEqual(candidate, encoded) ||
        sourceOccurrences !== 1 || !isIP(source)) {
      removeHeaders(req, forwardedHeaders)
      return res.status(403).json({ error: '代理来源校验失败' })
    }
    next()
  }
}
