import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client, startBackend, type TestService } from './helpers'

function recoveryHash(service: TestService, deviceId: string) {
  const db = service.openDb()
  try {
    return (db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id = ?')
      .get(deviceId) as { recovery_hash: string }).recovery_hash
  } finally { db.close() }
}

function mismatchingCode(code: string) {
  const normalized = code.replace(/-/g, '')
  return (normalized[0] === 'F' ? 'E' : 'F') + normalized.slice(1)
}

async function submitFixture(client: Client, deviceId: string) {
  const submitted = await client.post('/api/feedback', {
    category: 'report', originalContent: 'synthetic T-21 saved-credential record',
    encryptedContent: 'fixture-cipher', deviceId,
  })
  assert.equal(submitted.response.status, 200)
  return submitted.data.id as string
}

async function recoverSavedRecord(service: TestService, code: string, deviceId: string, recordId: string) {
  // A distinct Client has no Cookie or installation key from the issuing browser.
  const fresh = new Client(service)
  const recovered = await fresh.post('/api/identity/recover', { recoveryCode: code })
  assert.equal(recovered.response.status, 200)
  assert.equal(recovered.data.deviceId, deviceId)
  assert.ok(recovered.data.recoveryCode === code, 'Recovery returns the previously saved code')
  const records = await fresh.request(`/api/feedback/device/${deviceId}`)
  assert.equal(records.response.status, 200)
  assert.ok(records.data.feedbacks.some((record: { id: string }) => record.id === recordId))
}

for (const credential of ['Cookie', 'installation key'] as const) {
  for (const localCode of ['missing', 'mismatching'] as const) {
    test(`T-21: restart with valid ${credential} and ${localCode} code preserves R1 and its records`, async t => {
      const key = randomBytes(32).toString('base64')
      const installKey = randomBytes(32).toString('base64url')
      const first = await startBackend({ CONTENT_ENCRYPTION_KEY: key, IDENTITY_RATE_LIMIT_MAX: '100' })
      t.after(first.stop)
      const owner = new Client(first)
      const issued = await owner.identity({ headers: { 'X-AnonyProof-Install-Key': installKey } })
      assert.equal(issued.response.status, 200)
      const { deviceId, recoveryCode: savedCode } = issued.data
      assert.ok(savedCode)
      const before = recoveryHash(first, deviceId)
      const recordId = await submitFixture(owner, deviceId)
      await first.stop()

      const restarted = await startBackend({ DATABASE_PATH: first.databasePath,
        CONTENT_ENCRYPTION_KEY: key, IDENTITY_RATE_LIMIT_MAX: '100' })
      t.after(restarted.stop)
      owner.service = restarted
      const continued = credential === 'Cookie' ? owner : new Client(restarted)
      const headers: Record<string, string> = { 'X-AnonyProof-Install-Key': installKey }
      if (localCode === 'mismatching') headers['X-AnonyProof-Recovery-Code'] = mismatchingCode(savedCode)
      const result = await continued.identity({ headers })
      assert.equal(result.response.status, 200)
      assert.equal(result.data.deviceId, deviceId)
      assert.equal(result.data.created, false)
      assert.equal(Object.hasOwn(result.data, 'recoveryCode'), false,
        'The server cannot redisplay an unavailable correct code')
      assert.equal(recoveryHash(restarted, deviceId), before)
      await recoverSavedRecord(restarted, savedCode, deviceId, recordId)
      assert.equal(recoveryHash(restarted, deviceId), before)
    })
  }
}

// This fixture-only preload advances Date.now in the isolated backend process.
// No production configuration, debug HTTP route, or 10-minute real sleep exists.
function testClock() {
  const dir = mkdtempSync(path.join(tmpdir(), 'anonyproof-T21-clock-'))
  const offsetFile = path.join(dir, 'offset.txt')
  const preload = path.join(dir, 'clock.cjs')
  writeFileSync(offsetFile, '0')
  writeFileSync(preload, `const fs = require('node:fs');
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + Number(fs.readFileSync(process.env.T21_FIXTURE_CLOCK_FILE, 'utf8'));
`)
  return {
    env: { NODE_OPTIONS: `--require=${JSON.stringify(preload)}`, T21_FIXTURE_CLOCK_FILE: offsetFile },
    advance: () => writeFileSync(offsetFile, String(11 * 60 * 1000)),
  }
}

for (const credential of ['Cookie', 'installation key'] as const) {
  test(`T-21: expired display cache with valid ${credential} never revokes R1`, async t => {
    const clock = testClock()
    const installKey = randomBytes(32).toString('base64url')
    const service = await startBackend({ ...clock.env, IDENTITY_RATE_LIMIT_MAX: '100' })
    t.after(service.stop)
    const owner = new Client(service)
    const issued = await owner.identity({ headers: { 'X-AnonyProof-Install-Key': installKey } })
    assert.equal(issued.response.status, 200)
    const { deviceId, recoveryCode: savedCode } = issued.data
    const before = recoveryHash(service, deviceId)
    const recordId = await submitFixture(owner, deviceId)
    // Before expiry, a missing local code can still use the short-lived display cache.
    const cached = await owner.identity()
    assert.equal(cached.response.status, 200)
    assert.ok(cached.data.recoveryCode === savedCode)
    clock.advance()
    const continued = credential === 'Cookie' ? owner : new Client(service)
    const expired = await continued.identity({ headers: { 'X-AnonyProof-Install-Key': installKey } })
    assert.equal(expired.response.status, 200)
    assert.equal(expired.data.deviceId, deviceId)
    assert.equal(Object.hasOwn(expired.data, 'recoveryCode'), false)
    assert.equal(recoveryHash(service, deviceId), before)
    // A genuinely matching header remains valid after cache expiry.
    const matched = await continued.identity({ headers: {
      'X-AnonyProof-Install-Key': installKey, 'X-AnonyProof-Recovery-Code': savedCode,
    } })
    assert.equal(matched.response.status, 200)
    assert.ok(matched.data.recoveryCode === savedCode)
    assert.equal(recoveryHash(service, deviceId), before)
    await recoverSavedRecord(service, savedCode, deviceId, recordId)
    assert.equal(recoveryHash(service, deviceId), before)
  })
}

test('T-21: two initializing tabs share one identity and matching codes remain valid', async t => {
  const service = await startBackend({ IDENTITY_RATE_LIMIT_MAX: '100' })
  t.after(service.stop)
  const installKey = randomBytes(32).toString('base64url')
  const tabs = [new Client(service), new Client(service)]
  const issued = await Promise.all(tabs.map(tab => tab.identity({ headers: { 'X-AnonyProof-Install-Key': installKey } })))
  assert.ok(issued.every(result => result.response.status === 200))
  assert.equal(issued[0].data.deviceId, issued[1].data.deviceId)
  assert.ok(issued[0].data.recoveryCode === issued[1].data.recoveryCode)
  const { deviceId, recoveryCode: savedCode } = issued[0].data
  const before = recoveryHash(service, deviceId)
  const matched = await Promise.all(tabs.map(tab => tab.identity({ headers: {
    'X-AnonyProof-Install-Key': installKey, 'X-AnonyProof-Recovery-Code': savedCode,
  } })))
  assert.ok(matched.every(result => result.response.status === 200
    && result.data.deviceId === deviceId && result.data.recoveryCode === savedCode))
  assert.equal(recoveryHash(service, deviceId), before)
  const db = service.openDb()
  try {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as { n: number }).n, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identity_install_keys').get() as { n: number }).n, 1)
  } finally { db.close() }
})
