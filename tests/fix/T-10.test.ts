import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { projectRoot, startBackend } from './helpers'

const Database = createRequire(path.join(projectRoot, 'server/package.json'))('better-sqlite3') as typeof import('better-sqlite3')

function legacyFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'anonyproof-T-10-'))
  const file = path.join(directory, 'legacy.db')
  const db = new Database(file)
  db.exec(`CREATE TABLE access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL,
    user_agent TEXT, path TEXT NOT NULL, method TEXT NOT NULL, status_code INTEGER,
    response_time INTEGER, is_bot BOOLEAN DEFAULT 0, is_suspicious BOOLEAN DEFAULT 0,
    suspicious_reason TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE access_stats (date TEXT PRIMARY KEY, total_visits INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0, bot_visits INTEGER DEFAULT 0,
    suspicious_visits INTEGER DEFAULT 0, avg_response_time INTEGER DEFAULT 0);`)
  const insert = db.prepare(`INSERT INTO access_logs
    (ip,path,method,response_time,is_bot,is_suspicious,created_at) VALUES (?, '/fixture', 'GET', ?, ?, ?, ?)`)
  insert.run('192.0.2.1', 1, 1, 0, Date.parse('2026-10-01T23:59:59.999Z'))
  insert.run('192.0.2.1', 2, 0, 1, Date.parse('2026-10-02T00:00:00.000Z'))
  insert.run('192.0.2.2', null, 0, 1, Date.parse('2026-10-02T00:00:00.000Z'))
  db.close()
  return file
}

function runWriter(file: string, entries: unknown[] = []) {
  const source = `const {recordAccess}=require('./server/middleware/accessStats.ts');
    for(const entry of JSON.parse(process.env.T10_ENTRIES)) recordAccess.immediate(entry);`
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', source], {
    cwd: projectRoot, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: file, LOG_DIR: path.join(path.dirname(file), 'logs'), TZ: 'Pacific/Honolulu', T10_ENTRIES: JSON.stringify(entries) },
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

function assertTotals(file: string) {
  const db = new Database(file)
  try {
    const expected = db.prepare(`SELECT DATE(created_at / 1000, 'unixepoch') AS date,
      COUNT(*) AS total_visits, COUNT(DISTINCT ip) AS unique_visitors,
      SUM(is_bot) AS bot_visits, SUM(is_suspicious) AS suspicious_visits,
      ROUND(COALESCE(AVG(response_time), 0)) AS avg_response_time,
      COALESCE(SUM(response_time), 0) AS response_time_total,
      COUNT(response_time) AS response_time_count
      FROM access_logs GROUP BY date ORDER BY date`).all()
    assert.deepEqual(db.prepare('SELECT * FROM access_stats ORDER BY date').all(), expected)
    return expected
  } finally { db.close() }
}

test('T-10: atomic legacy migration, UTC day boundaries, null averages and restart are exact', () => {
  const file = legacyFixture()
  const base = { ip: '192.0.2.1', userAgent: 'fixture', path: '/fixture', method: 'GET', statusCode: 200,
    responseTime: 7, isBot: false, isSuspicious: true, suspiciousReason: 'fixture', createdAt: Date.parse('2026-10-02T00:00:00.000Z') }
  runWriter(file, [base, { ...base, ip: '192.0.2.3', responseTime: 8, isBot: true }])
  const totals = assertTotals(file)
  runWriter(file)
  assert.deepEqual(assertTotals(file), totals)
  runWriter(file)
  assert.deepEqual(assertTotals(file), totals)
  runWriter(file, [{ ...base, responseTime: 3, createdAt: Date.parse('2026-10-03T00:00:00.000Z') }])
  assertTotals(file)
  const db = new Database(file)
  try {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM access_logs
      WHERE ip = ? AND created_at >= ? AND created_at < ? LIMIT 1`).all('192.0.2.1', 0, Date.now())
    assert.ok(plan.some((row: any) => row.detail.includes('USING COVERING INDEX idx_access_logs_ip_created_at')))
    writeFileSync(path.join(projectRoot, 'audit/execution-results/T-10-query-plan.txt'), JSON.stringify(plan, null, 2) + '\n')
  } finally { db.close() }
})

test('T-10: failed legacy migration rolls back added columns and remains retryable', () => {
  const file = legacyFixture()
  const db = new Database(file)
  db.exec(`CREATE TRIGGER reject_legacy_stats BEFORE INSERT ON access_stats BEGIN SELECT RAISE(ABORT,'fixture migration failure'); END`)
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', "require('./server/middleware/accessStats.ts')"], {
    cwd: projectRoot, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: file, LOG_DIR: path.join(path.dirname(file), 'logs') },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /fixture migration failure/)
  assert.ok(!(db.prepare('PRAGMA table_info(access_stats)').all() as any[]).some(column => column.name === 'response_time_total'))
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_access_logs_ip_created_at'").get(), undefined)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM access_logs').get() as any).n, 3)
  // This trigger is a fault injected solely into this disposable test database.
  db.exec('DROP TRIGGER reject_legacy_stats')
  db.close()
  runWriter(file)
  assertTotals(file)
})

test('T-10: runtime statistics failure preserves responses and atomic log/stat consistency', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const db = service.openDb()
  t.after(() => db.close())
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM access_logs').get() as any).n
  const request = async (userAgent = 'T-10-fixture') => {
    const response = await fetch(service.baseUrl + '/health', { headers: { 'User-Agent': userAgent } })
    assert.equal(response.status, 200)
    await response.text()
  }
  const before = count()
  db.exec(`CREATE TRIGGER reject_stats BEFORE UPDATE ON access_stats BEGIN SELECT RAISE(ABORT,'fixture stats failure'); END`)
  await request()
  await delay(20) // Allow the response finish handler to attempt its faulted transaction.
  assert.equal(count(), before)
  db.exec('DROP TRIGGER reject_stats')
  await request()
  for (let i = 0; i < 100 && count() === before; i++) await delay(5)
  assert.equal(count(), before + 1)
  await request('Googlebot')
  await request('curl/fixture')
  for (let i = 0; i < 100 && count() < before + 3; i++) await delay(5)
  assert.equal((db.prepare("SELECT is_bot FROM access_logs WHERE user_agent = 'Googlebot'").get() as any).is_bot, 1)
  assert.equal((db.prepare("SELECT is_suspicious FROM access_logs WHERE user_agent = 'curl/fixture'").get() as any).is_suspicious, 1)
  assertTotals(service.databasePath)
})
