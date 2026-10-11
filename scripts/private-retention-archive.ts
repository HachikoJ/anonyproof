// T-32 offline preparation only. No environment loading, CLI, activation or deletion.
import path from 'node:path'
import {
  constants, lstatSync, realpathSync, openSync, closeSync, readSync, writeSync,
  fsyncSync, fstatSync, mkdtempSync, linkSync,
} from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

export const PRIVATE_RETENTION_FORMAT = 'APRA/1' as const
const MAGIC = Buffer.from('APRA0001', 'ascii')
const NONCE_BYTES = 12, TAG_BYTES = 16, CHUNK_BYTES = 64 * 1024
const DOMAIN = 'AnonyProof/private-retention-archive'
export type RetentionArchiveKind = 'snapshot' | 'isolated-rows' | 'manifest'

export class PrivateRetentionError extends Error {
  constructor(public readonly code: string) {
    // Never forward filesystem, SQLite or crypto error messages/paths.
    super(`T-32 private retention failed: ${code}`)
    this.name = 'PrivateRetentionError'
  }
}
function fail(code: string): never { throw new PrivateRetentionError(code) }

function noSymlinkComponents(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) fail('EXPLICIT_CANONICAL_PATH_REQUIRED')
  let current = path.parse(value).root
  for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (lstatSync(current).isSymbolicLink()) fail('SYMLINK_PATH_REJECTED')
  }
  if (realpathSync(value) !== value) fail('SYMLINK_PATH_REJECTED')
}

export function assertPrivateDirectory(value: string) {
  try {
    noSymlinkComponents(value)
    const stat = lstatSync(value)
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 ||
        (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_DIRECTORY_REQUIRED')
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('PRIVATE_DIRECTORY_REQUIRED')
  }
}

export function assertPrivateFile(value: string) {
  try {
    assertPrivateDirectory(path.dirname(value))
    noSymlinkComponents(value)
    const stat = lstatSync(value)
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 ||
        (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_FILE_REQUIRED')
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('PRIVATE_FILE_REQUIRED')
  }
}

function assertNewFile(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) fail('EXPLICIT_CANONICAL_PATH_REQUIRED')
  assertPrivateDirectory(path.dirname(value))
  try { lstatSync(value); fail('DESTINATION_EXISTS') } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('DESTINATION_UNAVAILABLE')
  }
}

function openPrivateRead(value: string) {
  assertPrivateFile(value)
  const fd = openSync(value, constants.O_RDONLY | constants.O_NOFOLLOW)
  const stat = fstatSync(fd)
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 ||
      (process.getuid && stat.uid !== process.getuid())) {
    closeSync(fd); fail('PRIVATE_FILE_REQUIRED')
  }
  return fd
}

function archiveParameters(contentKey: string, kind: RetentionArchiveKind, versionBinding: string) {
  if (!['snapshot', 'isolated-rows', 'manifest'].includes(kind) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(versionBinding)) fail('INVALID_ARCHIVE_BINDING')
  if (typeof contentKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(contentKey)) fail('INVALID_CONTENT_KEY')
  const root = Buffer.from(contentKey, 'base64')
  if (root.length !== 32 || root.toString('base64') !== contentKey) fail('INVALID_CONTENT_KEY')
  try {
    const key = Buffer.from(hkdfSync('sha256', root,
      Buffer.from(`${DOMAIN}/key-derivation/v1`, 'utf8'),
      Buffer.from(`${DOMAIN}/A256GCM/archive-key/v1`, 'utf8'), 32))
    const aad = Buffer.from(JSON.stringify([DOMAIN, PRIVATE_RETENTION_FORMAT, 'A256GCM', kind, versionBinding]), 'utf8')
    return { key, aad }
  } finally { root.fill(0) }
}

export function assertRetentionArchiveParameters(contentKey: string, versionBinding: string) {
  const parameters = archiveParameters(contentKey, 'snapshot', versionBinding)
  parameters.key.fill(0)
}

function writeAll(fd: number, value: Buffer) {
  let offset = 0
  while (offset < value.length) offset += writeSync(fd, value, offset, value.length - offset)
}
function readExactly(fd: number, bytes: number, position: number) {
  const value = Buffer.alloc(bytes)
  let offset = 0
  while (offset < bytes) {
    const read = readSync(fd, value, offset, bytes - offset, position + offset)
    if (!read) fail('INVALID_ARCHIVE')
    offset += read
  }
  return value
}
function closeQuietly(fd: number | undefined) {
  if (fd !== undefined) try { closeSync(fd) } catch { /* Pipeline may already have closed it. */ }
}

