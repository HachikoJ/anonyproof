// Native-browser CSRF fixture: exact local subdomains, IPv4/IPv6 loopback only.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { startBackend, projectRoot, type TestService } from './helpers'
async function main() {
  let service: TestService
  let gatewayUrl = ''
  const servers: http.Server[] = []
  const evidence: unknown[] = []
  async function dual(handler: http.RequestListener) {
    const ipv6 = http.createServer(handler)
    await new Promise<void>(resolve => ipv6.listen(0,'::1',resolve))
    const port=(ipv6.address() as AddressInfo).port
    const ipv4=http.createServer(handler)
    await new Promise<void>(resolve=>ipv4.listen(port,'127.0.0.1',resolve))
    servers.push(ipv4,ipv6)
    return port
  }
  const page: http.RequestListener = (req,res) => {
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end(`<!doctype html><title>T-26 local subdomain CSRF verification</title>
      <h1>T-26 local subdomain CSRF verification</h1><p>Source: ${req.headers.host}</p>
      <button id="login">Login synthetic fixture</button><button id="read">Read authenticated session</button>
      <button id="attack">Attempt simple POST logout</button><pre id="result">Ready</pre>
      <script>
      const output=document.querySelector('#result');
      document.querySelector('#login').onclick=async()=>{
        try { const response=await fetch(${JSON.stringify(gatewayUrl+'/api/admin/auth/login')},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:${JSON.stringify(service?.password)}})});
          const result=await response.json();output.textContent='login status='+response.status+' success='+result.success;
        }catch(error){output.textContent='login response blocked: '+error.name;}
      };
      document.querySelector('#read').onclick=async()=>{
        try { const response=await fetch(${JSON.stringify(gatewayUrl+'/api/admin/auth/session')},{credentials:'include'});
          const result=await response.json();output.textContent='read status='+response.status+' authenticated='+result.authenticated;
        }catch(error){output.textContent='read response blocked: '+error.name;}
      };
      document.querySelector('#attack').onclick=async()=>{
        try { const response=await fetch(${JSON.stringify(gatewayUrl+'/api/admin/auth/logout')},{method:'POST',credentials:'include',headers:{'Content-Type':'text/plain'},body:'{}'});
          output.textContent='logout status='+response.status;
        }catch(error){output.textContent='logout response blocked: '+error.name;}
      };</script>`)
  }
  const approvedPort=await dual(page)
  const deniedPort=await dual(page)
  const allowed=`http://app.fixture.localhost:${approvedPort}`
  service=await startBackend({NODE_ENV:'development',CORS_ORIGINS:allowed})
  const gateway: http.RequestListener=async(req,res)=>{
    if(!['/api/admin/auth/login','/api/admin/auth/session','/api/admin/auth/logout'].includes(req.url||'')){res.writeHead(404).end();return}
    try {
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk))
      const headers:Record<string,string>={}
      for(const name of ['origin','cookie','content-type','access-control-request-method','access-control-request-headers']){
        if(typeof req.headers[name]==='string')headers[name]=req.headers[name] as string
      }
      const response=await fetch(service.baseUrl+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method||'GET')?undefined:Buffer.concat(chunks)})
      const data=await response.text()
      response.headers.forEach((value,name)=>{if(!['set-cookie','content-length','content-encoding','transfer-encoding'].includes(name))res.setHeader(name,value)})
      res.setHeader('Set-Cookie',response.headers.getSetCookie())
      evidence.push({method:req.method,path:req.url,origin:req.headers.origin||null,cookieSent:Boolean(req.headers.cookie?.includes('anonyproof_admin_session=')),
        status:response.status,allowOrigin:response.headers.get('access-control-allow-origin'),authenticated:req.url==='/api/admin/auth/session'?JSON.parse(data).authenticated:undefined,
        setsCookie:response.headers.getSetCookie().length>0})
      writeFileSync(path.join(projectRoot,'audit/execution-results/T-26-browser-network.json'),JSON.stringify(evidence,null,2)+'\n')
      res.writeHead(response.status).end(data)
    }catch{res.writeHead(500).end('fixture gateway failure')}
  }
  gatewayUrl=`http://api.fixture.localhost:${await dual(gateway)}`
  const metadata={allowed,sameSiteDenied:`http://evil.fixture.localhost:${deniedPort}`,crossSiteDenied:`http://outside.other.localhost:${deniedPort}`,fixturePid:process.pid}
  writeFileSync(path.join(projectRoot,'audit/execution-results/T-26-browser-fixture.json'),JSON.stringify(metadata,null,2)+'\n')
  console.log(JSON.stringify(metadata))
  process.once('SIGTERM',async()=>{await service.stop();for(const server of servers)await new Promise<void>(resolve=>server.close(()=>resolve()));process.exit(0)})
}
main().catch(error=>{console.error(error);process.exitCode=1})
