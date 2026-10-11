import type express from 'express'
import crypto from 'crypto'
import { ExpiringMap, ExpiringMapCapacityError } from './utils/expiringMap'
import { isTrustedRequestOrigin } from './middleware/requestOrigin'
import { DEMO_ADMIN_PASSWORD } from './demo'

interface AdminAuthOptions {
  env: NodeJS.ProcessEnv
  demoMode: boolean
  isProduction: boolean
  getAllowedOrigins: () => readonly string[]
  ensureDemoIdentity: (req: express.Request, res: express.Response) => { deviceId: string; recoveryCode?: string }
}

// Dependencies used by request handlers remain deferred until after assembly.
// This factory creates the same process-local stores at the original startup point.
export function createAdminAuth({ env, demoMode, isProduction, getAllowedOrigins, ensureDemoIdentity }: AdminAuthOptions) {
  const configuredAdminPassword = env.ADMIN_PASSWORD?.trim()
  // Demo mode always uses the published password so the login hint cannot drift from the server.
  const adminPassword = demoMode ? DEMO_ADMIN_PASSWORD : configuredAdminPassword
  const sessionSecret = env.SESSION_SECRET
  const sessionTtlMs = 8 * 60 * 60 * 1000
  const loginAttemptLimit = demoMode ? 50 : 5
  const sessions = new ExpiringMap<string, number>({ maxEntries: 1000, expiresAt: value => value })
  const loginAttempts = new ExpiringMap<string, { count: number; resetAt: number }>({
    maxEntries: 10000, expiresAt: value => value.resetAt,
  })

  // Entry calls this after the existing identity-capacity configuration check.
  function validateConfiguration() {
    if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
      throw new Error('生产环境必须设置 SESSION_SECRET（至少 32 位）')
    }

    if (isProduction && !demoMode && (!configuredAdminPassword || configuredAdminPassword.length < 12)) {
      throw new Error('正式环境必须设置 ADMIN_PASSWORD（至少 12 位）')
    }
  }

  const cookieName = 'anonyproof_admin_session'
  let secret: string

  // Called at the original signing-key initialization point, after public routes.
  function initializeSessionSigning() {
    secret = sessionSecret || crypto.randomBytes(32).toString('hex')
  }

  function signSession(token: string) {
    return crypto.createHmac('sha256', secret).update(token).digest('hex')
  }

  function createSession() {
    const token = crypto.randomBytes(32).toString('hex')
    const value = `${token}.${signSession(token)}`
    sessions.set(value, Date.now() + sessionTtlMs)
    return value
  }

  function getCookie(req: express.Request, name: string) {
    const header = req.headers.cookie || ''
    const entry = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))
    if (!entry) return undefined
    try {
      return decodeURIComponent(entry.slice(name.length + 1))
    } catch {
      return undefined
    }
  }

  function validSession(value?: string) {
    if (!value) return false
    const [token, signature] = value.split('.')
    const expected = token ? signSession(token) : ''
    const signatureBuffer = Buffer.from(signature || '')
    const expectedBuffer = Buffer.from(expected)
    if (!token || !signature || signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false
    const expiresAt = sessions.get(value)
    if (!expiresAt || expiresAt <= Date.now()) {
      sessions.delete(value)
      return false
    }
    return true
  }

  function setSessionCookie(res: express.Response, value: string) {
    const secure = isProduction ? '; Secure' : ''
    res.append('Set-Cookie', `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTtlMs / 1000}${secure}`)
  }

  function clearSessionCookie(res: express.Response) {
    res.append('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
  }

  function safePasswordEqual(input: string, expected: string) {
    const inputBuffer = Buffer.from(input)
    const expectedBuffer = Buffer.from(expected)
    return inputBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(inputBuffer, expectedBuffer)
  }

  function requireSameOrigin(req: express.Request, res: express.Response) {
    if (isTrustedRequestOrigin(req.get('origin'), getAllowedOrigins())) return true
    res.status(403).json({ error: '请求来源不受信任' })
    return false
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!validSession(getCookie(req, cookieName))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !requireSameOrigin(req, res)) return
    res.setHeader('Cache-Control', 'no-store')
    next()
  }

  const login: express.RequestHandler = (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const attempt = loginAttempts.get(ip)
    if (attempt && attempt.resetAt > now && attempt.count >= loginAttemptLimit) {
      res.setHeader('Retry-After', Math.ceil((attempt.resetAt - now) / 1000))
      return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' })
    }
    if (!adminPassword) return res.status(503).json({ error: '管理员认证尚未配置' })
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!safePasswordEqual(password, adminPassword)) {
      const nextAttempt = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60 * 1000 }
      nextAttempt.count += 1
      try {
        loginAttempts.set(ip, nextAttempt)
      } catch (error) {
        if (!(error instanceof ExpiringMapCapacityError)) throw error
        return res.status(503).json({ error: '登录保护容量已满，请稍后再试' })
      }
      return res.status(401).json({ error: '密码错误' })
    }
    // Reserve capacity before demo identity issuance can write rows or cookies.
    // A full store rejects new logins without evicting existing valid sessions.
    let session: string
    try {
      session = createSession()
    } catch (error) {
      if (!(error instanceof ExpiringMapCapacityError)) throw error
      return res.status(503).json({ error: '管理员会话容量已满，请稍后再试' })
    }
    try {
      const demoIdentity = demoMode ? ensureDemoIdentity(req, res) : undefined
      loginAttempts.delete(ip)
      setSessionCookie(res, session)
      res.json({ success: true, ...(demoIdentity ? { deviceId: demoIdentity.deviceId, recoveryCode: demoIdentity.recoveryCode } : {}) })
    } catch (error) {
      sessions.delete(session)
      throw error
    }
  }

  const session: express.RequestHandler = (req, res) => {
    const authenticated = validSession(getCookie(req, cookieName))
    if (authenticated) res.setHeader('Cache-Control', 'no-store')
    res.json({ authenticated })
  }

  const logout: express.RequestHandler = (req, res) => {
    const session = getCookie(req, cookieName)
    if (session) sessions.delete(session)
    clearSessionCookie(res)
    res.json({ success: true })
  }

  function isAdminAuthenticated(req: express.Request) {
    return validSession(getCookie(req, cookieName))
  }

  return { cookieName, getCookie, requireSameOrigin, requireAdmin, isAdminAuthenticated,
    login, session, logout, validateConfiguration, initializeSessionSigning }
}