export async function privateFileDigest(file: string) {
  let fd: number | undefined
  try {
    fd = openPrivateRead(file)
    const hash = createHash('sha256')
    const chunk = Buffer.alloc(CHUNK_BYTES)
    for (let bytes; (bytes = readSync(fd, chunk, 0, chunk.length, null)) > 0;) {
      hash.update(chunk.subarray(0, bytes))
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    return hash.digest('hex')
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('PRIVATE_FILE_READ_FAILED')
  } finally { closeQuietly(fd) }
}

type ArchiveInput = { contentKey: string; kind: RetentionArchiveKind; versionBinding: string }

/** Output is exclusive, private, and must remain staging until caller verifies the complete preparation. */
export async function sealPrivateRetentionFile(options: ArchiveInput & { plaintextPath: string; archivePath: string }) {
  let input: number | undefined, output: number | undefined, key: Buffer | undefined
  try {
    const parameters = archiveParameters(options.contentKey, options.kind, options.versionBinding)
    key = parameters.key
    input = openPrivateRead(options.plaintextPath)
    assertNewFile(options.archivePath)
    output = openSync(options.archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    const nonce = randomBytes(NONCE_BYTES)
    writeAll(output, Buffer.concat([MAGIC, nonce]))
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
    cipher.setAAD(parameters.aad)
    // One owner closes each descriptor. On a failed pipeline, Node 20 destroys
    // fs streams even with autoClose:false; their delayed close can otherwise
    // race the caller's close/reuse and close an unrelated subsequent file.
    const chunk = Buffer.alloc(CHUNK_BYTES)
    for (let bytes; (bytes = readSync(input, chunk, 0, chunk.length, null)) > 0;) {
      writeAll(output, cipher.update(chunk.subarray(0, bytes)))
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    writeAll(output, cipher.final())
    writeAll(output, cipher.getAuthTag())
    fsyncSync(output)
    return { sealed: true as const, format: PRIVATE_RETENTION_FORMAT }
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('ARCHIVE_PREPARATION_FAILED')
  } finally { key?.fill(0); closeQuietly(input); closeQuietly(output) }
}

/** Plaintext is private staging only until GCM final authentication succeeds. No SQLite is opened here. */
export async function restorePrivateRetentionFile(options: ArchiveInput & { archivePath: string; destinationPath: string }) {
  let input: number | undefined, output: number | undefined, key: Buffer | undefined
  try {
    const parameters = archiveParameters(options.contentKey, options.kind, options.versionBinding)
    key = parameters.key
    input = openPrivateRead(options.archivePath)
    assertNewFile(options.destinationPath)
    const size = fstatSync(input).size, headerBytes = MAGIC.length + NONCE_BYTES
    if (!Number.isSafeInteger(size) || size < headerBytes + TAG_BYTES) fail('INVALID_ARCHIVE')
    const header = readExactly(input, headerBytes, 0)
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) fail('INVALID_ARCHIVE')
    const tag = readExactly(input, TAG_BYTES, size - TAG_BYTES)
    const staging = mkdtempSync(path.join(path.dirname(options.destinationPath), '.T32-authentication-'))
    assertPrivateDirectory(staging)
    const stagedPlaintext = path.join(staging, 'unverified.private')
    output = openSync(stagedPlaintext, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length), { authTagLength: TAG_BYTES })
    decipher.setAAD(parameters.aad)
    decipher.setAuthTag(tag)
    if (size === headerBytes + TAG_BYTES) {
      // Empty payloads still require GCM authentication, not just a valid header.
      const final = decipher.final()
      writeAll(output, final)
    } else {
      const chunk = Buffer.alloc(CHUNK_BYTES)
      let position = headerBytes, remaining = size - headerBytes - TAG_BYTES
      while (remaining > 0) {
        const bytes = readSync(input, chunk, 0, Math.min(chunk.length, remaining), position)
        if (!bytes) fail('INVALID_ARCHIVE')
        writeAll(output, decipher.update(chunk.subarray(0, bytes)))
        position += bytes; remaining -= bytes
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      writeAll(output, decipher.final())
    }
    fsyncSync(output)
    closeSync(output); output = undefined
    // linkSync cannot replace an existing/racing target. This is one restored
    // file with a staging link, independent of the original snapshot/archive.
    linkSync(stagedPlaintext, options.destinationPath)
    return { restored: true as const, authenticated: true as const, format: PRIVATE_RETENTION_FORMAT }
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('ARCHIVE_AUTHENTICATION_OR_IO_FAILED')
  } finally { key?.fill(0); closeQuietly(input); closeQuietly(output) }
}
