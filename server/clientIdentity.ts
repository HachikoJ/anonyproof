import type express from 'express'
import type Database from 'better-sqlite3'
import crypto from 'crypto'
import { ExpiringMap } from './utils/expiringMap'
import { DEMO_DEVICE_ID, DEMO_SECONDARY_DEVICE_ID, cloneDemoDataForDevice } from './demo'

export class IdentityCapacityError extends Error {}

interface ClientIdentityOptions {
  db: Database.Database
  demoMode: boolean
  isProduction: boolean
  maxIdentityRecords: number
  identityCookieTtlMs: number
  getCookie: (req: express.Request, name: string) => string | undefined
  isAdminAuthenticated: (req: express.Request) => boolean
  requireSameOrigin: (req: express.Request, res: express.Response) => boolean
}

// Called only after the existing schema/seed/legacy-session initialization.
// Authentication functions are injected; auth and identity never import each other.
export function createClientIdentity({ db, demoMode, isProduction, maxIdentityRecords, identityCookieTtlMs,
  getCookie, isAdminAuthenticated, requireSameOrigin }: ClientIdentityOptions) {
  const identityCookieName = 'anonyproof_device_session'
  const maxIdentitySessions = 20

  type ClientIdentityRow = {
    device_id: string
    token_hash: string
    recovery_hash: string
    install_key_hash: string | null
    created_at: number
    last_seen_at: number
    demo_initialized: number
  }

  type ResolvedIdentity = {
    deviceId: string
    recoveryCode?: string
    created: boolean
    adoptedLegacyDevice?: boolean
  }

  function hashIdentityValue(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex')
  }

  function safeIdentityHashEqual(value: string, expectedHash: string) {
    const actual = Buffer.from(hashIdentityValue(value))
    const expected = Buffer.from(expectedHash)
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  }

  function normalizeRecoveryCode(value: string) {
    return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
  }

  function formatRecoveryCode(value: string) {
    const normalized = normalizeRecoveryCode(value)
    return normalized.match(/.{1,5}/g)?.join('-') ?? normalized
  }

  function isValidRecoveryCode(value: string) {
    return /^[A-F0-9]{20}$/.test(normalizeRecoveryCode(value))
  }

  function normalizeInstallKey(value: string) {
    return value.trim()
  }

  function isValidInstallKey(value: string) {
    return /^[A-Za-z0-9_-]{32,128}$/.test(value)
  }

  function createDeviceId() {
    return `device-${crypto.randomBytes(18).toString('base64url')}`
  }

  function createRecoveryCode() {
    const value = crypto.randomBytes(10).toString('hex').toUpperCase()
    return formatRecoveryCode(value)
  }

  const recentRecoveryCodes = new ExpiringMap<string, { code: string; expiresAt: number }>({
    maxEntries: 10000, expiresAt: value => value.expiresAt, onCapacity: 'evict-oldest',
  })
  const recentRecoveryCodeTtlMs = 10 * 60 * 1000

  function rememberRecoveryCode(deviceId: string, recoveryCode: string) {
    recentRecoveryCodes.set(deviceId, {
      code: formatRecoveryCode(recoveryCode),
      expiresAt: Date.now() + recentRecoveryCodeTtlMs,
    })
  }

  function getRecentRecoveryCode(deviceId: string) {
    const entry = recentRecoveryCodes.get(deviceId)
    if (!entry) return ''
    if (entry.expiresAt <= Date.now()) {
      recentRecoveryCodes.delete(deviceId)
      return ''
    }
    return entry.code
  }

  function setIdentityCookie(res: express.Response, deviceId: string, token: string) {
    const secure = isProduction ? '; Secure' : ''
    const value = encodeURIComponent(`${deviceId}.${token}`)
    res.append(
      'Set-Cookie',
      `${identityCookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${identityCookieTtlMs / 1000}${secure}`,
    )
  }

  function identityFromCookie(req: express.Request, touch = true) {
    const value = getCookie(req, identityCookieName)
    if (!value) return null

    const separator = value.lastIndexOf('.')
    if (separator <= 0) return null

    const deviceId = value.slice(0, separator)
    const token = value.slice(separator + 1)
    if (!deviceId || !token) return null

    const now = Date.now()
    const identity = db.prepare(
      `SELECT i.device_id, i.token_hash, i.recovery_hash, i.install_key_hash,
       i.created_at, i.last_seen_at, i.demo_initialized
     FROM client_identity_sessions s
     JOIN client_identities i ON i.device_id = s.device_id
     WHERE s.token_hash = ? AND s.device_id = ? AND s.expires_at > ?`,
    ).get(hashIdentityValue(token), deviceId, now) as ClientIdentityRow | undefined

    if (!identity) return null

    if (touch) {
      db.prepare('UPDATE client_identity_sessions SET last_seen_at = ? WHERE token_hash = ?')
        .run(now, hashIdentityValue(token))
      db.prepare('UPDATE client_identities SET last_seen_at = ? WHERE device_id = ?')
        .run(now, deviceId)
    }
    return identity
  }

  function issueIdentitySession(res: express.Response, deviceId: string) {
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = hashIdentityValue(token)
    const now = Date.now()
    const expiresAt = now + identityCookieTtlMs

    db.transaction(() => {
      db.prepare(`
      INSERT INTO client_identity_sessions (
        token_hash, device_id, created_at, last_seen_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, deviceId, now, now, expiresAt)

      db.prepare('UPDATE client_identities SET token_hash = ?, last_seen_at = ? WHERE device_id = ?')
        .run(tokenHash, now, deviceId)

      // Scheduled T-25 retention clears expired compatibility hashes and sessions
      // atomically in bounded batches; deleting here could revive a legacy token.
      db.prepare(`
      DELETE FROM client_identity_sessions
      WHERE device_id = ?
        AND token_hash NOT IN (
          SELECT token_hash FROM client_identity_sessions
          WHERE device_id = ?
          ORDER BY last_seen_at DESC
          LIMIT ?
        )
    `).run(deviceId, deviceId, maxIdentitySessions)
    })()

    setIdentityCookie(res, deviceId, token)
  }

  function isDemoDeviceId(deviceId: string) {
    return deviceId === DEMO_DEVICE_ID || deviceId === DEMO_SECONDARY_DEVICE_ID
  }

  function issueClientIdentity(
    res: express.Response,
    presetDeviceId?: string,
    installKeyHash?: string,
  ): ResolvedIdentity {
    const now = Date.now()
    const deviceId = presetDeviceId || createDeviceId()
    const recoveryCode = createRecoveryCode()

    db.transaction(() => {
      const current = db.prepare('SELECT COUNT(*) AS count FROM client_identities').get() as { count: number }
      if (current.count >= maxIdentityRecords) throw new IdentityCapacityError('身份容量已达上限，请联系维护人员')
      db.prepare(`
      INSERT INTO client_identities (
        device_id, token_hash, recovery_hash, install_key_hash, created_at, last_seen_at, demo_initialized
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(
        deviceId,
        '',
        hashIdentityValue(normalizeRecoveryCode(recoveryCode)),
        installKeyHash || null,
        now,
        now,
      )

      if (installKeyHash) {
        db.prepare(`
        INSERT INTO client_identity_install_keys (
          install_key_hash, device_id, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?)
      `).run(installKeyHash, deviceId, now, now)
      }
    }).immediate()

    rememberRecoveryCode(deviceId, recoveryCode)
    if (demoMode) cloneDemoDataForDevice(db, deviceId)
    issueIdentitySession(res, deviceId)
    return { deviceId, recoveryCode, created: !presetDeviceId }
  }

  function findIdentityByInstallKey(installKeyHash: string) {
    return db.prepare(
      `SELECT i.device_id, i.token_hash, i.recovery_hash, i.install_key_hash,
       i.created_at, i.last_seen_at, i.demo_initialized
     FROM client_identity_install_keys k
     JOIN client_identities i ON i.device_id = k.device_id
     WHERE k.install_key_hash = ?`,
    ).get(installKeyHash) as ClientIdentityRow | undefined
  }

  function bindInstallKey(deviceId: string, installKeyHash: string, reassign = false) {
    if (!deviceId || !installKeyHash) return

    const owner = findIdentityByInstallKey(installKeyHash)
    if (owner?.device_id === deviceId) return
    if (owner && !reassign) return

    const now = Date.now()
    if (owner) {
      db.prepare(`
      UPDATE client_identity_install_keys
      SET device_id = ?, last_seen_at = ?
      WHERE install_key_hash = ?
    `).run(deviceId, now, installKeyHash)
    } else {
      db.prepare(`
      INSERT INTO client_identity_install_keys (
        install_key_hash, device_id, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?)
    `).run(installKeyHash, deviceId, now, now)
    }
  }

  // 旧版本浏览器只保存了设备 ID，没有服务端身份记录，升级后会丢掉原有提交。
  // 只有当该设备 ID 名下确实存在历史提交、且尚未被任何身份占用时才接管；固定演示设备永远不允许被访客认领。
  function canAdoptLegacyDevice(deviceId: string) {
    if (!deviceId || isDemoDeviceId(deviceId)) return false
    if (deviceId.length < 10 || deviceId.length > 100) return false

    const claimed = db.prepare('SELECT 1 FROM client_identities WHERE device_id = ?').get(deviceId)
    if (claimed) return false

    const owned = db.prepare(`
    SELECT 1 FROM feedbacks
    WHERE device_id = ? AND is_demo_template = 0 AND is_demo_clone = 0
    LIMIT 1
  `).get(deviceId)

    return Boolean(owned)
  }

  function resolveClientIdentity(req: express.Request, res: express.Response): ResolvedIdentity {
    const requestedInstallKey = normalizeInstallKey(req.get('x-anonyproof-install-key') || '')
    const installKeyHash = isValidInstallKey(requestedInstallKey)
      ? hashIdentityValue(requestedInstallKey)
      : ''
    const requestedDeviceId = req.get('x-anonyproof-device-id')?.trim()
    const requestedRecoveryCode = normalizeRecoveryCode(req.get('x-anonyproof-recovery-code') || '')
    const matchingRequestedCode = (identity: ClientIdentityRow) => (
      isValidRecoveryCode(requestedRecoveryCode)
      && safeIdentityHashEqual(requestedRecoveryCode, identity.recovery_hash)
        ? formatRecoveryCode(requestedRecoveryCode)
        : ''
    )

    // A cache miss cannot reproduce a persisted one-way recovery hash. Preserve
    // the saved credential and omit its display value instead of revoking it.
    const existing = identityFromCookie(req)
    if (existing) {
      bindInstallKey(existing.device_id, installKeyHash)
      const recoveryCode = matchingRequestedCode(existing)
        || getRecentRecoveryCode(existing.device_id)
        || undefined
      return { deviceId: existing.device_id, recoveryCode, created: false }
    }

    // Cookie 过期或丢失时，使用浏览器本地保存的设备 ID 与恢复码重新签发凭证。
    if (requestedDeviceId && isValidRecoveryCode(requestedRecoveryCode)) {
      const identity = db.prepare(
        `SELECT device_id, token_hash, recovery_hash, install_key_hash,
         created_at, last_seen_at, demo_initialized
       FROM client_identities WHERE device_id = ?`,
      ).get(requestedDeviceId) as ClientIdentityRow | undefined

      if (identity && safeIdentityHashEqual(requestedRecoveryCode, identity.recovery_hash)) {
        issueIdentitySession(res, identity.device_id)
        bindInstallKey(identity.device_id, installKeyHash, true)
        rememberRecoveryCode(identity.device_id, requestedRecoveryCode)
        return {
          deviceId: identity.device_id,
          recoveryCode: formatRecoveryCode(requestedRecoveryCode),
          created: false,
        }
      }
    }

    // 同一浏览器可能同时打开多个标签页。安装密钥在首次访问前就写入 localStorage，
    // 因此并发初始化会复用同一身份，不会因为前后两次 Set-Cookie 产生两套数据。
    if (installKeyHash) {
      const identity = findIdentityByInstallKey(installKeyHash)
      if (identity) {
        issueIdentitySession(res, identity.device_id)
        const recoveryCode = matchingRequestedCode(identity)
          || getRecentRecoveryCode(identity.device_id)
          || undefined
        return {
          deviceId: identity.device_id,
          recoveryCode,
          created: false,
        }
      }

      if (requestedDeviceId && canAdoptLegacyDevice(requestedDeviceId)) {
        return {
          ...issueClientIdentity(res, requestedDeviceId, installKeyHash),
          adoptedLegacyDevice: true,
        }
      }

      try {
        return issueClientIdentity(res, undefined, installKeyHash)
      } catch (error) {
        if (!String((error as Error)?.message || error).includes('UNIQUE constraint failed')) throw error

        const racedIdentity = findIdentityByInstallKey(installKeyHash)
        if (!racedIdentity) throw error
        issueIdentitySession(res, racedIdentity.device_id)
        return { deviceId: racedIdentity.device_id, created: false }
      }
    }

    if (requestedDeviceId && canAdoptLegacyDevice(requestedDeviceId)) {
      return { ...issueClientIdentity(res, requestedDeviceId), adoptedLegacyDevice: true }
    }

    return issueClientIdentity(res)
  }

  function recoverClientIdentity(
    recoveryCode: string,
    res: express.Response,
    installKeyHash = '',
  ): ResolvedIdentity | null {
    const normalized = normalizeRecoveryCode(recoveryCode)
    if (!isValidRecoveryCode(normalized)) return null

    const identity = db.prepare(
      `SELECT device_id, token_hash, recovery_hash, install_key_hash,
       created_at, last_seen_at, demo_initialized
     FROM client_identities WHERE recovery_hash = ?`,
    ).get(hashIdentityValue(normalized)) as ClientIdentityRow | undefined

    if (!identity) return null

    issueIdentitySession(res, identity.device_id)
    bindInstallKey(identity.device_id, installKeyHash, true)
    rememberRecoveryCode(identity.device_id, normalized)
    return {
      deviceId: identity.device_id,
      recoveryCode: formatRecoveryCode(normalized),
      created: false,
    }
  }

  function requireClientIdentity(req: express.Request, res: express.Response) {
    const identity = identityFromCookie(req)
    if (!identity) {
      res.status(401).json({ error: '本机身份已失效，请刷新页面后重试' })
      return null
    }
    return identity
  }

  const demoRequestIdentities = new WeakMap<express.Request, string>()
  function ensureDemoIdentity(req: express.Request, res: express.Response): ResolvedIdentity {
    const existing = identityFromCookie(req)
    const identity = existing ? { deviceId: existing.device_id, created: false } : issueClientIdentity(res)
    if (existing) cloneDemoDataForDevice(db, existing.device_id)
    // This helper intentionally does not call resolveClientIdentity(): a passive
    // administrator request must never rotate an existing user's recovery code.
    demoRequestIdentities.set(req, identity.deviceId)
    return identity
  }
  function demoRequestDevice(req: express.Request) {
    return demoRequestIdentities.get(req) || identityFromCookie(req)?.device_id || ''
  }
  function canAccessDevice(req: express.Request, deviceId: string) {
    if (demoMode) return demoRequestDevice(req) === deviceId
    return isAdminAuthenticated(req) || identityFromCookie(req)?.device_id === deviceId
  }

  const readIdentity: express.RequestHandler = (req, res) => {
    const identity = identityFromCookie(req, false)
    if (!identity) return res.status(401).json({ error: '本机身份已失效，请刷新页面后重试' })
    const requestedCode = normalizeRecoveryCode(req.get('x-anonyproof-recovery-code') || '')
    const recoveryCode = isValidRecoveryCode(requestedCode) && safeIdentityHashEqual(requestedCode, identity.recovery_hash)
      ? formatRecoveryCode(requestedCode) : getRecentRecoveryCode(identity.device_id) || undefined
    res.json({ success: true, deviceId: identity.device_id, recoveryCode,
      created: false, adoptedLegacyDevice: false, demoMode })
  }

  const initializeIdentity: express.RequestHandler = (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const identity = resolveClientIdentity(req, res)
    res.json({
      success: true,
      deviceId: identity.deviceId,
      recoveryCode: identity.recoveryCode,
      created: identity.created,
      adoptedLegacyDevice: identity.adoptedLegacyDevice === true,
      demoMode,
    })
  }

  const recoverIdentity: express.RequestHandler = (req, res) => {
    if (!requireSameOrigin(req, res)) return
    res.setHeader('Cache-Control', 'no-store')
    const recoveryCode = typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode : ''
    const requestedInstallKey = normalizeInstallKey(req.get('x-anonyproof-install-key') || '')
    const installKeyHash = isValidInstallKey(requestedInstallKey)
      ? hashIdentityValue(requestedInstallKey)
      : ''
    const identity = recoverClientIdentity(recoveryCode, res, installKeyHash)
    if (!identity) {
      return res.status(404).json({ error: '恢复码无效，请检查后重试' })
    }
    res.json({
      success: true,
      deviceId: identity.deviceId,
      recoveryCode: identity.recoveryCode,
    })
  }
  return { hashIdentityValue, identityFromCookie, requireClientIdentity, ensureDemoIdentity,
    demoRequestDevice, canAccessDevice, isDemoDeviceId, readIdentity, initializeIdentity, recoverIdentity }
}
