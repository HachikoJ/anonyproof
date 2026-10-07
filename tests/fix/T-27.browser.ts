// Manual native-browser CORS acceptance; fresh synthetic backend only.
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { startBackend, projectRoot, type TestService } from './helpers'

async function main() {
  let service: TestService
  let gatewayUrl = ''
  const evidence: unknown[] = []
  const record = (item: unknown) => {
    evidence.push(item)
    writeFileSync(path.join(projectRoot, 'audit/execution-results/T-27-browser-network.json'), JSON.stringify(evidence, null, 2) + '\n')
  }
  const page = (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>T-27 synthetic CORS verification</title>
      <h1>T-27 synthetic CORS verification</h1><p>Source: ${req.headers.host}</p>
      <button id="login">Login synthetic fixture</button><button id="read">Read authenticated session</button>
      <pre id="result">Ready</pre><script>
      const output = document.querySelector('#result');
      document.querySelector('#login').onclick = async () => {
        try { const response = await fetch(${JSON.stringify(gatewayUrl + '/api/admin/auth/login')}, {
          method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({password:${JSON.stringify(service?.password)}})});
          const result = await response.json(); output.textContent = 'login: status=' + response.status + ' success=' + result.success;
        } catch (error) { output.textContent = 'login: browser blocked response (' + error.name + ')'; }
      };
      document.querySelector('#read').onclick = async () => {
        try { const response = await fetch(${JSON.stringify(gatewayUrl + '/api/admin/auth/session')}, {credentials:'include'});
          const result = await response.json(); output.textContent = 'read: status=' + response.status + ' authenticated=' + result.authenticated;
        } catch (error) { output.textContent = 'read: browser blocked response (' + error.name + ')'; }
      };</script>`)
  }
  const listen = async (server: http.Server) => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
  }
  const allowedPage = http.createServer(page)
  const deniedPage = http.createServer(page)
  const allowedPort = await listen(allowedPage)
  const deniedPort = await listen(deniedPage)
  const allowedOrigin = `http://127.0.0.1:${allowedPort}`
  service = await startBackend({ NODE_ENV: 'development', CORS_ORIGINS: allowedOrigin })
  const gateway = http.createServer(async (req, res) => {
    if (!['/api/admin/auth/login', '/api/admin/auth/session'].includes(req.url || '')) { res.writeHead(404).end(); return }
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const headers: Record<string, string> = {}
      for (const name of ['origin', 'cookie', 'content-type', 'access-control-request-method', 'access-control-request-headers']) {
        if (typeof req.headers[name] === 'string') headers[name] = req.headers[name] as string
      }
      const response = await fetch(service.baseUrl + req.url, {
        method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks),
      })
      const data = await response.text()
      response.headers.forEach((value, name) => { if (!['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding'].includes(name)) res.setHeader(name, value) })
      res.setHeader('Set-Cookie', response.headers.getSetCookie())
      const authenticated = req.url === '/api/admin/auth/session' ? JSON.parse(data).authenticated : undefined
      record({ method: req.method, path: req.url, origin: req.headers.origin || null,
        cookieSent: Boolean(req.headers.cookie?.includes('anonyproof_admin_session=')),
        status: response.status, allowOrigin: response.headers.get('access-control-allow-origin'), authenticated })
      res.writeHead(response.status).end(data)
    } catch { res.writeHead(500).end('fixture gateway failure') }
  })
  gatewayUrl = `http://127.0.0.1:${await listen(gateway)}`
  const urls = { allowed: allowedOrigin, sameSiteDenied: `http://127.0.0.1:${deniedPort}`, crossSiteDenied: `http://localhost:${deniedPort}` }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-27-browser-urls.json'), JSON.stringify(urls, null, 2) + '\n')
  console.log(JSON.stringify({ ...urls, fixturePid: process.pid }))
  process.once('SIGTERM', async () => {
    await service.stop()
    for (const server of [allowedPage, deniedPage, gateway]) await new Promise<void>(resolve => server.close(() => resolve()))
    process.exit(0)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
