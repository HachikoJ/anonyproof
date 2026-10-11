import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, startBackend } from './helpers'

async function port() {
  const listener = net.createServer()
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
  const value = (listener.address() as net.AddressInfo).port
  await new Promise<void>(resolve => listener.close(() => resolve()))
  return value
}
async function main() {
  const evidenceTask = process.env.FIX_SMOKE_TASK || 'T-15'
  assert.match(evidenceTask, /^T-\d{2}$/)
  const frontendPort = await port()
  const origin = `http://127.0.0.1:${frontendPort}`
  const backend = await startBackend({ CORS_ORIGINS: origin })
  const env = { ...process.env, API_PROXY_TARGET: backend.baseUrl, PORT: String(frontendPort), BIND_HOST: '127.0.0.1', NODE_ENV: 'production' as const }
  const build = spawnSync('npm', ['run', 'build'], { env, encoding: 'utf8', timeout: 120000 })
  writeFileSync(`audit/execution-results/${evidenceTask}-main-proxy-build.txt`, (build.stdout || '') + (build.stderr || ''))
  if (build.status !== 0) { await backend.stop(); throw new Error('isolated proxy-target build failed') }
  const frontend = spawn('npm', ['run', 'start'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  frontend.stdout.on('data', c => { output += c.toString() })
  frontend.stderr.on('data', c => { output += c.toString() })
  const exit = new Promise(resolve => frontend.once('exit', resolve))
  const base = `http://127.0.0.1:${frontendPort}/anonyproof`
  try {
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).status === 200) break } catch {}
      assert.equal(frontend.exitCode, null)
      await delay(50)
    }
    const assets = new Set<string>()
    for (const page of ['', '/foorpynona', '/access-stats']) {
      const response = await fetch(base + page)
      assert.equal(response.status, 200)
      console.log(`page ${page || '/'}: 200`)
      const html = await response.text()
      for (const match of html.matchAll(/(?:src|href)="([^\"]*\/anonyproof\/_next\/static\/[^\"]+)"/g)) assets.add(match[1])
    }
    assert.ok(assets.size > 0)
    for (const asset of assets) assert.equal((await fetch(`http://127.0.0.1:${frontendPort}${asset}`)).status, 200)
    console.log(`static assets: ${assets.size} returned 200`)
    const proxied = { ...backend, baseUrl: base }
    class FrontendClient extends Client {
      override post(url: string, body: unknown, method = 'POST') {
        return this.request(url, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      }
    }
    const user = new FrontendClient(proxied)
    const admin = new FrontendClient(proxied)
    const identity = await user.identity()
    assert.equal(identity.response.status, 200)
    assert.ok(identity.response.headers.getSetCookie().some(v => v.includes('anonyproof_device_session=')))
    const feedback = await user.post('/api/feedback', { category: 'report', deviceId: identity.data.deviceId, originalContent: 'T15 isolated rewrite fixture', encryptedContent: 'fixture-cipher' })
    assert.equal(feedback.response.status, 200)
    assert.equal((await user.request(`/api/feedback/device/${identity.data.deviceId}`)).data.feedbacks[0].id, feedback.data.id)
    assert.equal((await user.post(`/api/feedback/${feedback.data.id}/comments`, { content: 'T15 isolated proxy comment' })).response.status, 200)
    const login = await admin.login()
    assert.equal(login.response.status, 200)
    assert.ok(login.response.headers.getSetCookie().some(v => v.includes('anonyproof_admin_session=')))
    assert.equal((await admin.request('/api/admin/feedbacks')).data.feedbacks[0].id, feedback.data.id)
    assert.equal((await admin.post(`/api/admin/feedback/${feedback.data.id}/status`, { status: 'resolved', solution: 'T15 rewrite resolution finished' }, 'PUT')).response.status, 200)
    assert.equal((await user.request(`/api/notifications?recipientType=user&recipientId=${identity.data.deviceId}`)).data.notifications.length, 1)
    assert.equal((await admin.request('/api/admin/access/stats')).response.status, 200)
    console.log('API rewrite, user/admin cookies, submission/list/comment/status/notification/access stats: passed')
  } finally {
    if (frontend.pid && frontend.exitCode === null) {
      try { process.kill(-frontend.pid, 'SIGTERM') } catch {}
      await Promise.race([exit, delay(2000, undefined, { ref: false })])
      if (frontend.exitCode === null) { try { process.kill(-frontend.pid, 'SIGKILL') } catch {}; await exit }
    }
    writeFileSync(`audit/execution-results/${evidenceTask}-main-frontend-start.txt`, output)
    await backend.stop()
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
