// Isolated native-browser acceptance harness. No production database/key/network.
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, startBackend, projectRoot } from './helpers'
import { loadContentEncryption } from '../../server/utils/contentEncryption'

async function main() {
  const frontendPort = 3032, edgePort = 3034
  const password = 'T38-synthetic-browser-password-123'
  const key = randomBytes(32).toString('base64')
  const service = await startBackend({ PORT: '4000', ADMIN_PASSWORD: password, NODE_ENV: 'development',
    CONTENT_ENCRYPTION_KEY: key, CORS_ORIGINS: `http://127.0.0.1:${edgePort}` })
  const encryption = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: key } })
  const a = new Client(service), b = new Client(service)
  const ia = (await a.identity()).data, ib = (await b.identity()).data
  const recoveryPath = path.join(service.dir, 'T38-synthetic-recovery-codes.json')
  writeFileSync(recoveryPath, JSON.stringify({ a: ia.recoveryCode, b: ib.recoveryCode }) + '\n', { mode: 0o600 })
  const db = service.openDb()
  const insert = db.prepare(`INSERT INTO feedbacks(id,category,device_id,created_at,status,original_content,
    original_content_storage_version,encrypted_content,solution,solution_storage_version)
    VALUES(?,?,?,?,?,?,1,'T38-unused-legacy',?,1)`)
  db.transaction(() => {
    for (let i = 0; i < 2000; i++) {
      const id = `T38-${String(i).padStart(4, '0')}`
      const body = `${'🧪'.repeat(200)} ${i === 7 ? 'NEEDLE-cross-page' : 'ordinary'} synthetic ${i} FULL-BODY-END-${i}`
      insert.run(id, ['suggestion', 'complaint', 'report'][i % 3], i < 1000 ? ia.deviceId : ib.deviceId,
        1700000000000 + Math.floor(i / 100), ['pending', 'in_progress', 'resolved', 'no_solution'][i % 4],
        encryption.encrypt(body, `feedbacks:${id}:original_content`),
        encryption.encrypt('T38 synthetic existing explanation', `feedbacks:${id}:solution`))
    }
    db.prepare(`INSERT INTO notifications(recipient_type,recipient_id,feedback_id,type,title,content,created_at,is_read)
      VALUES('user',?,'T38-0007','status_update','T38 非当前页通知','T38 synthetic notification',?,0)`).run(ia.deviceId, Date.now())
  })()
  const frontendEnv = { ...process.env, API_PROXY_TARGET: service.baseUrl, NODE_ENV: 'production' as const }
  if (process.argv.includes('--build')) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, env: frontendEnv,
      encoding: 'utf8', timeout: 120000 })
    writeFileSync(path.join(projectRoot, 'audit/execution-results/T-38-browser-build.txt'), (build.stdout || '') + (build.stderr || ''))
    if (build.status !== 0) { db.close(); await service.stop(); throw new Error('T-38 production build failed') }
  }
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'),
    'start', '-H', '127.0.0.1', '-p', String(frontendPort)], {
    cwd: projectRoot, env: frontendEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', c => { output += c.toString() })
  child.stderr?.on('data', c => { output += c.toString() })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  let ready = false
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${frontendPort}/anonyproof`, { signal: AbortSignal.timeout(500) })
      if (response.status === 200) { ready = true; break }
    } catch { /* Observe this same process while it starts. */ }
    await delay(50)
  }
  if (!ready) {
    try { if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGTERM') } catch { /* exited */ }
    await exited
    db.close(); await service.stop()
    throw new Error('T-38 fixture frontend did not start: ' + output)
  }
  const requests: unknown[] = []
  const edge = http.createServer((req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: frontendPort,
      path: req.url, method: req.method, headers: req.headers }, incoming => {
      if (req.url?.startsWith('/anonyproof/api/')) {
        const chunks: Buffer[] = []
        incoming.on('data', c => chunks.push(Buffer.from(c)))
        incoming.on('end', () => {
          const body = Buffer.concat(chunks)
          let parsed: any
          try {
            const encoding = incoming.headers['content-encoding']
            const plaintext = encoding === 'gzip' ? gunzipSync(body) : encoding === 'br' ? brotliDecompressSync(body)
              : encoding === 'deflate' ? inflateSync(body) : body
            parsed = JSON.parse(plaintext.toString('utf8'))
          } catch { /* non-JSON error; forward original response bytes. */ }
          requests.push({ method: req.method, path: req.url, status: incoming.statusCode, bytes: body.length,
            rowCount: parsed?.feedbacks?.length, ids: parsed?.feedbacks?.map((row: any) => row.id),
            counts: parsed?.counts, pagination: parsed?.pagination,
            detailId: parsed?.feedback?.id, detailCodePoints: parsed?.feedback?.original_content ? Array.from(parsed.feedback.original_content).length : undefined })
          writeFileSync(path.join(projectRoot, 'audit/execution-results/T-38-browser-network.json'), JSON.stringify(requests, null, 2) + '\n')
          res.writeHead(incoming.statusCode || 502, incoming.headers); res.end(body)
        })
      } else {
        res.writeHead(incoming.statusCode || 502, incoming.headers); incoming.pipe(res)
      }
    })
    upstream.once('error', () => { res.writeHead(502); res.end('fixture upstream unavailable') })
    req.pipe(upstream)
  })
  await new Promise<void>(resolve => edge.listen(edgePort, '127.0.0.1', resolve))
  const metadata = { url: `http://127.0.0.1:${edgePort}/anonyproof`,
    recoveryPath, devices: { a: ia.deviceId, b: ib.deviceId }, notificationTarget: 'T38-0007', initialCount: 1000, fixturePid: process.pid,
    databasePath: service.databasePath, fixtureOnly: true }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-38-browser-fixture.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(JSON.stringify(metadata))
  process.once('SIGTERM', async () => {
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* exited */ }
    await exited
    edge.closeAllConnections()
    await new Promise<void>(resolve => edge.close(() => resolve()))
    writeFileSync(path.join(service.dir, 'next-output-T38.txt'), output)
    db.close(); await service.stop(); process.exit(0)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
