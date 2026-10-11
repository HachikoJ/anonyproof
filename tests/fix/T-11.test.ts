import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnSync } from 'node:child_process'
import { projectRoot, startBackend } from './helpers'
import {
  cleanupRawLogBatch, countExpiredRawLogs, scheduleRawLogRetention,
  RAW_LOG_RETENTION_MS, LOG_RETENTION_INTERVAL_MS, LOG_RETENTION_BATCH_SIZE,
} from '../../server/utils/logRetention'

const Database = createRequire(path.join(projectRoot, 'server/package.json'))('better-sqlite3') as typeof import('better-sqlite3')
const fixtureNow = Date.parse('2026-10-08T12:00:00.000Z')

function rawFixture() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE access_logs (id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE INDEX idx_access_logs_created_at ON access_logs(created_at);
    CREATE TABLE rate_limit_logs (id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE INDEX idx_rate_limit_logs_created_at ON rate_limit_logs(created_at);
    CREATE TABLE access_stats (date TEXT PRIMARY KEY, total_visits INTEGER);
    INSERT INTO access_stats VALUES ('2026-09-01', 9876);
    CREATE TABLE ip_blacklist (ip TEXT PRIMARY KEY, expires_at INTEGER);
    INSERT INTO ip_blacklist VALUES ('192.0.2.111', NULL), ('192.0.2.112', 1);`)
  return db
}

function fakeTimers() {
  const queue = new Map<NodeJS.Timeout, { callback: () => void; delayMs: number }>()
  let unrefs = 0
  const schedule = (callback: () => void, delayMs: number) => {
    const handle = { unref() { unrefs++ } } as unknown as NodeJS.Timeout
    queue.set(handle, { callback, delayMs })
    return handle
  }
  const cancel = (handle: NodeJS.Timeout) => { queue.delete(handle) }
  return {
    schedule, cancel, queue,
    unrefs: () => unrefs,
    step() {
      const [handle, job] = queue.entries().next().value!
      queue.delete(handle)
      job.callback()
      return job.delayMs
    },
  }
}

test('T-11: exact seven-day boundary, both raw tables, idempotence and aggregates/blacklists preserved', (t) => {
  const db = rawFixture()
  t.after(() => db.close())
  const cutoff = fixtureNow - RAW_LOG_RETENTION_MS
  for (const table of ['access_logs', 'rate_limit_logs']) {
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?)`)
    insert.run(1, cutoff - 1)
    insert.run(2, cutoff)
    insert.run(3, cutoff + 1)
    insert.run(4, fixtureNow)
  }
  const aggregates = db.prepare('SELECT * FROM access_stats').all()
  const blacklists = db.prepare('SELECT * FROM ip_blacklist').all()
  assert.deepEqual(countExpiredRawLogs(db, fixtureNow), { accessLogs: 1, rateLimitLogs: 1 })
  assert.deepEqual(cleanupRawLogBatch(db, fixtureNow), { accessLogs: 1, rateLimitLogs: 1 })
  assert.deepEqual(cleanupRawLogBatch(db, fixtureNow), { accessLogs: 0, rateLimitLogs: 0 })
  for (const table of ['access_logs', 'rate_limit_logs']) {
    assert.deepEqual(db.prepare(`SELECT id FROM ${table} ORDER BY id`).all(), [{ id: 2 }, { id: 3 }, { id: 4 }])
  }
  assert.deepEqual(db.prepare('SELECT * FROM access_stats').all(), aggregates)
  assert.deepEqual(db.prepare('SELECT * FROM ip_blacklist').all(), blacklists)
  assert.throws(() => cleanupRawLogBatch(db, NaN), /Invalid/)
  assert.throws(() => cleanupRawLogBatch(db, 1), /Invalid/)
})

