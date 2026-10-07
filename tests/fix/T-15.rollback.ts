// Read-only rollback rehearsal against preserved dependency/build snapshots.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { projectRoot } from './helpers'
async function main() {
  const metadata = JSON.parse(readFileSync(path.join(projectRoot,'audit/execution-results/T-15-main-backup.json'),'utf8'))
  const backup = metadata.backup
  const requireBackup = createRequire(path.join(backup,'package.json'))
  assert.equal(requireBackup('next/package.json').version,'16.3.3')
  const Database = requireBackup('better-sqlite3')
  const db = new Database(':memory:');assert.equal(db.prepare('SELECT 1 n').get().n,1);db.close()
  assert.ok(existsSync(path.join(backup,'.next/BUILD_ID')))
  const listener = net.createServer()
  await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve))
  const port = (listener.address() as net.AddressInfo).port
  await new Promise<void>(resolve=>listener.close(()=>resolve()))
  const child = spawn(process.execPath,[path.join(backup,'node_modules/next/dist/bin/next'),'start',backup,'-H','127.0.0.1','-p',String(port)],{
    cwd:backup,env:{...process.env,NODE_ENV:'production'},detached:true,stdio:['ignore','pipe','pipe'],
  })
  let output='';child.stdout?.on('data',chunk=>output+=chunk.toString());child.stderr?.on('data',chunk=>output+=chunk.toString())
  const exit=new Promise<void>(resolve=>child.once('exit',()=>resolve()))
  const base=`http://127.0.0.1:${port}/anonyproof`
  try {
    let ready=false
    for(let index=0;index<100;index++){
      if(child.exitCode!==null)throw new Error('preserved old Next build failed to start')
      try{if((await fetch(base,{signal:AbortSignal.timeout(500)})).status===200){ready=true;break}}catch{}
      await delay(50)
    }
    assert.ok(ready)
    for(const route of ['', '/foorpynona','/access-stats'])assert.equal((await fetch(base+route)).status,200)
    const html=await (await fetch(base)).text()
    const asset=html.match(/(?:src|href)="([^\"]*\/anonyproof\/_next\/static\/[^\"]+)"/)
    assert.ok(asset)
    assert.equal((await fetch(`http://127.0.0.1:${port}${asset[1]}`)).status,200)
    console.log('Preserved Next16.3.3 tree/native ABI and old production BUILD_ID loaded; three pages and generated static asset returned200 from an isolated rollback server. Main checkout remains Next16.3.6. No API/business DB was connected or rolled back.')
  }finally{
    if(child.pid&&child.exitCode===null){try{process.kill(-child.pid,'SIGTERM')}catch{};await exit}
    writeFileSync(path.join(projectRoot,'audit/execution-results/T-15-rollback-server.txt'),output)
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
