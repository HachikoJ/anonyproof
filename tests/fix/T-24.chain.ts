// Manual real Nginx -> production Next -> isolated Express acceptance.
// Requires existing .next build targeting 127.0.0.1:4000. Never builds/deploys.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'
import path from 'node:path'
import { startBackend, projectRoot } from './helpers'

async function requireFree(port: number) {
  const server=net.createServer()
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
  await new Promise<void>(resolve=>server.close(()=>resolve()))
}
async function main() {
  await requireFree(4000); await requireFree(3040)
  const buildPath=path.join(projectRoot,'.next/BUILD_ID')
  const buildHash=createHash('sha256').update(readFileSync(buildPath)).digest('hex')
  const reserve=net.createServer()
  await new Promise<void>((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',resolve)})
  const tlsPort=(reserve.address() as net.AddressInfo).port
  await new Promise<void>(resolve=>reserve.close(()=>resolve()))
  const origin=`https://anonyproof.deline.top:${tlsPort}`
  const proxyKey=randomBytes(32).toString('base64')
  const service=await startBackend({PORT:'4000',TRUST_PROXY:'1',PROXY_AUTH_KEY:proxyKey,CORS_ORIGINS:origin,LOGIN_RATE_LIMIT_MAX:'3',LOGIN_RATE_LIMIT_WINDOW_MS:'60000',IDENTITY_RATE_LIMIT_MAX:'30'})
  const next=spawn(process.execPath,[path.join(projectRoot,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3040'],{cwd:projectRoot,env:{...process.env,NODE_ENV:'production',API_PROXY_TARGET:service.baseUrl},detached:true,stdio:['ignore','pipe','pipe']})
  let nextOutput='';next.stdout?.on('data',value=>{nextOutput+=value.toString()});next.stderr?.on('data',value=>{nextOutput+=value.toString()})
  const nextExit=new Promise<number|null>(resolve=>next.once('exit',resolve))
  let runner: ReturnType<typeof spawn>|undefined
  let closed=false
  async function cleanup() {
    if(closed)return;closed=true
    if(runner&&runner.exitCode===null&&runner.pid){runner.kill('SIGTERM')}
    if(next.exitCode===null&&next.pid){try{process.kill(-next.pid,'SIGTERM')}catch{/* exited */};await nextExit}
    writeFileSync(path.join(service.dir,'next-output.txt'),nextOutput)
    await service.stop()
    const after=createHash('sha256').update(readFileSync(buildPath)).digest('hex')
    if(after!==buildHash)throw new Error('Shared .next build changed during chain acceptance')
  }
  process.once('SIGTERM',async()=>{await cleanup();process.exit(1)})
  try {
    let ready=false
    for(let i=0;i<100;i++){
      if(next.exitCode!==null)throw new Error('Owned Next exited before readiness')
      try{const response=await fetch('http://127.0.0.1:3040/anonyproof');await response.text();if(response.status===200){ready=true;break}}catch{/* poll same process */}
      await delay(50)
    }
    if(!ready)throw new Error('Owned production Next did not become ready')
    runner=spawn('python3',[path.join(projectRoot,'audit/execution-results/T-24-T35-chain-runner.py')],{cwd:projectRoot,stdio:['pipe','inherit','inherit']})
    // Secret travels only over this child stdin, never argv/log/artifact.
    runner.stdin!.end(JSON.stringify({databasePath:service.databasePath,password:service.password,proxyKey,backendPort:4000,nextPort:3040,tlsPort,origin,buildId:readFileSync(buildPath,'utf8').trim(),buildHash,fixtureDir:service.dir,secondSource:process.env.T24_SECOND_SOURCE||'::1'}))
    const code=await new Promise<number|null>(resolve=>runner!.once('exit',resolve))
    await cleanup();process.exitCode=code===0?0:1
  } finally {await cleanup()}
}
main().catch(()=>{console.error('T-24/T-35 isolated chain runner failed; inspect synthetic evidence artifacts');process.exitCode=1})