test('T-11: bounded yielding batches drain backlog then schedule hourly and close cancels pending work', (t) => {
  const db = rawFixture()
  t.after(() => db.close())
  const backlog = LOG_RETENTION_BATCH_SIZE * 2 + 1
  for (const table of ['access_logs', 'rate_limit_logs']) {
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?)`)
    db.transaction(() => {
      for (let id = 1; id <= backlog; id++) insert.run(id, fixtureNow - RAW_LOG_RETENTION_MS - 1)
    })()
  }
  const timers = fakeTimers()
  const successes: unknown[] = []
  const handle = scheduleRawLogRetention(db, {
    info: (message, metadata) => { successes.push({ message, metadata }) },
    error: () => { assert.fail('Unexpected failure') },
  }, { now: () => fixtureNow, schedule: timers.schedule, cancel: timers.cancel })
  assert.equal(timers.step(), 0)
  assert.deepEqual(countExpiredRawLogs(db, fixtureNow), { accessLogs: backlog - 500, rateLimitLogs: backlog - 500 })
  assert.equal(timers.step(), 0)
  assert.equal(timers.step(), 0)
  assert.equal(timers.step(), 0)
  assert.deepEqual(countExpiredRawLogs(db, fixtureNow), { accessLogs: 0, rateLimitLogs: 0 })
  assert.deepEqual(successes, [{ message: 'Raw log retention completed', metadata: { accessLogs: backlog, rateLimitLogs: backlog } }])
  assert.equal([...timers.queue.values()][0].delayMs, LOG_RETENTION_INTERVAL_MS)
  assert.equal(timers.step(), LOG_RETENTION_INTERVAL_MS)
  assert.equal(successes.length, 1)
  assert.equal(timers.unrefs(), 6)
  handle.close()
  handle.close()
  assert.equal(timers.queue.size, 0)
})

test('T-11: a failed second delete rolls back first; scheduler logs code only and retries', (t) => {
  const db = rawFixture()
  t.after(() => db.close())
  const cutoff = fixtureNow - RAW_LOG_RETENTION_MS - 1
  db.prepare('INSERT INTO access_logs VALUES (1, ?)').run(cutoff)
  db.prepare('INSERT INTO rate_limit_logs VALUES (1, ?)').run(cutoff)
  db.exec(`CREATE TRIGGER reject_retention BEFORE DELETE ON rate_limit_logs
    BEGIN SELECT RAISE(ABORT, 'fixture-sensitive-IP-and-path'); END;`)
  const timers = fakeTimers()
  const errors: unknown[] = []
  const job = scheduleRawLogRetention(db, {
    info: () => {}, error: (message, metadata) => { errors.push({ message, metadata }) },
  }, { now: () => fixtureNow, schedule: timers.schedule, cancel: timers.cancel })
  timers.step()
  assert.deepEqual(countExpiredRawLogs(db, fixtureNow), { accessLogs: 1, rateLimitLogs: 1 })
  assert.deepEqual(errors, [{ message: 'Raw log retention failed; will retry', metadata: { code: 'SQLITE_CONSTRAINT_TRIGGER' } }])
  assert.ok(!JSON.stringify(errors).includes('fixture-sensitive'))
  assert.equal([...timers.queue.values()][0].delayMs, LOG_RETENTION_INTERVAL_MS)
  // This trigger belongs solely to this disposable synthetic database.
  db.exec('DROP TRIGGER reject_retention')
  timers.step()
  timers.step()
  assert.deepEqual(countExpiredRawLogs(db, fixtureNow), { accessLogs: 0, rateLimitLogs: 0 })
  job.close()
})

test('T-11: live process failure is observable without breaking health, restart drains raw backlog and keeps daily totals', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'anonyproof-T-11-'))
  const databasePath = path.join(dir, 'fixture.db')
  // A demo fixture needs no content key; no real database or key is inherited.
  const first = await startBackend({ DATABASE_PATH: databasePath, DEMO_MODE: '1' })
  t.after(first.stop)
  const db = first.openDb()
  t.after(() => { if (db.open) db.close() })
  const now = Date.now()
  const expired = now - RAW_LOG_RETENTION_MS - 1000
  const fresh = now
  const insertAccess = db.prepare(`INSERT INTO access_logs
    (ip, path, method, response_time, is_bot, is_suspicious, created_at)
    VALUES ('192.0.2.1', '/synthetic', 'GET', 7, 1, 1, ?)`)
  insertAccess.run(expired)
  insertAccess.run(fresh)
  db.prepare(`INSERT INTO rate_limit_logs (ip,path,reason,created_at)
    VALUES ('192.0.2.1','/synthetic','fixture',?)`).run(expired)
  db.prepare(`INSERT INTO access_stats (date,total_visits,unique_visitors,bot_visits,suspicious_visits,
    avg_response_time,response_time_total,response_time_count) VALUES ('2020-01-01',4,2,3,1,7,28,4)`).run()
  db.exec(`CREATE TRIGGER reject_retention BEFORE DELETE ON rate_limit_logs
    BEGIN SELECT RAISE(ABORT, 'fixture-sensitive-IP-and-path'); END;`)
  await first.stop()
  const broken = await startBackend({ DATABASE_PATH: databasePath, DEMO_MODE: '1' })
  t.after(broken.stop)
  // A startup cleanup has failed, not the listen or business request.
  const response = await fetch(broken.baseUrl + '/health')
  assert.equal(response.status, 200)
  await response.text()
  const fs = await import('node:fs')
  const logFile = path.join(broken.dir, 'logs', 'error.log')
  let log = ''
  for (let i = 0; i < 100; i++) {
    log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
    if (log.includes('Raw log retention failed')) break
    await delay(10)
  }
  assert.match(log, /Raw log retention failed/)
  assert.match(log, /SQLITE_CONSTRAINT_TRIGGER/)
  assert.ok(!log.includes('fixture-sensitive'))
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE created_at = ?').get(expired) as { n: number }).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM rate_limit_logs').get() as { n: number }).n, 1)
  await broken.stop()
  const daily = db.prepare('SELECT * FROM access_stats ORDER BY date').all()
  db.exec('DROP TRIGGER reject_retention')
  const restarted = await startBackend({ DATABASE_PATH: databasePath, DEMO_MODE: '1' })
  t.after(restarted.stop)
  for (let i = 0; i < 100; i++) {
    if ((db.prepare('SELECT COUNT(*) AS n FROM rate_limit_logs').get() as { n: number }).n === 0) break
    await delay(10)
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE created_at = ?').get(expired) as { n: number }).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE created_at = ?').get(fresh) as { n: number }).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM rate_limit_logs').get() as { n: number }).n, 0)
  assert.deepEqual(db.prepare("SELECT * FROM access_stats WHERE date = '2020-01-01'").all(), daily.filter((row: any) => row.date === '2020-01-01'))
  await restarted.stop()
  // Read the actual production overview query; imports must not start a timer.
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval',
    "console.log(JSON.stringify(require('./server/utils/accessStats.ts').getAccessStatsOverview().total))"], {
    cwd: projectRoot, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_ENV: 'production', INSTANCE_ROLE: 'demo', DEMO_MODE: '1', CONTENT_ENCRYPTION_KEY: '', DATABASE_PATH: databasePath, LOG_DIR: path.join(dir, 'query-logs') },
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const total = JSON.parse(result.stdout.trim())
  const aggregate = db.prepare(`SELECT SUM(total_visits) AS visits, SUM(bot_visits) AS bots,
    SUM(suspicious_visits) AS suspicious, SUM(response_time_total)/SUM(response_time_count) AS avg FROM access_stats`).get() as any
  assert.equal(total.total_visits, aggregate.visits)
  assert.equal(total.bot_visits, aggregate.bots)
  assert.equal(total.suspicious_visits, aggregate.suspicious)
  assert.equal(total.avg_response_time, aggregate.avg)
  assert.equal(total.unique_visitors_window_days, 7)
})
