import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { Client, projectRoot, startBackend } from './helpers'

type ProxyAddr = { compile: (subnets: string | string[]) => (address: string) => boolean }
const requireRoot = createRequire(path.join(projectRoot, 'package.json'))
const requireServer = createRequire(path.join(projectRoot, 'server/package.json'))

for (const [name, requireProject] of [['root', requireRoot], ['server', requireServer]] as const) {
  test(`T-43: ${name} patched IPv4/IPv6/mapped trust boundaries reject spoofing subnets`, () => {
    assert.equal(requireProject('proxy-addr/package.json').version, '2.0.8')
    const proxyaddr = requireProject('proxy-addr') as ProxyAddr
    for (const [subnets, accepted, rejected] of [
      ['10.0.0.0/8', ['10.1.2.3', '::ffff:10.1.2.3'], ['192.0.2.1', '::ffff:192.0.2.1', '2001:db8::1']],
      ['2001:db8::/32', ['2001:db8::1'], ['2001:db9::1', '10.1.2.3', '::ffff:10.1.2.3']],
      ['::ffff:10.0.0.0/104', ['10.1.2.3', '::ffff:10.1.2.3'], ['192.0.2.1', '::ffff:192.0.2.1', '::a01:203']],
      ['::ffff:10.0.0.0/8', [], ['10.1.2.3', '192.0.2.1', '::ffff:10.1.2.3', '::ffff:192.0.2.1', '::1']],
      ['::/1', ['::1', '2001:db8::1'], ['127.0.0.1', '::ffff:127.0.0.1', '8000::1']],
      [['::/1', '2001:db8::/32'], ['::1', '2001:db8::1'], ['192.0.2.1', '::ffff:192.0.2.1', '8000::1']],
      [['10.0.0.0/8', '2001:db8::/32'], ['10.1.2.3', '::ffff:10.1.2.3', '2001:db8::1'], ['192.0.2.1', '::ffff:192.0.2.1', '2001:db9::1']],
    ] as Array<[string | string[], string[], string[]]>) {
      const trust = proxyaddr.compile(subnets)
      for (const address of accepted) assert.equal(trust(address), true, `${JSON.stringify(subnets)} should trust ${address}`)
      for (const address of rejected) assert.equal(trust(address), false, `${JSON.stringify(subnets)} must reject ${address}`)
      assert.equal(trust('malformed-ip'), false)
    }
  })

  test(`T-43: ${name} real Express proxy-chain matrix distinguishes trusted hops and spoofed headers`, async (t) => {
    const express = requireProject('express') as typeof import('express')
    const cases: Array<{
      trust: boolean | number | string | string[], bind: string, client: string,
      forwarded: string, ip: string, ips: string[], mappedPeer?: boolean,
    }> = [
      { trust: false, bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '127.0.0.1', ips: [] },
      { trust: 1, bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9, 10.1.2.3', ip: '10.1.2.3', ips: ['10.1.2.3'] },
      { trust: 'loopback', bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '198.51.100.9', ips: ['198.51.100.9'] },
      { trust: ['loopback', '10.0.0.0/8'], bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9, 10.1.2.3', ip: '198.51.100.9', ips: ['198.51.100.9', '10.1.2.3'] },
      { trust: ['loopback', '10.0.0.0/8'], bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9, 192.0.2.5', ip: '192.0.2.5', ips: ['192.0.2.5'] },
      { trust: '::ffff:10.0.0.0/8', bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '127.0.0.1', ips: [] },
      { trust: '::/1', bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '127.0.0.1', ips: [] },
      { trust: '::ffff:127.0.0.0/104', bind: '127.0.0.1', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '198.51.100.9', ips: ['198.51.100.9'] },
      { trust: '::1/128', bind: '::1', client: '[::1]', forwarded: '2001:db8::20', ip: '2001:db8::20', ips: ['2001:db8::20'] },
      { trust: '10.0.0.0/8', bind: '::1', client: '[::1]', forwarded: '198.51.100.9', ip: '::1', ips: [] },
      { trust: '::ffff:10.0.0.0/8', bind: '::', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '::ffff:127.0.0.1', ips: [], mappedPeer: true },
      { trust: '::ffff:127.0.0.0/104', bind: '::', client: '127.0.0.1', forwarded: '198.51.100.9', ip: '198.51.100.9', ips: ['198.51.100.9'], mappedPeer: true },
    ]
    for (const entry of cases) {
      const app = express()
      app.set('trust proxy', entry.trust)
      app.get('/probe', (req, res) => res.json({ ip: req.ip, ips: req.ips, peer: req.socket.remoteAddress }))
      const server = app.listen({ host: entry.bind, port: 0, ipv6Only: false })
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve)
        server.once('error', reject)
      })
      t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
      const port = (server.address() as AddressInfo).port
      const response = await fetch(`http://${entry.client}:${port}/probe`, {
        headers: { 'X-Forwarded-For': entry.forwarded }, signal: AbortSignal.timeout(3000),
      })
      assert.equal(response.status, 200)
      const data = await response.json()
      assert.equal(data.ip, entry.ip, JSON.stringify(entry))
      assert.deepEqual(data.ips, entry.ips, JSON.stringify(entry))
      if (entry.mappedPeer) assert.equal(data.peer, '::ffff:127.0.0.1')
    }
  })
}

test('T-43: patched backend still binds feedback access to the authenticated identity', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const owner = new Client(service)
  const stranger = new Client(service)
  const { data: identity } = await owner.identity()
  await stranger.identity()
  const submitted = await owner.post('/api/feedback', {
    deviceId: identity.deviceId, category: 'report', originalContent: 'synthetic proxy dependency fixture', encryptedContent: 'fixture-cipher',
  })
  assert.equal(submitted.response.status, 200)
  const url = `/api/feedback/device/${identity.deviceId}`
  assert.equal((await owner.request(url)).response.status, 200)
  const spoofed = await stranger.request(url, { headers: { 'X-Forwarded-For': '127.0.0.1' } })
  assert.equal(spoofed.response.status, 401)
})
