import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { Client, startBackend, projectRoot } from './helpers'

test('T-23 single instance: same-secret restart invalidates old admin session, re-login and logout remain usable', async t => {
  const key = randomBytes(32).toString('base64'), secret = randomBytes(32).toString('hex')
  let service = await startBackend({ CONTENT_ENCRYPTION_KEY: key, SESSION_SECRET: secret })
  t.after(() => service.stop())
  const client = new Client(service)
  assert.equal((await client.login()).response.status, 200)
  assert.equal((await client.request('/api/admin/feedbacks')).response.status, 200)
  const databasePath = service.databasePath, password = service.password, port = new URL(service.baseUrl).port
  await service.stop()
  service = await startBackend({ DATABASE_PATH: databasePath, PORT: port, CONTENT_ENCRYPTION_KEY: key,
    SESSION_SECRET: secret, ADMIN_PASSWORD: password })
  client.service = service
  // Same signing secret and same SQLite file: failure proves process-local
  // session loss, not a secret rotation or replacement database.
  assert.equal((await client.request('/api/admin/auth/session')).data.authenticated, false)
  assert.equal((await client.request('/api/admin/feedbacks')).response.status, 401)
  assert.equal((await client.post('/api/admin/login', { password })).response.status, 200)
  assert.equal((await client.request('/api/admin/feedbacks')).response.status, 200)
  assert.equal((await client.post('/api/admin/auth/logout', {})).response.status, 200)
  assert.equal((await client.request('/api/admin/feedbacks')).response.status, 401)
})

test('T-23 supported PM2 roles use one backend instance', () => {
  const require = createRequire(projectRoot + '/package.json')
  const file = require.resolve(projectRoot + '/ecosystem.prod.config.js')
  const original = process.env.INSTANCE_ROLE
  try {
    for (const role of ['demo', 'formal']) {
      process.env.INSTANCE_ROLE = role
      delete require.cache[file]
      const config = require(file)
      assert.equal(config.apps.find((app: { name: string }) => app.name === `anonyproof-${role}-backend`).instances, 1)
    }
  } finally {
    if (original === undefined) delete process.env.INSTANCE_ROLE
    else process.env.INSTANCE_ROLE = original
    delete require.cache[file]
  }
})
