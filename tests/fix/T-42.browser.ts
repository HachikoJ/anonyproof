// Fixture-only real-browser acceptance. This file never reads a real database/key.
// Run only after releasing port 4000 from the other numbered browser fixtures.
// Start: PATH=/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH \
//   node --import tsx tests/fix/T-42.browser.ts
// Existing production .next must have been built for API_PROXY_TARGET=http://127.0.0.1:4000.
// Optional --build is explicit and must not overlap another fixture's build/start.
// Browser procedure (use real UI for all business mutations):
// 1. Recover synthetic A from private recoveryPath using the recovery UI.
// 2. POST /__fixture/drop-next/feedback; submit a unique synthetic body.
//    GET /__fixture/state must show one committed dropped row and +1 feedback.
//    Retry unchanged in the UI: same keyHash/acceptedId, counts unchanged.
//    Loss sends real success headers, then truncates the committed response body.
// 3. Repeat with user_comment on T42-A-1 and admin_comment after admin login.
//    Each action can be armed only once; subsequent same-action requests forward.
// 4. For reload recovery, reload after a dropped response, re-enter the same
//    draft manually, and retry. No business draft should survive in storage.
//    A changed draft must produce a visible conflict without creating a row;
//    only the explicit UI "另作一次提交" confirmation may create another action.
// 5. Test storage failures in an isolated browser context, not this harness:
//    block pending-key setItem, submit, verify no new network mutation/DB row;
//    restore storage and retry with the original pending action.
// 6. T-23: login, open protected detail, fill comment/status drafts; POST
//    /__fixture/restart-backend, trigger a protected read in the existing tab.
//    Verify 401 clears list/detail/comments/drafts/counts/notifications, then
//    login again. Restart preserves DB, content key and SESSION_SECRET.
// 7. Recover B in a separate context: A's records must remain inaccessible.
// Read-only evidence: fixture state plus databasePath (SQLite counts only).
// SIGTERM/SIGINT stops only owned processes and retains all fixture files.
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, startBackend, projectRoot, type TestService } from './helpers'
import { loadContentEncryption } from '../../server/utils/contentEncryption'

type Action = 'feedback' | 'user_comment' | 'admin_comment'
type RequestEvidence = {
  sequence: number; method: string; route: string; action?: Action; status: number
  keyHash?: string; acceptedId?: string | number; dropped: boolean; databaseCommitted?: boolean
  dropMode?: 'committed-success-body-truncated'
}
const actions: Action[] = ['feedback', 'user_comment', 'admin_comment']
const frontendPort = 3042, edgePort = 3044
const password = 'T42-synthetic-browser-password-123'
const resultDir = path.join(projectRoot, 'audit/execution-results')

