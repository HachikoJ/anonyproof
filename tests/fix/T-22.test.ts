import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import { ExpiringMap, ExpiringMapCapacityError } from '../../server/utils/expiringMap'

function fixture<V>(expiresAt: (value: V) => number, maxEntries = 2, onCapacity: 'reject' | 'evict-oldest' = 'reject') {
  let now = 0
  let tick: (() => void) | undefined
  let unrefCount = 0
  let closeCount = 0
  let interval: number | undefined
  const map = new ExpiringMap<string, V>({
    expiresAt,
    maxEntries,
    onCapacity,
    now: () => now,
    scheduleCleanup: (callback, ms) => {
      tick = callback
      interval = ms
      return { unref: () => { unrefCount++ }, close: () => { tick = undefined; closeCount++ } }
    },
  })
  return {
    map,
    time: (value: number) => { now = value },
    tick: () => { assert.ok(tick, 'cleanup timer is active'); tick() },
    timer: () => ({ interval, unrefCount, closeCount, active: !!tick }),
  }
}

test('T-22 timer frees expired entries without any later lookup and uses unref/60s', () => {
  const f = fixture<number>(value => value)
  f.map.set('a', 10).set('b', 11)
  assert.equal(f.map.size, 2)
  f.time(10)
  f.tick()
  assert.equal(f.map.size, 1)
  f.time(11)
  f.tick()
  assert.equal(f.map.size, 0)
  assert.deepEqual(f.timer(), { interval: 60_000, unrefCount: 1, closeCount: 0, active: true })
  f.map.close()
})

test('T-22 expiry boundary is inclusive and expired gets discard the entry', () => {
  const f = fixture<number>(value => value)
  f.map.set('a', 100)
  f.time(99)
  assert.equal(f.map.get('a'), 100)
  f.time(100)
  assert.equal(f.map.get('a'), undefined)
  assert.equal(f.map.size, 0)
  f.map.set('a', 100)
  assert.equal(f.map.size, 0)
  f.map.close()
})

test('T-22 session expiry remains exactly 8h, attempts 15min and display codes 10min', () => {
  const sessions = fixture<number>(value => value)
  const attempts = fixture<{ count: number; resetAt: number }>(value => value.resetAt)
  const codes = fixture<{ code: string; expiresAt: number }>(value => value.expiresAt)
  const cases = [
    { fixture: sessions, set: () => sessions.map.set('id', 8 * 60 * 60_000), ttl: 8 * 60 * 60_000 },
    { fixture: attempts, set: () => attempts.map.set('id', { count: 5, resetAt: 15 * 60_000 }), ttl: 15 * 60_000 },
    { fixture: codes, set: () => codes.map.set('id', { code: 'synthetic-display-only', expiresAt: 10 * 60_000 }), ttl: 10 * 60_000 },
  ]
  for (const item of cases) {
    item.set()
    item.fixture.time(item.ttl - 1)
    assert.notEqual(item.fixture.map.get('id'), undefined)
    item.fixture.time(item.ttl)
    item.fixture.tick()
    assert.equal(item.fixture.map.size, 0)
    item.fixture.map.close()
  }
})

test('T-22 full session storage rejects a new entry without displacing valid sessions', () => {
  const f = fixture<number>(value => value)
  f.map.set('valid-a', 100).set('valid-b', 100)
  assert.throws(() => f.map.set('secret-new-session', 100), error => {
    assert.ok(error instanceof ExpiringMapCapacityError)
    assert.equal(error.code, 'EXPIRING_MAP_CAPACITY')
    assert.doesNotMatch(error.message, /secret-new-session|100/)
    return true
  })
  assert.equal(f.map.size, 2)
  assert.equal(f.map.get('valid-a'), 100)
  assert.equal(f.map.get('valid-b'), 100)
  assert.equal(f.map.get('secret-new-session'), undefined)
  f.map.set('valid-a', 200)
  assert.equal(f.map.size, 2)
  assert.equal(f.map.get('valid-a'), 200)
  f.map.close()
})

test('T-22 full source-attempt storage does not discard valid lockouts', () => {
  const f = fixture<{ count: number; resetAt: number }>(value => value.resetAt)
  const locked = { count: 5, resetAt: 100 }
  f.map.set('source-a', locked).set('source-b', locked)
  assert.throws(() => f.map.set('new-source', { count: 1, resetAt: 100 }), ExpiringMapCapacityError)
  assert.equal(f.map.get('source-a'), locked)
  assert.equal(f.map.get('source-b'), locked)
  assert.equal(f.map.get('new-source'), undefined)
  f.map.close()
})

