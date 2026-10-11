// Run after T-03.browser.ts native interaction; never targets a real DB.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { projectRoot } from './helpers'
const root=projectRoot
const metadata=JSON.parse(readFileSync(path.join(root,'audit/execution-results/T-03-browser-fixture.json'),'utf8'))
const key=readFileSync(path.join(path.dirname(metadata.databasePath),'content-key.fixture'),'utf8')
const codec=loadContentEncryption({demoMode:false,env:{CONTENT_ENCRYPTION_KEY:key}})
const Database=createRequire(root+'/server/package.json')('better-sqlite3')
const db=new Database(metadata.databasePath)
const feedback=db.prepare('SELECT * FROM feedbacks').get()
const comments=db.prepare('SELECT * FROM feedback_comments ORDER BY id').all()
const notices=db.prepare('SELECT * FROM notifications').all()
assert.equal(feedback.original_content_storage_version,1)
assert.equal(feedback.solution_storage_version,1)
assert.equal(feedback.status,'resolved')
assert.equal(feedback.encrypted_content,'server-encrypted:v1')
assert.equal(codec.decrypt(feedback.original_content,`feedbacks:${feedback.id}:original_content`,1),'T03_BROWSER_BODY_20261007 合成测试材料，没有真实敏感信息。')
assert.equal(codec.decrypt(feedback.solution,`feedbacks:${feedback.id}:solution`,1),'T03_BROWSER_SOLUTION_20261007 合成处理说明已核验完成。')
assert.equal(comments.length,2)
assert.equal(notices.length,4)
for(const row of comments){assert.equal(row.content_storage_version,1);const value=codec.decrypt(row.content,`feedback_comments:${row.feedback_id}:${row.commenter_type}:content`,1);assert.match(value,row.commenter_type==='user'?/^T03_BROWSER_COMMENT_20261007/:/^T03_BROWSER_REPLY_20261007/)}
for(const row of notices){assert.equal(row.content_storage_version,1);const ctx=`notifications:${row.feedback_id}:${row.recipient_type}:${row.recipient_id}:${row.type}`;assert.ok(codec.decrypt(row.title,ctx+':title',1));assert.ok(codec.decrypt(row.content,ctx+':content',1))}
const markers=['T03_BROWSER_BODY_20261007','T03_BROWSER_COMMENT_20261007','T03_BROWSER_SOLUTION_20261007','T03_BROWSER_REPLY_20261007',key,Buffer.from(key,'base64').toString('hex')]
for(const file of [metadata.databasePath,metadata.databasePath+'-wal',metadata.databasePath+'-shm']){if(existsSync(file)){const bytes=readFileSync(file);for(const marker of markers)assert.equal(bytes.includes(Buffer.from(marker)),false)}}
const dump=spawnSync('sqlite3',[metadata.databasePath,'.dump'],{encoding:'utf8'});assert.equal(dump.status,0);for(const marker of markers)assert.equal(dump.stdout.includes(marker),false)
db.close()
console.log('Browser fixture independent SQLite verification: 1 feedback / 2 comments / 4 notifications; all sensitive fields version1; exact body, solution, role comments and notification decryptions passed; DB/WAL/SQL dump plaintext/key scans passed.')
