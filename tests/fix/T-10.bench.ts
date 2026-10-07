import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, cpus, platform, release } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { projectRoot, startBackend } from './helpers'

const Database = createRequire(path.join(projectRoot, 'server/package.json'))('better-sqlite3') as typeof import('better-sqlite3')

async function benchmark(historyRows: number) {
  const directory = mkdtempSync(path.join(tmpdir(), 'anonyproof-T-10-bench-'))
  const file = path.join(directory, 'fixture.db')
  const loopFile = path.join(directory, 'event-loop.json')
  const hookFile = path.join(directory, 'measurement.cjs')
  const db = new Database(file)
  db.exec(`CREATE TABLE access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL,
    user_agent TEXT, path TEXT NOT NULL, method TEXT NOT NULL, status_code INTEGER,
    response_time INTEGER, is_bot BOOLEAN DEFAULT 0, is_suspicious BOOLEAN DEFAULT 0,
    suspicious_reason TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE access_stats (date TEXT PRIMARY KEY, total_visits INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0, bot_visits INTEGER DEFAULT 0,
    suspicious_visits INTEGER DEFAULT 0, avg_response_time INTEGER DEFAULT 0);`)
  const insert = db.prepare(`INSERT INTO access_logs
    (ip,path,method,response_time,is_bot,is_suspicious,created_at) VALUES (?, '/history', 'GET', ?, 0, 0, ?)`)
  const start = Date.now() - historyRows - 1000
  db.transaction(() => {
    for (let i = 0; i < historyRows; i++) insert.run(`192.0.2.${i % 100}`, i % 20, start + i)
  })()
  db.close()
  // Measurement-only preload in the backend process; no application debug route
  // or permanent instrumentation. The histogram excludes boot and warmup.
  writeFileSync(hookFile, `if (process.argv[1]?.endsWith('server/index.ts')) {
    const {monitorEventLoopDelay}=require('node:perf_hooks');
    const histogram=monitorEventLoopDelay({resolution:1}); histogram.enable();
    const http=require('node:http'), emit=http.Server.prototype.emit;
    http.Server.prototype.emit=function(event, req, res, ...args) {
      if(event==='request' && req.headers['x-t10-start']==='1') histogram.reset();
      if(event==='request' && req.headers['x-t10-end']==='1') res.once('finish',()=>setImmediate(()=>{
        require('node:fs').writeFileSync(${JSON.stringify(loopFile)},JSON.stringify({
          meanMs:histogram.mean/1e6,p95Ms:histogram.percentile(95)/1e6,maxMs:histogram.max/1e6
        }));
      }));
      return emit.call(this,event,req,res,...args);
    };
  }`)
  const startup = performance.now()
  const service = await startBackend({ DATABASE_PATH: file, NODE_OPTIONS: `--require=${hookFile}` })
  const startupMs = performance.now() - startup
  try {
    for (let i = 0; i < 20; i++) assert.equal((await fetch(service.baseUrl + '/health')).status, 200)
    const timings: number[] = []
    for (let i = 0; i < 500; i++) {
      const headers: Record<string, string> = { 'User-Agent': 'AnonyProof-bounded-benchmark' }
      if (i === 0) headers['x-t10-start'] = '1'
      if (i === 499) headers['x-t10-end'] = '1'
      const before = performance.now()
      const response = await fetch(service.baseUrl + '/api/stats', { headers })
      assert.equal(response.status, 200)
      await response.text()
      timings.push(performance.now() - before)
    }
    await delay(20)
    timings.sort((a, b) => a - b)
    const database = new Database(file)
    const logs = (database.prepare('SELECT COUNT(*) AS n FROM access_logs').get() as any).n
    const stats = (database.prepare('SELECT SUM(total_visits) AS n FROM access_stats').get() as any).n
    database.close()
    assert.equal(logs, historyRows + 521)
    assert.equal(stats, logs)
    assert.doesNotMatch(service.output(), /SQLITE_BUSY|SQLITE_LOCKED|Failed to log access/)
    return { historyRows, measuredRequests: 500, warmupRequests: 20, startupIncludingMigrationMs: startupMs,
      p95Ms: timings[Math.ceil(timings.length * 0.95) - 1], p50Ms: timings[249],
      eventLoop: JSON.parse(readFileSync(loopFile, 'utf8')), totalLogs: logs, fixture: directory }
  } finally { await service.stop() }
}

async function main() {
  const small = await benchmark(10000)
  const large = await benchmark(100000)
  const result = { date: new Date().toISOString(), node: process.version,
    machine: { platform: platform(), release: release(), cpu: cpus()[0].model },
    concurrency: 1, methodology: 'Separate loopback backend processes, same-day legacy logs, startup migration before readiness, 20 warmups then 500 sequential /api/stats requests. Server histogram reset on first measured request.',
    small, large, p95Ratio: large.p95Ms / small.p95Ms }
  writeFileSync(path.join(projectRoot, 'audit/execution-results/T-10-benchmark.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  assert.ok(result.p95Ratio <= 2, `10x history p95 ratio ${result.p95Ratio} exceeds 2`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