test('T-22 capacity is recovered from expired entries before rejection or eviction', () => {
  for (const policy of ['reject', 'evict-oldest'] as const) {
    const f = fixture<number>(value => value, 2, policy)
    f.map.set('valid', 100).set('expired', 10)
    f.time(10)
    f.map.set('new', 100)
    assert.equal(f.map.size, 2)
    assert.equal(f.map.get('valid'), 100)
    assert.equal(f.map.get('new'), 100)
    assert.equal(f.map.get('expired'), undefined)
    f.map.close()
  }
})

test('T-22 code display capacity evicts the oldest successful set deterministically', () => {
  const f = fixture<{ code: string; expiresAt: number }>(value => value.expiresAt, 2, 'evict-oldest')
  f.map.set('a', { code: 'A', expiresAt: 100 }).set('b', { code: 'B', expiresAt: 100 })
  f.map.get('a') // A read does not extend TTL or change insertion age.
  f.map.set('a', { code: 'A-updated', expiresAt: 100 })
  f.map.set('c', { code: 'C', expiresAt: 100 })
  assert.equal(f.map.get('b'), undefined)
  assert.equal(f.map.get('a')?.code, 'A-updated')
  assert.equal(f.map.get('c')?.code, 'C')
  assert.equal(f.map.size, 2)
  f.map.close()
})

test('T-22 logout delete is immediate and close cancels cleanup once', () => {
  const f = fixture<number>(value => value)
  f.map.set('logout-session', 100)
  assert.equal(f.map.delete('logout-session'), true)
  assert.equal(f.map.delete('logout-session'), false)
  assert.equal(f.map.get('logout-session'), undefined)
  f.map.close()
  f.map.close()
  assert.deepEqual(f.timer(), { interval: 60_000, unrefCount: 1, closeCount: 1, active: false })
})

test('T-22 invalid capacity/expiry reject without corrupting valid entries', () => {
  for (const cap of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => new ExpiringMap({ maxEntries: cap, expiresAt: (value: number) => value }), RangeError)
  }
  const f = fixture<number>(value => value)
  f.map.set('a', 100)
  for (const expiry of [Infinity, -Infinity, NaN]) assert.throws(() => f.map.set('a', expiry), RangeError)
  assert.equal(f.map.get('a'), 100)
  f.map.close()
})

test('T-22 real cleanup timer is unrefed so an otherwise idle process exits', () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const moduleFile = path.join(repo, 'server/utils/expiringMap.ts')
  const source = `const { ExpiringMap } = require(${JSON.stringify(moduleFile)}); new ExpiringMap({ maxEntries: 1, expiresAt: v => v });`
  const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', source], { cwd: repo, timeout: 5000, encoding: 'utf8' })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
})

test('T-22 configured 1000 sessions and 10000 attempt/code bounds hold under a full fill', () => {
  const sessions = fixture<number>(value => value, 1000)
  for (let n = 0; n < 1000; n++) sessions.map.set(`session-${n}`, 100)
  assert.throws(() => sessions.map.set('overflow', 100), ExpiringMapCapacityError)
  assert.equal(sessions.map.size, 1000)
  assert.equal(sessions.map.get('session-0'), 100)
  assert.equal(sessions.map.get('session-999'), 100)
  sessions.map.close()

  const attempts = fixture<{ count: number; resetAt: number }>(value => value.resetAt, 10000)
  for (let n = 0; n < 10000; n++) attempts.map.set(`source-${n}`, { count: 5, resetAt: 100 })
  assert.throws(() => attempts.map.set('overflow', { count: 1, resetAt: 100 }), ExpiringMapCapacityError)
  assert.equal(attempts.map.size, 10000)
  assert.equal(attempts.map.get('source-0')?.count, 5)
  assert.equal(attempts.map.get('source-9999')?.count, 5)
  attempts.map.close()

  const codes = fixture<{ code: string; expiresAt: number }>(value => value.expiresAt, 10000, 'evict-oldest')
  for (let n = 0; n < 10000; n++) codes.map.set(`identity-${n}`, { code: `synthetic-${n}`, expiresAt: 100 })
  codes.map.set('latest', { code: 'synthetic-latest', expiresAt: 100 })
  assert.equal(codes.map.size, 10000)
  assert.equal(codes.map.get('identity-0'), undefined)
  assert.equal(codes.map.get('identity-1')?.code, 'synthetic-1')
  assert.equal(codes.map.get('latest')?.code, 'synthetic-latest')
  codes.map.close()
})
