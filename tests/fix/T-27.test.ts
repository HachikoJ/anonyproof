import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, projectRoot, launchBackend, startBackend } from './helpers'
import { exactCorsOrigin, isTrustedRequestOrigin, parseAllowedOrigins } from '../../server/middleware/requestOrigin'

const requireServer = createRequire(path.join(projectRoot, 'server/package.json'))
const express = requireServer('express') as typeof import('express')
const cors = requireServer('cors') as typeof import('cors')

test('T-27: only explicit canonical origin configuration is accepted', () => {
  const approved = ['https://anonyproof.deline.top', 'http://localhost:3000', 'http://127.0.0.1:3000']
  assert.deepEqual(parseAllowedOrigins(' ' + approved.join(' , ') + ' , ' + approved[0] + ' '), approved)
  for (const configuration of [undefined, '', ' ', '*', 'null', 'https://*.deline.top',
    'https://anonyproof.deline.top/', 'https://anonyproof.deline.top/path',
    'https://anonyproof.deline.top?x=1', 'https://anonyproof.deline.top#fragment',
    'https://user:password@anonyproof.deline.top', 'ftp://anonyproof.deline.top',
    'https://anonyproof.deline.top,', 'https://anonyproof.deline.top,,http://localhost:3000',
    'HTTPS://ANONYPROOF.DELINE.TOP', 'https://anonyproof.deline.top:443']) {
    assert.throws(() => parseAllowedOrigins(configuration), /CORS_ORIGINS/)
  }
  for (const origin of approved) assert.equal(isTrustedRequestOrigin(origin, approved), true)
  for (const origin of [undefined, 'null', 'https://deline.top', 'https://attacker.anonyproof.deline.top',
    'https://outside.invalid', approved[0] + '/', approved[0] + '?x=1', approved[0] + ', https://outside.invalid']) {
    assert.equal(isTrustedRequestOrigin(origin, approved), false)
  }
})

test('T-27: actual CORS preflight/read responses expose only approved exact origins', async (t) => {
  const origins = parseAllowedOrigins('https://anonyproof.deline.top,http://localhost:3000')
  const app = express()
  app.use(cors({ origin: exactCorsOrigin(origins), credentials: true }))
  app.get('/probe', (_req, res) => res.json({ synthetic: true }))
  const server = app.listen({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/probe`
  for (const origin of ['https://anonyproof.deline.top', 'http://localhost:3000', 'https://deline.top',
    'https://attacker.anonyproof.deline.top', 'https://outside.invalid', 'null', undefined]) {
    for (const method of ['GET', 'OPTIONS']) {
      const headers: Record<string, string> = {}
      if (origin !== undefined) headers.Origin = origin
      if (method === 'OPTIONS') {
        headers['Access-Control-Request-Method'] = 'POST'
        headers['Access-Control-Request-Headers'] = 'content-type,x-anonyproof-install-key'
      }
      const response = await fetch(url, { method, headers, signal: AbortSignal.timeout(3000) })
      const allowed = origin !== undefined && origins.includes(origin)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowed ? origin : null)
      assert.equal(response.headers.get('Access-Control-Allow-Credentials'), allowed ? 'true' : null)
      assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), '*')
      if (allowed && method === 'OPTIONS') assert.equal(response.status, 204)
      if (method === 'GET') {
        assert.equal(response.status, 200)
        assert.equal((await response.json()).synthetic, true)
      }
    }
  }
  // Header evidence alone does not prove a browser blocked reads; browser
  // same-site/cross-site verification is a separate required acceptance step.
})

test('T-27: actual production backend rejects missing or invalid origin configuration', async (t) => {
  // Requires requestOrigin configuration wiring in server/index.ts. It must
  // not be counted as passed merely because the standalone module tests pass.
  for (const configured of ['', ' ', '*', 'https://*.deline.top', 'https://anonyproof.deline.top/path',
    'https://anonyproof.deline.top,']) {
    const service = await launchBackend({ CORS_ORIGINS: configured })
    t.after(service.stop)
    const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(exit, 'timeout', `CORS_ORIGINS=${configured}`)
    assert.notEqual(exit, 0)
    assert.ok(service.output().includes('CORS_ORIGINS'))
  }
})

test('T-27: product backend preflight and authenticated reads use the exact configured origins', async (t) => {
  const approved = ['https://anonyproof.deline.top', 'http://localhost:3000']
  const service = await startBackend({ CORS_ORIGINS: approved.join(',') })
  t.after(service.stop)
  const admin = new Client(service)
  const login = await admin.request('/api/admin/auth/login', {
    method: 'POST', headers: { Origin: approved[0], 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: service.password }),
  })
  assert.equal(login.response.status, 200)
  assert.equal(login.response.headers.get('Access-Control-Allow-Origin'), approved[0])
  for (const origin of [...approved, 'https://deline.top', 'https://attacker.anonyproof.deline.top',
    'https://outside.invalid', 'null', approved[0] + '/', undefined]) {
    const headers: Record<string, string> = {}
    if (origin !== undefined) headers.Origin = origin
    const preflight = await admin.request('/api/admin/auth/login', {
      method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-anonyproof-install-key' },
    })
    const read = await admin.request('/api/admin/auth/session', { headers })
    const allowed = origin !== undefined && approved.includes(origin)
    for (const result of [preflight, read]) {
      assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), allowed ? origin : null)
      assert.equal(result.response.headers.get('Access-Control-Allow-Credentials'), allowed ? 'true' : null)
      assert.notEqual(result.response.headers.get('Access-Control-Allow-Origin'), '*')
      assert.ok(result.response.status < 500)
    }
    if (allowed) assert.equal(preflight.response.status, 204)
    assert.equal(read.response.status, 200)
    assert.equal(read.data.authenticated, true)
  }
  // Node deliberately sends the valid Cookie in this matrix and can read JSON.
  // Browser CORS enforcement and actual same-site/cross-site Cookie emission
  // must be verified separately; CORS is not server-side authentication.
})
