import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type DatabaseType from 'better-sqlite3'

export const projectRoot = path.resolve(__dirname, '../..')
const requireServer = createRequire(path.join(projectRoot, 'server/package.json'))
const Database = requireServer('better-sqlite3') as typeof DatabaseType

async function freePort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

export async function launchBackend(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anonyproof-fix-'))
  const port = overrides.PORT ? Number(overrides.PORT) : await freePort()
  const databasePath = overrides.DATABASE_PATH?.trim()
    ? path.resolve(projectRoot, overrides.DATABASE_PATH.trim())
    : path.join(dir, 'fixture.db')
  const password = 'fixture-password-' + randomBytes(12).toString('hex')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production', DEMO_MODE: '0', ADMIN_PASSWORD: password,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    // Never inherit or load a real content key into a fixture. Reused DB tests
    // must explicitly pass the same temporary key, as production restore does.
    CONTENT_ENCRYPTION_KEY: randomBytes(32).toString('base64'), DATABASE_PATH: databasePath,
    PORT: String(port), BIND_HOST: '127.0.0.1', TRUST_PROXY: '0',
    CORS_ORIGINS: `http://127.0.0.1:${port}`, LOG_DIR: path.join(dir, 'logs'),
    ...overrides,
  }
  const child = spawn('npm', ['--prefix', 'server', 'run', 'start'], {
    cwd: projectRoot, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk) => { output += chunk.toString() })
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', resolve)
    child.once('error', () => resolve(-1))
  })
  async function stop() {
    if (child.exitCode === null && child.pid) {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already exited. */ }
      await Promise.race([exited, delay(2000, undefined, { ref: false })])
      if (child.exitCode === null) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ }
        await exited
      }
    }
    // Only fixture output; no real environment secrets or production data.
    writeFileSync(path.join(dir, 'process-output.txt'), output)
  }
  return {
    dir, databasePath, password, child, exited, stop,
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => output,
    openDb: () => new Database(databasePath),
  }
}

export async function startBackend(overrides: Record<string, string> = {}) {
  const service = await launchBackend(overrides)
  for (let attempt = 0; attempt < 200; attempt++) {
    if (service.child.exitCode !== null) {
      await service.stop()
      throw new Error(`Fixture backend exited: ${service.output()}`)
    }
    try {
      const response = await fetch(`${service.baseUrl}/health`, { signal: AbortSignal.timeout(500) })
      if (response.status === 200) return service
    } catch { /* Wait for this same live process, never restart it. */ }
    await delay(50)
  }
  await service.stop()
  throw new Error(`Fixture backend startup timed out: ${service.output()}`)
}

export type TestService = Awaited<ReturnType<typeof startBackend>>

export type FixtureRequestInit = RequestInit & { omitOrigin?: boolean }

export class Client {
  private cookies = new Map<string, string>()
  constructor(public service: TestService) {}
  async request(url: string, init: FixtureRequestInit = {}) {
    const { omitOrigin, ...request } = init
    const headers = new Headers(request.headers)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method?.toUpperCase() || '') &&
        !omitOrigin && !headers.has('Origin')) {
      // This fixture acts as an explicitly configured trusted browser client;
      // negative cases must opt out so missing-Origin coverage stays real.
      headers.set('Origin', new URL(this.service.baseUrl).origin)
    }
    if (this.cookies.size) headers.set('Cookie', Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join('; '))
    headers.set('User-Agent', 'AnonyProof-isolated-fixture')
    const response = await fetch(this.service.baseUrl + url, {
      ...request, headers, signal: AbortSignal.timeout(5000),
    })
    for (const value of response.headers.getSetCookie()) {
      const entry = value.split(';', 1)[0]
      const at = entry.indexOf('=')
      this.cookies.set(entry.slice(0, at), entry.slice(at + 1))
    }
    const text = await response.text()
    const data = text && response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(text) : text
    return { response, data }
  }
  post(url: string, body: unknown, method = 'POST') {
    return this.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }
  identity(init: FixtureRequestInit = {}) { return this.request('/api/identity', init) }
  login() { return this.post('/api/admin/auth/login', { password: this.service.password }) }
}
