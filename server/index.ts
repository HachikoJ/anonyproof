import './env'
import express from 'express'
import cors from 'cors'
import { startLogRetention } from './utils/accessStats'
import { accessStatsMiddleware } from './middleware/accessStats'
import { adminLoginLimiter, identityRecoveryLimiter, positiveIntegerEnv } from './middleware/rateLimit'
import { cookieWriteOriginGuard, exactCorsOrigin, parseAllowedOrigins } from './middleware/requestOrigin'
import { createProxyBoundary } from './middleware/proxyBoundary'
import { startIdempotencyCleanup } from './utils/requestIdempotency'
import { openDatabase, databasePath } from './utils/database'
import { loadContentEncryption } from './utils/contentEncryption'
import { createClientIdentity } from './clientIdentity'
import { createAdminAuth } from './adminAuth'
import { initializeBusinessSchema } from './schema'
import { registerPublicRoutes, registerAdminRoutes, registerAccessRoutes, registerIdentityRoutes, registerBusinessRoutes, registerFinalErrorHandler } from './routes'
import { startIdentityRetention } from './utils/identityRetention'
import { logger } from './utils/logger'
import { DEMO_ADMIN_PASSWORD, DEMO_NOTICE, isDemoMode } from './demo'

const app = express()
const PORT = Number(process.env.PORT || 4000)
// 生产环境由 Nginx 反向代理到本机端口，默认只监听回环地址，避免后端端口直接暴露到公网。
const HOST = process.env.BIND_HOST || '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const demoMode = isDemoMode()
// Only fixed synthetic demo content may use the keyless codec.
const contentEncryption = loadContentEncryption({ demoMode, env: demoMode ? {} : process.env })
const adminAuth = createAdminAuth({
  env: process.env, demoMode, isProduction,
  getAllowedOrigins: () => allowedOrigins,
  ensureDemoIdentity: (req, res) => ensureDemoIdentity(req, res),
})
const maxIdentityRecords = positiveIntegerEnv('IDENTITY_MAX_RECORDS', 100000)

adminAuth.validateConfiguration()

// 中间件
app.use(['/api/identity', '/api/admin', '/api/feedback', '/api/notifications'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  // Protected JSON must always be re-authorized and returned in full. Express
  // otherwise treats a matching client ETag as a reason to send a 304.
  delete req.headers['if-none-match']
  delete req.headers['if-modified-since']
  next()
})
// Authenticate the proxy before any source quota, origin or business handling.
app.use(createProxyBoundary(process.env))
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS)
app.use(cors({ origin: exactCorsOrigin(allowedOrigins), credentials: true }))
// Reject before parsing/authentication can change sessions or business state.
app.use('/api', cookieWriteOriginGuard(allowedOrigins))
// Admit login POSTs before JSON parsing so malformed/oversized bodies consume
// the same source quota as successful and failed authentication attempts.
app.post(['/api/admin/auth/login', '/api/admin/login'], adminLoginLimiter)
app.post('/api/identity/recover', identityRecoveryLimiter)
// Allows worst-case escaped JSON for the bounded text/envelope, while placing
// an explicit cap on unrelated or malformed request bodies.
app.use(express.json({ limit: '384kb' }))
const jsonErrorHandler: express.ErrorRequestHandler = (error, _req, res, next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '无效的 JSON 请求' })
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大' })
  next(error)
}
app.use(jsonErrorHandler)
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
app.use(accessStatsMiddleware)

registerPublicRoutes(app, demoMode)

adminAuth.initializeSessionSigning()
const { cookieName, getCookie, requireSameOrigin, isAdminAuthenticated } = adminAuth
registerAdminRoutes(app, adminAuth)
registerAccessRoutes(app, demoMode)

// 初始化数据库
const db = openDatabase()
const { identityCookieTtlMs } = initializeBusinessSchema(db, contentEncryption, demoMode)

const clientIdentity = createClientIdentity({
  db, demoMode, isProduction, maxIdentityRecords, identityCookieTtlMs,
  getCookie, isAdminAuthenticated, requireSameOrigin,
})
const { hashIdentityValue, identityFromCookie, requireClientIdentity, ensureDemoIdentity,
  demoRequestDevice, canAccessDevice, isDemoDeviceId } = clientIdentity
registerIdentityRoutes(app, clientIdentity)
registerBusinessRoutes(app, { db, contentEncryption, demoMode, cookieName, getCookie,
  isAdminAuthenticated, hashIdentityValue, identityFromCookie, requireClientIdentity,
  demoRequestDevice, canAccessDevice, isDemoDeviceId })
registerFinalErrorHandler(app)

// 启动服务器
const apiServer = app.listen(PORT, HOST, () => {
  const idempotencyCleanup = startIdempotencyCleanup(db)
  apiServer.once('close', () => idempotencyCleanup.close())
  const logRetention = startLogRetention()
  apiServer.once('close', () => logRetention.close())
  const identityRetention = startIdentityRetention(db, demoMode ? 'demo' : 'formal', logger)
  apiServer.once('close', () => identityRetention.close())
  console.log(`AnonyProof API Server running on ${HOST}:${PORT}`)
  console.log(`Database: ${databasePath}`)
  if (demoMode) {
    console.warn(`DEMO MODE ENABLED: ${DEMO_NOTICE}`)
    console.warn(`Demo admin password: ${DEMO_ADMIN_PASSWORD}`)
  }
})
