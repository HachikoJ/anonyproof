// Native-browser acceptance harness. Fixed credentials are fixture-only; it
// always creates a fresh synthetic DB/key and never reads deployment secrets.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { startBackend, projectRoot } from './helpers'

async function main() {
  const port = 3020
  const key = randomBytes(32).toString('base64')
  const service = await startBackend({ CORS_ORIGINS: `http://127.0.0.1:${port}`,
    CONTENT_ENCRYPTION_KEY: key, ADMIN_PASSWORD: 'fixture-T15-admin-password-123' })
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: projectRoot, env: { ...process.env, API_PROXY_TARGET: service.baseUrl }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', chunk => { output += chunk.toString() })
  child.stderr?.on('data', chunk => { output += chunk.toString() })
  const metadata = { url: `http://127.0.0.1:${port}/anonyproof`, databasePath: service.databasePath, fixturePid: process.pid }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-15-browser-fixture.json'), JSON.stringify(metadata, null, 2) + '\n')
  // Store the synthetic content key separately; never put it in the DB metadata.
  writeFileSync(path.join(service.dir, 'content-key.fixture'), key, { mode: 0o600 })
  console.log(JSON.stringify(metadata))
  const exit = new Promise<void>(resolve => child.once('exit', () => resolve()))
  process.once('SIGTERM', async () => {
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
    await exit
    writeFileSync(path.join(service.dir, 'next-browser-output.txt'), output)
    await service.stop()
    process.exit(0)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
