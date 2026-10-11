import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, projectRoot, startBackend } from './helpers'

async function freePort() {
  const socket = net.createServer()
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const port = (socket.address() as net.AddressInfo).port
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return port
}

function launchFrontend(mode: 'dev' | 'start', port: number, apiTarget: string, evidenceDir: string) {
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'), mode, '-H', '127.0.0.1', '-p', String(port)], {
    cwd: projectRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production', API_PROXY_TARGET: apiTarget, NEXT_TELEMETRY_DISABLED: '1' },
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  const exited = new Promise<void>(resolve => {
    child.once('exit', () => resolve())
    child.once('error', error => { output += String(error); resolve() })
  })
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async ready(url: string) {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (child.exitCode !== null) throw new Error(`Next ${mode} exited: ${output}`)
        try {
          const response = await fetch(`http://127.0.0.1:${port}${url}`, { signal: AbortSignal.timeout(1000) })
          await response.arrayBuffer()
          if (response.status === 200) return
        } catch { /* Wait for this same process. */ }
        await delay(100)
      }
      throw new Error(`Next ${mode} readiness timeout: ${output}`)
    },
    async stop() {
      if (child.exitCode === null && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already stopped. */ }
        await Promise.race([exited, delay(2000, undefined, { ref: false })])
        if (child.exitCode === null) {
          try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already stopped. */ }
          await exited
        }
      }
      writeFileSync(path.join(evidenceDir, `next-${mode}-output.txt`), output)
    },
  }
}

function noStore(result: Awaited<ReturnType<Client['request']>>, status: number) {
  assert.equal(result.response.status, status)
  assert.equal(result.response.headers.get('cache-control'), 'no-store')
  assert.notEqual(result.response.status, 304)
}

async function cacheMatrix(service: Awaited<ReturnType<typeof startBackend>>) {
  const owner = new Client(service)
  const other = new Client(service)
  const anonymous = new Client(service)
  const admin = new Client(service)
  const identity = await owner.identity()
  noStore(identity, 200)
  await other.identity()
  const submitted = await owner.post('/api/feedback', {
    category: 'report', deviceId: identity.data.deviceId,
    originalContent: 'synthetic private cache fixture', encryptedContent: 'fixture-cipher',
  })
  noStore(submitted, 200)
  const id = submitted.data.id
  noStore(await owner.post(`/api/feedback/${id}/comments`, { content: 'synthetic cache comment' }), 200)
  const recordsUrl = `/api/feedback/device/${identity.data.deviceId}`
  const records = await owner.request(recordsUrl)
  noStore(records, 200)
  const etag = records.response.headers.get('etag')
  assert.ok(etag, 'The real JSON response provides an ETag to exercise conditional requests')
  noStore(await owner.request(recordsUrl, { headers: { 'If-None-Match': etag } }), 200)
  noStore(await other.request(recordsUrl, { headers: { 'If-None-Match': etag } }), 401)
  noStore(await anonymous.request(recordsUrl, { headers: { 'If-None-Match': etag } }), 401)
  noStore(await owner.request(`/api/feedback/${id}/comments`, { headers: { 'If-Modified-Since': new Date(Date.now() + 86400000).toUTCString() } }), 200)
  noStore(await other.request(`/api/feedback/${id}/comments`, { headers: { 'If-None-Match': etag } }), 401)
  noStore(await owner.request(`/api/notifications?recipientType=user&recipientId=${identity.data.deviceId}`), 200)
  noStore(await owner.request(`/api/notifications/unread-count?recipientType=user&recipientId=${identity.data.deviceId}`), 200)
  noStore(await other.request(`/api/notifications?recipientType=user&recipientId=${identity.data.deviceId}`), 403)
  noStore(await anonymous.request('/api/notifications'), 400)
  noStore(await anonymous.request('/api/admin/auth/session'), 200)
  noStore(await anonymous.request('/api/admin/feedbacks'), 401)
  noStore(await admin.login(), 200)
  noStore(await admin.request('/api/admin/feedbacks'), 200)
  noStore(await admin.request(`/api/admin/feedback/${id}`), 200)
  noStore(await admin.request('/api/admin/logs'), 200)
  noStore(await admin.request('/api/admin/access/stats'), 200)
  noStore(await admin.request('/api/notifications?recipientType=admin&recipientId=admin'), 200)
  noStore(await owner.request('/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(service.baseUrl).origin }, body: '{',
  }), 400)
  const publicStats = await anonymous.request('/api/stats')
  assert.equal(publicStats.response.status, 200)
  assert.notEqual(publicStats.response.headers.get('cache-control'), 'no-store')
}

test('T-20: private responses and authorization errors never reuse a conditional cached body', async t => {
  const service = await startBackend()
  t.after(service.stop)
  await cacheMatrix(service)
})

test('T-20: actual Next rewrite preserves no-store while production static chunks retain caching', { timeout: 120000 }, async t => {
  const devPort = await freePort()
  const service = await startBackend({ CORS_ORIGINS: `http://127.0.0.1:${devPort}` })
  t.after(service.stop)
  const dev = launchFrontend('dev', devPort, service.baseUrl, service.dir)
  t.after(dev.stop)
  await dev.ready('/anonyproof/api/admin/session')
  await cacheMatrix({ ...service, baseUrl: dev.baseUrl + '/anonyproof' })
  // CI builds before repair tests. An absent production build is a failure,
  // rather than a skipped cache assertion.
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, '.next/build-manifest.json'), 'utf8'))
  assert.ok(manifest.rootMainFiles?.length)
  const staticUrl = `/anonyproof/_next/${manifest.rootMainFiles[0]}`
  const production = launchFrontend('start', await freePort(), service.baseUrl, service.dir)
  t.after(production.stop)
  await production.ready(staticUrl)
  const response = await fetch(production.baseUrl + staticUrl, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') || '', /public/)
  assert.match(response.headers.get('cache-control') || '', /max-age=31536000/)
  assert.match(response.headers.get('cache-control') || '', /immutable/)
  assert.ok((await response.arrayBuffer()).byteLength > 0)
})
