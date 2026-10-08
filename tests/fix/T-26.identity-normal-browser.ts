// Fresh production frontend + synthetic backend; captures method/path only.
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { startBackend, projectRoot } from './helpers'

async function main() {
  const service = await startBackend({ PORT: '4000', NODE_ENV: 'development',
    CORS_ORIGINS: 'http://127.0.0.1:3026', ADMIN_PASSWORD: 'fixture-T26-admin-password-123' })
  const env = { ...process.env, API_PROXY_TARGET: service.baseUrl, NODE_ENV: 'production' as const }
  const build = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, env, encoding: 'utf8', timeout: 120000 })
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-26-identity-normal-build.txt'), (build.stdout || '') + (build.stderr || ''))
  if (build.status !== 0) { await service.stop(); throw new Error('Production fixture build failed') }
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'),
    'start', '-H', '127.0.0.1', '-p', '3024'], { cwd: projectRoot, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', c => { output += c.toString() })
  child.stderr?.on('data', c => { output += c.toString() })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  const requests: { method: string; path: string; status?: number }[] = []
  const edge = http.createServer((req, res) => {
    const record = { method: req.method || 'GET', path: req.url || '/', status: undefined as number | undefined }
    requests.push(record)
    const upstream = http.request({ hostname: '127.0.0.1', port: 3024, path: req.url, method: req.method, headers: req.headers }, incoming => {
      record.status = incoming.statusCode
      writeFileSync(path.join(projectRoot, 'audit/execution-results/T-26-identity-normal-network.json'), JSON.stringify(requests, null, 2) + '\n')
      res.writeHead(incoming.statusCode || 502, incoming.headers); incoming.pipe(res)
    })
    upstream.once('error', () => { res.writeHead(502); res.end('fixture upstream unavailable') })
    req.pipe(upstream)
  })
  await new Promise<void>(resolve => edge.listen(3026, '127.0.0.1', resolve))
  const metadata = { url: 'http://127.0.0.1:3026/anonyproof', databasePath: service.databasePath, fixturePid: process.pid, fixtureOnly: true }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-26-identity-normal-fixture.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(JSON.stringify(metadata))
  process.once('SIGTERM', async () => {
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* exited */ }
    await exited
    edge.closeAllConnections(); await new Promise<void>(resolve => edge.close(() => resolve()))
    writeFileSync(path.join(service.dir, 'next-output.txt'), output)
    await service.stop(); process.exit(0)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
