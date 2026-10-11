import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { projectRoot } from './helpers'
const metadata = JSON.parse(readFileSync(path.join(projectRoot,'audit/execution-results/T-04-browser-fixture.json'),'utf8'))
const Database = createRequire(projectRoot+'/server/package.json')('better-sqlite3')
const db = new Database(metadata.databasePath)
try {
  const feedback = db.prepare('SELECT * FROM feedbacks').get()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM feedbacks').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM feedback_comments').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 3)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_logs WHERE action='update_status'").get().n, 1)
  assert.equal(feedback.status, 'resolved')
  assert.equal(feedback.original_content_storage_version, 1)
  assert.equal(feedback.solution_storage_version, 1)
  assert.equal(feedback.encrypted_content, 'server-encrypted:v1')
  assert.equal(db.prepare('SELECT content_storage_version v FROM feedback_comments').get().v, 1)
  const rows = db.prepare('SELECT * FROM notifications').all()
  for (const row of rows) assert.equal(row.content_storage_version, 1)
  for (const value of [feedback.original_content,feedback.solution]) {
    assert.match(value,/^apc:/)
    const envelope=JSON.parse(value.slice(4))
    assert.equal(envelope.alg,'A256GCM')
    assert.equal(Buffer.from(envelope.nonce,'base64').length,12)
    assert.equal(Buffer.from(envelope.tag,'base64').length,16)
    assert.equal(value.includes('T04_BROWSER_'),false)
  }
  const network = JSON.parse(readFileSync(path.join(projectRoot,'audit/execution-results/T-04-browser-network.json'),'utf8')) as {method:string;path:string;status:number}[]
  for (const [method, suffix] of [['POST','/api/feedback'],['POST','/comments'],['PUT','/status']]) {
    const results=network.filter(row=>row.method===method&&row.path.endsWith(suffix)).map(row=>row.status)
    assert.deepEqual(results,[500,200],`${method} ${suffix}`)
  }
  console.log('Native browser: feedback/comment/status each HTTP500 -> same retained draft HTTP200. SQLite: feedback1/comment1/notices3/update_audit1; all sensitive fields authenticated storage version1. No Base64 success or partial fault writes.')
} finally { db.close() }
