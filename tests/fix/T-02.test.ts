import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, launchBackend, startBackend, projectRoot } from './helpers'

const Database = createRequire(path.join(projectRoot, 'server/package.json'))('better-sqlite3') as typeof import('better-sqlite3')
const key = () => randomBytes(32).toString('base64')
async function denied(overrides: Record<string, string>, expected: RegExp) {
  const service = await launchBackend(overrides)
  try {
    const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(exit, 'timeout')
    assert.notEqual(exit, 0)
    assert.match(service.output(), expected)
    return service
  } finally { await service.stop() }
}

test('T-02 invalid role/mode/path/password/key fails before DB creation', async () => {
  for (const [configuration, expected] of [
    [{ INSTANCE_ROLE: '' }, /INSTANCE_ROLE/],
    [{ INSTANCE_ROLE: 'production' }, /INSTANCE_ROLE/],
    [{ INSTANCE_ROLE: 'formal', DEMO_MODE: '1' }, /DEMO_MODE/],
    [{ INSTANCE_ROLE: 'demo', DEMO_MODE: '0' }, /DEMO_MODE/],
    [{ DEMO_MODE: 'true' }, /DEMO_MODE/],
    [{ DATABASE_PATH: '' }, /DATABASE_PATH/],
    [{ DATABASE_PATH: './relative.db' }, /DATABASE_PATH/],
    [{ ADMIN_PASSWORD: 'demo12345678' }, /ADMIN_PASSWORD/],
    [{ ADMIN_PASSWORD: 'replace_with_a_strong_server_only_password' }, /ADMIN_PASSWORD/],
    [{ ADMIN_PASSWORD: '' }, /ADMIN_PASSWORD/],
    [{ CONTENT_ENCRYPTION_KEY: '' }, /MISSING_KEY/],
    [{ CONTENT_ENCRYPTION_KEY: 'not-a-key' }, /INVALID_BASE64/],
    [{ INSTANCE_ROLE: 'demo', DEMO_MODE: '1', CONTENT_ENCRYPTION_KEY: key() }, /must not receive/],
  ] as [Record<string, string>, RegExp][]) {
    const s = await denied(configuration, expected)
    if (!configuration.DATABASE_PATH) assert.equal(existsSync(s.databasePath), false)
  }
})

test('T-02 unknown nonempty legacy database fails read-only without adoption or schema writes', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'anonyproof-T02-old-')), 'old.db')
  const db = new Database(file)
  db.exec("CREATE TABLE retained_fixture(value TEXT); INSERT INTO retained_fixture VALUES('synthetic legacy');")
  db.close()
  const before = createHash('sha256').update(readFileSync(file)).digest('hex')
  for (const demo of [false, true]) await denied({ DATABASE_PATH: file, DEMO_MODE: demo ? '1' : '0' }, /Unlabelled nonempty/)
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), before)
  const check = new Database(file, { readonly: true })
  try { assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), [{ name: 'retained_fixture' }]) }
  finally { check.close() }
})

test('T-02 persisted role cannot be flipped and a formal key cannot be replaced', async t => {
  const contentKey = key()
  for (const role of ['demo', 'formal'] as const) {
    const first = await startBackend({ DEMO_MODE: role === 'demo' ? '1' : '0',
      CONTENT_ENCRYPTION_KEY: role === 'demo' ? '' : contentKey })
    t.after(first.stop)
    const db = first.openDb()
    assert.equal((db.prepare('SELECT role FROM instance_metadata WHERE id=1').get() as any).role, role)
    const schema = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()
    db.close()
    await denied({ DATABASE_PATH: first.databasePath, DEMO_MODE: role === 'demo' ? '0' : '1' }, /INSTANCE_ROLE mismatch/)
    if (role === 'formal') await denied({ DATABASE_PATH: first.databasePath, CONTENT_ENCRYPTION_KEY: key() }, /DATABASE_KEY_MISMATCH/)
    const after = first.openDb()
    assert.deepEqual(after.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), schema)
    after.close()
    assert.equal((await fetch(first.baseUrl + '/health')).status, 200)
  }
})

test('T-02 valid separate demo/formal instances reject cross-role credentials and formal config hides password', async t => {
  const demo = await startBackend({ DEMO_MODE: '1' }); t.after(demo.stop)
  const formal = await startBackend(); t.after(formal.stop)
  assert.notEqual(demo.databasePath, formal.databasePath)
  const publicClient = new Client(demo), formalClient = new Client(formal)
  const demoIdentity = await publicClient.identity()
  const config = await formalClient.request('/api/demo/config')
  assert.deepEqual(config.data, { success: true, demoMode: false })
  const published = await publicClient.request('/api/demo/config')
  const demoLogin = await publicClient.post('/api/admin/login', { password: published.data.adminPassword })
  assert.equal(demoLogin.response.status, 200)
  const demoCookies = [...demoIdentity.response.headers.getSetCookie(), ...demoLogin.response.headers.getSetCookie()]
    .map(c => c.split(';')[0]).join('; ')
  for (const route of ['/api/admin/feedbacks', `/api/feedback/device/${demoIdentity.data.deviceId}`]) {
    const r = await formalClient.request(route, { headers: { Cookie: demoCookies } })
    assert.equal(r.response.status, 401)
  }
  assert.equal((await formalClient.post('/api/identity/recover', { recoveryCode: demoIdentity.data.recoveryCode })).response.status, 404)
  assert.equal((await formalClient.post('/api/admin/login', { password: published.data.adminPassword })).response.status, 401)
  const own = await formalClient.identity(), login = await formalClient.login()
  assert.equal(login.response.status, 200)
  const cookies = [...own.response.headers.getSetCookie(), ...login.response.headers.getSetCookie()]
    .map(c => c.split(';')[0]).join('; ')
  assert.equal((await new Client(demo).request('/api/admin/feedbacks', { headers: { Cookie: cookies } })).response.status, 401)
  assert.equal((await publicClient.post('/api/identity/recover', { recoveryCode: own.data.recoveryCode })).response.status, 404)
})

test('T-02 PM2 uses explicit role, distinct names and ports, and rejects conflicting ports', () => {
  const script = "const c=require('./ecosystem.prod.config.js');console.log(JSON.stringify(c.apps.map(a=>({name:a.name,port:a.env.PORT,role:a.env.INSTANCE_ROLE,instances:a.instances,cwd:a.cwd}))));"
  for (const role of ['demo', 'formal']) {
    const p = spawnSync(process.execPath, ['-e', script], { cwd: projectRoot, encoding: 'utf8',
      env: { ...process.env, INSTANCE_ROLE: role, FRONTEND_PORT: '', BACKEND_PORT: '' } })
    assert.equal(p.status, 0)
    const apps = JSON.parse(p.stdout)
    assert.deepEqual(apps.map((a: any) => a.name), [`anonyproof-${role}-frontend`, `anonyproof-${role}-backend`])
    assert.deepEqual(apps.map((a: any) => a.port), role === 'demo' ? [3000, 4000] : [3100, 4100])
    assert.ok(apps.every((a: any) => a.role === role && a.instances === 1))
  }
  for (const overrides of [{ INSTANCE_ROLE: '' }, { INSTANCE_ROLE: 'demo', FRONTEND_PORT: '4000' },
    { INSTANCE_ROLE: 'formal', BACKEND_PORT: 'abc' }]) {
    const p = spawnSync(process.execPath, ['-e', script], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, ...overrides } })
    assert.notEqual(p.status, 0)
  }
})
