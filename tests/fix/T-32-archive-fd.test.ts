import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, openSync, closeSync, writeSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { sealPrivateRetentionFile, restorePrivateRetentionFile } from '../../scripts/private-retention-archive'

test('T-32 rejected authentication cannot close a later reused descriptor or break subsequent archives', async () => {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'anonyproof-T32-fd-')))
  const key = randomBytes(32).toString('base64'), wrongKey = randomBytes(32).toString('base64')
  const payload = Buffer.alloc(200000, 7), source = path.join(folder, 'source.private')
  writeFileSync(source, payload, { mode: 0o600 })
  for (let n = 0; n < 64; n++) {
    const archive = path.join(folder, `archive-${n}.apra`), rejected = path.join(folder, `rejected-${n}`)
    await sealPrivateRetentionFile({ plaintextPath: source, archivePath: archive,
      contentKey: key, kind: 'snapshot', versionBinding: 'fd-regression' })
    await assert.rejects(restorePrivateRetentionFile({ archivePath: archive, destinationPath: rejected,
      contentKey: wrongKey, kind: 'snapshot', versionBinding: 'fd-regression' }), /ARCHIVE_AUTHENTICATION_OR_IO_FAILED/)
    assert.equal(existsSync(rejected), false)
    // Keep an unrelated descriptor open while pending callbacks get a turn.
    const canary = path.join(folder, `canary-${n}`), fd = openSync(canary, 'wx', 0o600)
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 2))
      writeSync(fd, Buffer.from('unrelated-file-still-open'))
    } finally { closeSync(fd) }
    assert.equal(readFileSync(canary, 'utf8'), 'unrelated-file-still-open')
    const restored = path.join(folder, `restored-${n}`)
    await restorePrivateRetentionFile({ archivePath: archive, destinationPath: restored,
      contentKey: key, kind: 'snapshot', versionBinding: 'fd-regression' })
    assert.deepEqual(readFileSync(restored), payload)
  }
  assert.deepEqual(readFileSync(source), payload)
})
