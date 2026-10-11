import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { startBackend, projectRoot } from './helpers'

async function main() {
  const frontendPort = 3024
  const edgePort = 3026
  const key = randomBytes(32).toString('base64')
  const options = { CORS_ORIGINS: `http://127.0.0.1:${edgePort},http://localhost:${edgePort}`,
    CONTENT_ENCRYPTION_KEY: key, ADMIN_PASSWORD: 'fixture-T21-admin-password-123',
    IDENTITY_RATE_LIMIT_MAX: '100', NODE_ENV: 'development' }
  let service = await startBackend(options)
  const backendPort = new URL(service.baseUrl).port
  writeFileSync(path.join(service.dir, 'content-key.fixture'), key, { mode: 0o600 })
  const frontendEnv = { ...process.env, API_PROXY_TARGET: service.baseUrl, NODE_ENV: 'production' as const }
  const build = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, env: frontendEnv,
    encoding: 'utf8', timeout: 120000 })
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-21-browser-build.txt'), (build.stdout || '') + (build.stderr || ''))
  if (build.status !== 0) { await service.stop(); throw new Error('T-21 fixture production build failed') }
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'),
    'start', '-H', '127.0.0.1', '-p', String(frontendPort)], {
    cwd: projectRoot, env: frontendEnv,
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', c => { output += c.toString() })
  child.stderr?.on('data', c => { output += c.toString() })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  const requestPaths: string[] = []
  const edge = http.createServer((req, res) => {
    requestPaths.push(req.url || '/')
    if (req.url === '/__fixture/t21') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(`<!doctype html><html lang="zh-CN"><title>T-21 合成测试控制</title>
<h1>仅用于此隔离浏览器测试</h1><button id="clear">仅清除恢复码</button>
<button id="wrong">设为错误本地恢复码</button><p id="result"></p>
<a href="/anonyproof">返回测试应用</a><script>
document.getElementById('clear').onclick=()=>{localStorage.removeItem('anonyproof_recovery_code');document.getElementById('result').textContent='恢复码已清除；身份和安装密钥保留'};
document.getElementById('wrong').onclick=()=>{const c=localStorage.getItem('anonyproof_recovery_code')||'FFFFFFFFFFFFFFFFFFFF';localStorage.setItem('anonyproof_recovery_code',(c[0]==='F'?'E':'F')+c.slice(1));document.getElementById('result').textContent='已设置错误本地码；身份和安装密钥保留'};
</script></html>`)
      return
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: frontendPort,
      path: req.url, method: req.method, headers: req.headers }, incoming => {
      res.writeHead(incoming.statusCode || 502, incoming.headers); incoming.pipe(res)
    })
    upstream.once('error', () => { res.writeHead(502); res.end('fixture upstream unavailable') })
    req.pipe(upstream)
  })
  await new Promise<void>(resolve => edge.listen(edgePort, '127.0.0.1', resolve))
  const metadata = { url: `http://127.0.0.1:${edgePort}/anonyproof`,
    controlsUrl: `http://127.0.0.1:${edgePort}/__fixture/t21`,
    databasePath: service.databasePath, contentKeyPath: path.join(service.dir, 'content-key.fixture'),
    fixturePid: process.pid, backendPort, fixtureOnly: true }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-21-browser-fixture.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(JSON.stringify(metadata))
  // This stdin command only restarts the synthetic backend. Test controls are
  // served only by this loopback harness, never by the production application.
  let restarting = false
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async text => {
    if (String(text).trim() !== 'restart' || restarting) return
    restarting = true
    try {
      const databasePath = service.databasePath
      await service.stop()
      service = await startBackend({ ...options, DATABASE_PATH: databasePath, PORT: backendPort })
      console.log('T-21 synthetic backend restarted; display cache empty')
    } finally { restarting = false }
  })
  process.once('SIGTERM', async () => {
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* exited */ }
    await exited
    edge.closeAllConnections()
    await new Promise<void>(resolve => edge.close(() => resolve()))
    writeFileSync(path.join(projectRoot, 'audit/execution-results/T-21-browser-request-paths.json'), JSON.stringify(requestPaths, null, 2) + '\n')
    writeFileSync(path.join(path.dirname(metadata.databasePath), 'next-output.txt'), output)
    await service.stop()
    process.exit(0)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