async function main() {
  // Refuse to probe or accidentally use a different fixture already on 4000.
  for (const port of [4000, frontendPort, edgePort]) {
    const probe = net.createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', () => reject(new Error(`T-42 fixture requires free loopback port ${port}`)))
      probe.listen(port, '127.0.0.1', resolve)
    })
    await new Promise<void>(resolve => probe.close(() => resolve()))
  }
  // Keep these values in this process only. A restart intentionally preserves
  // the DB/content key/session secret while invalidating the in-memory admin session.
  const contentKey = randomBytes(32).toString('base64')
  const sessionSecret = randomBytes(32).toString('hex')
  const backendEnv = {
    PORT: '4000', ADMIN_PASSWORD: password, NODE_ENV: 'development',
    INSTANCE_ROLE: 'formal', DEMO_MODE: '0', TRUST_PROXY: '0',
    SESSION_SECRET: sessionSecret, CONTENT_ENCRYPTION_KEY: contentKey,
    CORS_ORIGINS: `http://127.0.0.1:${edgePort},http://127.0.0.1:4000`,
  }
  let service: TestService | undefined
  let db: ReturnType<TestService['openDb']> | undefined
  let child: ReturnType<typeof spawn> | undefined
  let childExited: Promise<void> | undefined
  let edge: http.Server | undefined
  let output = '', stopping = false, restarting = false, restartCount = 0
  let restartTask: Promise<void> | undefined
  let fixtureDir = ''
  const requests: RequestEvidence[] = []
  const armed = new Set<Action>(), dropped = new Set<Action>()
  const writeRequests = () => writeFileSync(path.join(resultDir, 'T-42-browser-network.json'), JSON.stringify(requests, null, 2) + '\n')

  async function cleanup() {
    if (stopping) return
    stopping = true
    if (edge) {
      edge.closeAllConnections()
      await new Promise<void>(resolve => edge!.close(() => resolve()))
    }
    if (child?.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* Only this owned group. */ }
      await Promise.race([childExited, delay(2000)])
      if (child.exitCode === null) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ }
        await childExited
      }
    }
    if (fixtureDir) writeFileSync(path.join(fixtureDir, 'next-output-T42.txt'), output, { mode: 0o600 })
    await restartTask
    db?.close(); db = undefined
    await service?.stop()
    writeRequests()
  }
  process.once('SIGTERM', () => { void cleanup().then(() => process.exit(0)) })
  process.once('SIGINT', () => { void cleanup().then(() => process.exit(0)) })

  try {
    service = await startBackend(backendEnv)
    fixtureDir = service.dir
    const databasePath = service.databasePath
    const encryption = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: contentKey } })
    const a = new Client(service), b = new Client(service)
    const ia = (await a.identity()).data, ib = (await b.identity()).data
    const recoveryPath = path.join(fixtureDir, 'T42-synthetic-recovery-codes.json')
    writeFileSync(recoveryPath, JSON.stringify({ a: ia.recoveryCode, b: ib.recoveryCode }) + '\n', { mode: 0o600 })
    db = service.openDb()
    const insert = db.prepare(`INSERT INTO feedbacks(id,category,device_id,created_at,status,original_content,
      original_content_storage_version,encrypted_content,solution,solution_storage_version)
      VALUES(?,?,?,?,?,?,1,'T42-unused-legacy',?,1)`)
    db.transaction(() => {
      for (const [owner, identity] of [['A', ia], ['B', ib]] as const) {
        for (let i = 1; i <= 2; i++) {
          const id = `T42-${owner}-${i}`
          insert.run(id, i === 1 ? 'suggestion' : 'complaint', identity.deviceId,
            1700000000000 + i, 'pending', encryption.encrypt(`T42 synthetic ${owner} feedback ${i} FULL-BODY-END-${owner}-${i}`, `feedbacks:${id}:original_content`),
            encryption.encrypt('', `feedbacks:${id}:solution`))
        }
      }
      const insertComment = db!.prepare('INSERT INTO feedback_comments(feedback_id,commenter_type,content,created_at,content_storage_version) VALUES(?,?,?,?,1)')
      for (let i = 0; i < 3; i++) insertComment.run('T42-A-1', i % 2 ? 'admin' : 'user',
        encryption.encrypt(`T42 synthetic initial comment ${i}`, `feedback_comments:T42-A-1:${i % 2 ? 'admin' : 'user'}:content`), 1700000000100 + i)
      for (const [id, identity] of [['T42-A-1', ia], ['T42-B-1', ib]] as const) {
        const context = `notifications:${id}:user:${identity.deviceId}:comment`
        db!.prepare(`INSERT INTO notifications(recipient_type,recipient_id,feedback_id,type,title,content,created_at,is_read,content_storage_version)
          VALUES('user',?,?,'comment',?,?,?,0,1)`).run(identity.deviceId, id,
          encryption.encrypt('T42 合成线程通知', `${context}:title`),
          encryption.encrypt('T42 synthetic notification', `${context}:content`), Date.now())
      }
    })()
    // Synthetic seeds bypass mutation endpoints, so make public overview match them.
    db.prepare('UPDATE stats SET total_feedbacks=4,encrypted_count=4 WHERE id=1').run()
    const initialCounts = counts()
    const frontendEnv = { ...process.env, API_PROXY_TARGET: service.baseUrl, NODE_ENV: 'production' as const }
    if (process.argv.includes('--build')) {
      const build = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, env: frontendEnv, encoding: 'utf8', timeout: 120000 })
      writeFileSync(path.join(resultDir, 'T-42-browser-build.txt'), (build.stdout || '') + (build.stderr || ''))
      if (build.status !== 0) throw new Error('T-42 fixture production build failed')
    }
    child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'),
      'start', '-H', '127.0.0.1', '-p', String(frontendPort)], {
      cwd: projectRoot, env: frontendEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', c => { output += c.toString() })
    child.stderr?.on('data', c => { output += c.toString() })
    childExited = new Promise<void>(resolve => { child!.once('exit', () => resolve()); child!.once('error', () => resolve()) })
    let ready = false
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`http://127.0.0.1:${frontendPort}/anonyproof`, { signal: AbortSignal.timeout(500) })
        if (response.status === 200) { ready = true; break }
      } catch { /* Observe the same owned process. */ }
      await delay(50)
    }
    if (!ready) throw new Error('T-42 fixture frontend did not start')

    function counts() {
      return Object.fromEntries(['feedbacks', 'feedback_comments', 'notifications', 'request_idempotency'].map(table =>
        [table, (db!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]))
    }
    function state() {
      return { fixtureOnly: true, restartCount, restarting, armed: [...armed], dropped: [...dropped],
        counts: counts(), initialCounts, requests }
    }
    function reply(res: http.ServerResponse, status: number, value: unknown) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    function classify(method: string | undefined, pathname: string): Action | undefined {
      if (method !== 'POST') return undefined
      if (pathname === '/anonyproof/api/feedback') return 'feedback'
      if (/^\/anonyproof\/api\/feedback\/[^/]+\/comments$/.test(pathname)) return 'user_comment'
      if (/^\/anonyproof\/api\/admin\/feedback\/[^/]+\/comments$/.test(pathname)) return 'admin_comment'
      return undefined
    }
    edge = http.createServer((req, res) => {
      const pathname = new URL(req.url || '/', `http://127.0.0.1:${edgePort}`).pathname
      if (pathname.startsWith('/__fixture/')) {
        req.resume() // Control payload is deliberately ignored, never recorded.
        if (req.method === 'GET' && pathname === '/__fixture/state') return reply(res, 200, state())
        const action = pathname.slice('/__fixture/drop-next/'.length) as Action
        if (req.method === 'POST' && pathname.startsWith('/__fixture/drop-next/') && actions.includes(action)) {
          if (dropped.has(action) || armed.has(action)) return reply(res, 409, { error: 'This action can lose a response only once per fixture run.' })
          armed.add(action)
          return reply(res, 200, { armed: action, successOnly: true })
        }
        if (req.method === 'POST' && pathname === '/__fixture/restart-backend') {
          if (restarting || stopping) return reply(res, 409, { error: 'Restart already active or fixture stopping.' })
          restarting = true
          restartTask = (async () => {
            await service!.stop()
            if (stopping) return
            service = await startBackend({ ...backendEnv, DATABASE_PATH: databasePath, LOG_DIR: path.join(fixtureDir, 'logs') })
            if (stopping) { await service.stop(); return }
            restartCount++
            reply(res, 200, { restarted: true, restartCount, sameDatabase: true, sameContentKey: true, sameSessionSecret: true })
          })().catch(() => reply(res, 500, { error: 'Fixture restart failed; inspect private fixture process logs.' }))
            .finally(() => { restarting = false })
          return
        }
        return reply(res, 404, { error: 'Unknown fixture control.' })
      }
      const action = classify(req.method, pathname)
      const headerKey = req.headers['idempotency-key']
      const keyHash = typeof headerKey === 'string' ? createHash('sha256').update(headerKey).digest('hex') : undefined
      const upstream = http.request({ hostname: '127.0.0.1', port: frontendPort,
        path: req.url, method: req.method, headers: req.headers }, incoming => {
        if (!pathname.startsWith('/anonyproof/api/')) {
          res.writeHead(incoming.statusCode || 502, incoming.headers); incoming.pipe(res); return
        }
        const chunks: Buffer[] = []
        incoming.on('data', c => chunks.push(Buffer.from(c)))
        incoming.once('error', () => res.destroy())
        incoming.on('end', () => {
          const body = Buffer.concat(chunks)
          let parsed: any
          try {
            const encoding = incoming.headers['content-encoding']
            const plaintext = encoding === 'gzip' ? gunzipSync(body) : encoding === 'br' ? brotliDecompressSync(body)
              : encoding === 'deflate' ? inflateSync(body) : body
            parsed = JSON.parse(plaintext.toString('utf8'))
          } catch { /* Pass original bytes on ordinary non-JSON errors. */ }
          const acceptedId = action === 'feedback' ? parsed?.id : action ? parsed?.comment?.id : undefined
          const status = incoming.statusCode || 502
          const shouldDrop = Boolean(action && armed.has(action) && keyHash && acceptedId !== undefined && status >= 200 && status < 300)
          let databaseCommitted: boolean | undefined
          if (action && acceptedId !== undefined && status >= 200 && status < 300) {
            databaseCommitted = Boolean(db!.prepare(action === 'feedback' ? 'SELECT 1 FROM feedbacks WHERE id=?'
              : 'SELECT 1 FROM feedback_comments WHERE id=?').get(acceptedId))
          }
          // Route labels omit parameters/query strings. Never log request/response
          // body, Cookie, recovery code, raw Idempotency-Key or deployment secrets.
          const route = action || (pathname.startsWith('/anonyproof/api/admin/') ? 'admin_read_or_other'
            : pathname.startsWith('/anonyproof/api/identity') ? 'identity' : 'public_or_user_read')
          requests.push({ sequence: requests.length + 1, method: req.method || 'GET', route, action,
            status, keyHash, acceptedId, dropped: shouldDrop, databaseCommitted,
            dropMode: shouldDrop && databaseCommitted ? 'committed-success-body-truncated' : undefined })
          writeRequests()
          if (shouldDrop) {
            armed.delete(action!); dropped.add(action!)
            // The upstream response has ended and the independent SQLite handle
            // observed the committed row before the browser loses its response.
            if (!databaseCommitted) return reply(res, 500, { error: 'Fixture refused to drop an uncommitted response.' })
            // Closing before headers permits Chromium to retry a reused socket
            // automatically. Preserve the real success status/content headers,
            // advertise the complete body length, and deliver only its first
            // byte. The browser then sees an interrupted successful body read.
            const truncatedHeaders = { ...incoming.headers, 'content-length': String(body.length) }
            delete truncatedHeaders['transfer-encoding']
            res.writeHead(status, truncatedHeaders)
            res.flushHeaders()
            res.write(body.subarray(0, 1), () => {
              setTimeout(() => res.destroy(), 50)
            })
            return
          }
          res.writeHead(status, incoming.headers); res.end(body)
        })
      })
      upstream.once('error', () => { if (!res.headersSent) reply(res, 502, { error: 'Fixture upstream unavailable.' }); else res.destroy() })
      req.once('aborted', () => upstream.destroy())
      req.pipe(upstream)
    })
    await new Promise<void>((resolve, reject) => { edge!.once('error', reject); edge!.listen(edgePort, '127.0.0.1', resolve) })
    const metadata = { url: `http://127.0.0.1:${edgePort}/anonyproof`, adminUrl: `http://127.0.0.1:${edgePort}/anonyproof/foorpynona`,
      fixturePid: process.pid, databasePath, recoveryPath, devices: { a: ia.deviceId, b: ib.deviceId },
      threads: { a1: 'T42-A-1', a2: 'T42-A-2', b1: 'T42-B-1', b2: 'T42-B-2' }, initialCounts,
      controls: { state: '/__fixture/state', dropNext: '/__fixture/drop-next/{feedback|user_comment|admin_comment}', restart: '/__fixture/restart-backend' },
      fixtureOnly: true, lossSemantics: 'Each action may lose exactly one successful committed response body per run: real success headers plus Content-Length, then one body byte and socket close; all later responses forward normally.' }
    writeFileSync(path.join(resultDir, 'T-42-browser-fixture.json'), JSON.stringify(metadata, null, 2) + '\n')
    writeRequests()
    console.log(JSON.stringify(metadata))
  } catch (error) {
    await cleanup()
    throw error
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
