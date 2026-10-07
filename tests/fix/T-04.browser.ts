// Test-only HTML gateway disables WebCrypto subtle before hydration. Browser
// actions use native CUA; the gateway and fault preload are never production.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { cipherFaultFixture } from './T-04.fixture'
import { projectRoot } from './helpers'

async function main() {
  const port = 3018
  const nextPort = 3019
  const f = await cipherFaultFixture({ CORS_ORIGINS: `http://127.0.0.1:${port}`, ADMIN_PASSWORD: 'fixture-T04-admin-password-123' })
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(nextPort)], {
    cwd: projectRoot, env: { ...process.env, API_PROXY_TARGET: f.service.baseUrl }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', chunk => { output += chunk.toString() })
  child.stderr?.on('data', chunk => { output += chunk.toString() })
  const network: unknown[] = []
  const gateway = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string' && !['host', 'connection', 'content-length', 'accept-encoding'].includes(name)) headers[name] = value
      }
      const response = await fetch(`http://127.0.0.1:${nextPort}${req.url}`, {
        method: req.method, headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks),
      })
      let bytes = Buffer.from(await response.arrayBuffer())
      response.headers.forEach((value, name) => { if (!['content-length', 'content-encoding', 'transfer-encoding', 'set-cookie'].includes(name)) res.setHeader(name, value) })
      res.setHeader('Set-Cookie', response.headers.getSetCookie())
      if (response.headers.get('content-type')?.includes('text/html')) {
        const html = bytes.toString().replace('<head>', `<head><meta name="fixture-webcrypto-unavailable" content="pending"><script>
          Object.defineProperty(window.crypto,'subtle',{value:undefined,configurable:true});
          document.querySelector('meta[name="fixture-webcrypto-unavailable"]').content=String(!window.crypto.subtle);
          </script>`)
        bytes = Buffer.from(html)
      }
      if (req.url) {
        network.push({ method: req.method, path: req.url.split('?')[0], status: response.status })
        writeFileSync(path.join(projectRoot, 'audit/execution-results/T-04-browser-network.json'), JSON.stringify(network, null, 2) + '\n')
      }
      res.writeHead(response.status).end(bytes)
    } catch { res.writeHead(502).end('fixture proxy unavailable') }
  })
  gateway.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(nextPort, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).map(([name,value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n')
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`)
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  await new Promise<void>(resolve => gateway.listen(port, '127.0.0.1', resolve))
  const metadata = { url: `http://127.0.0.1:${port}/anonyproof`, databasePath: f.service.databasePath, control: f.control, fixturePid: process.pid }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-04-browser-fixture.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(JSON.stringify(metadata))
  const exit = new Promise<void>(resolve => child.once('exit', () => resolve()))
  process.once('SIGTERM', async () => {
    await new Promise<void>(resolve => gateway.close(() => resolve()))
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* already stopped */ }
    await exit
    await f.service.stop()
    writeFileSync(path.join(f.service.dir, 'next-browser-output.txt'), output)
    process.exit(0)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
