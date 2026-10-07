import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { projectRoot } from './helpers'
import { feedbackSubmitLimiter } from '../../server/middleware/rateLimit'

const requireServer = createRequire(path.join(projectRoot, 'server/package.json'))
const { Address4, Address6, AddressError } = requireServer('ip-address')
const { ipKeyGenerator } = requireServer('express-rate-limit')
const express = requireServer('express') as typeof import('express')

test('T-17: patched IP classifications and malformed inputs preserve address-family boundaries', () => {
  assert.equal(requireServer('ip-address/package.json').version, '10.7.1')
  assert.equal(new Address4('127.0.0.1').isLoopback(), true)
  assert.equal(new Address6('::1').isLoopback(), true)
  assert.equal(new Address6('fe81::1').isLinkLocal(), true)
  assert.equal(new Address6('febf::1').isLinkLocal(), true)
  assert.equal(new Address6('64:ff9b:1::a00:1').isPrivate(), true)
  assert.equal(new Address6('a00::1').isInSubnet(new Address4('10.0.0.0/8')), false)
  assert.equal(new Address4('32.0.0.1').isInSubnet(new Address6('2000::/3')), false)
  assert.equal(new Address6('2001:db8::1').isInSubnet(new Address6('2001:db8::/32')), true)
  assert.equal(Address4.isValid('999.0.0.1'), false)
  assert.equal(Address6.isValid('malformed-ip'), false)
  assert.equal(Address6.isValid('!'.repeat(1024)), false)
  assert.throws(() => new Address6('!'.repeat(1024)), (error: unknown) => {
    assert.ok(error instanceof AddressError)
    assert.ok((error as Error).message.length < 128)
    return true
  })
  assert.equal(ipKeyGenerator('127.0.0.1'), '127.0.0.1')
  assert.equal(ipKeyGenerator('::ffff:127.0.0.1'), '127.0.0.1')
  assert.equal(ipKeyGenerator('2001:db8::1'), ipKeyGenerator('2001:db8::2'))
  assert.notEqual(ipKeyGenerator('2001:db8::1'), ipKeyGenerator('2001:db9::1'))
  assert.equal(ipKeyGenerator('malformed-ip'), 'malformed-ip')
})

test('T-17: existing limiter enforces independent IPv4/IPv6 socket sources on a local route', async (t) => {
  const app = express()
  app.get('/limited', feedbackSubmitLimiter, (req, res) => res.json({ ip: req.ip }))
  app.get('/health', (_req, res) => res.json({ ok: true }))
  t.after(() => {
    feedbackSubmitLimiter.resetKey('127.0.0.1')
    feedbackSubmitLimiter.resetKey('::/56')
  })
  for (const [host, familyPattern] of [['127.0.0.1', /127\.0\.0\.1$/], ['[::1]', /^::1$/]] as const) {
    const server = app.listen({ host: host === '[::1]' ? '::1' : host, port: 0 })
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const port = (server.address() as AddressInfo).port
    const base = `http://${host}:${port}`
    for (let n = 0; n < 10; n++) {
      const response = await fetch(base + '/limited', { signal: AbortSignal.timeout(3000) })
      assert.equal(response.status, 200)
      assert.match((await response.json()).ip, familyPattern)
    }
    const rejected = await fetch(base + '/limited', { signal: AbortSignal.timeout(3000) })
    assert.equal(rejected.status, 429)
    assert.ok(Number(rejected.headers.get('Retry-After')) > 0)
    assert.equal((await rejected.json()).error, '提交过于频繁，请稍后再试')
    assert.equal((await fetch(base + '/health')).status, 200)
  }
})
