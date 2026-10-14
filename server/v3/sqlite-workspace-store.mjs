import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  GATEWAY_LIMITS,
  boundedJSON,
  reject,
  revision,
  stableJSON,
  storedWorkspace,
  workspaceId,
} from './gateway-contract.mjs'

const APP_ID = 0x544f4459
const FORMAT = 'today.gateway.fixture-sqlite.v1'
const LOCK_FORMAT = 'today.gateway.fixture-lock.v1'
const META_SQL = 'CREATE TABLE fixture_meta (format TEXT NOT NULL, store_id TEXT NOT NULL)'
const DATA_SQL =
  'CREATE TABLE workspaces (workspace_id TEXT PRIMARY KEY NOT NULL, document TEXT NOT NULL)'
const OPTIONS = { timeout: 0, allowExtension: false, enableDoubleQuotedStringLiterals: false }
const MAX_DB_BYTES = 2_097_152
const dbFailure = (error) => ([11, 26].includes(error.errcode & 255) ? 'CORRUPT' : 'UNAVAILABLE')

function privateFile(path, maxBytes) {
  const stat = lstatSync(path)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > maxBytes
  )
    reject('unsafe_fixture_file', 403)
  return { dev: stat.dev, ino: stat.ino }
}
function sameFile(path, identity) {
  const current = privateFile(path, MAX_DB_BYTES)
  if (identity.dev !== current.dev || identity.ino !== current.ino)
    reject('fixture_file_replaced', 503)
}
function checkSidecars(path) {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      lstatSync(`${path}${suffix}`)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (suffix !== '-journal') reject('unexpected_journal_mode', 503)
    privateFile(`${path}${suffix}`, MAX_DB_BYTES * 2)
  }
}
function checkedDirectory(directory) {
  if (
    typeof directory !== 'string' ||
    !/^today-v3-fixture-[A-Za-z0-9_-]+$/.test(basename(directory))
  )
    reject('fixture_directory_required', 403)
  let stat, actual
  try {
    actual = realpathSync(directory)
    stat = lstatSync(directory)
  } catch {
    reject('fixture_directory_required', 403)
  }
  if (actual !== resolve(directory)) reject('fixture_directory_required', 403)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700)
    reject('private_fixture_directory_required', 403)
  const marker = join(directory, 'fixture.json')
  privateFile(marker, 1024)
  const manifest = JSON.parse(readFileSync(marker, 'utf8'))
  if (
    Object.keys(manifest).sort().join(',') !== 'fixtureOnly,format,storeId' ||
    manifest.fixtureOnly !== true ||
    manifest.format !== FORMAT ||
    !/^[a-f0-9-]{36}$/.test(manifest.storeId)
  )
    reject('fixture_directory_required', 403)
  return manifest.storeId
}
function configure(db) {
  db.exec(
    'PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0',
  )
}
function validateDB(db, storeId, isLock) {
  if (
    db.prepare('PRAGMA application_id').get().application_id !== APP_ID ||
    db.prepare('PRAGMA user_version').get().user_version !== 1 ||
    db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete' ||
    db.prepare('PRAGMA synchronous').get().synchronous !== 2
  )
    reject('storage_corrupt', 503)
  const expected = isLock ? [META_SQL] : [META_SQL, DATA_SQL].sort()
  const schema = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_autoindex_%' ORDER BY sql")
    .all()
    .map((r) => r.sql)
  if (JSON.stringify(schema) !== JSON.stringify(expected)) reject('storage_corrupt', 503)
  const meta = db.prepare('SELECT format, store_id FROM fixture_meta').all()
  if (
    meta.length !== 1 ||
    meta[0].format !== (isLock ? LOCK_FORMAT : FORMAT) ||
    meta[0].store_id !== storeId
  )
    reject('storage_corrupt', 503)
  if (
    db
      .prepare('PRAGMA quick_check')
      .all()
      .some((r) => r.quick_check !== 'ok')
  )
    reject('storage_corrupt', 503)
  if (
    !isLock &&
    db.prepare('SELECT COUNT(*) n FROM workspaces').get().n > GATEWAY_LIMITS.workspaces
  )
    reject('storage_corrupt', 503)
}

// Explicitly creates a NEW private directory with initialized fixture-only databases.
// Existing/missing/corrupt databases are never created or repaired by openFixtureSQLiteStore.
export function createFixtureStoreDirectory({ fixtureOnly, parent = realpathSync(tmpdir()) } = {}) {
  if (fixtureOnly !== true) reject('fixture_opt_in_required')
  const directory = mkdtempSync(join(realpathSync(parent), 'today-v3-fixture-'))
  const storeId = randomUUID()
  for (const [name, format] of [
    ['workspaces.sqlite', FORMAT],
    ['writer-lock.sqlite', LOCK_FORMAT],
  ]) {
    const path = join(directory, name)
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR,
      0o600,
    )
    fchmodSync(fd, 0o600)
    closeSync(fd)
    const db = new DatabaseSync(path, OPTIONS)
    try {
      configure(db)
      db.exec(
        `PRAGMA journal_mode=DELETE; PRAGMA max_page_count=512; BEGIN IMMEDIATE; PRAGMA application_id=${APP_ID}; PRAGMA user_version=1`,
      )
      db.exec(META_SQL)
      db.prepare('INSERT INTO fixture_meta VALUES (?, ?)').run(format, storeId)
      if (name === 'workspaces.sqlite') db.exec(DATA_SQL)
      db.exec('COMMIT')
    } finally {
      db.close()
    }
  }
  const markerFd = openSync(
    join(directory, 'fixture.json'),
    constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
    0o600,
  )
  try {
    writeFileSync(markerFd, JSON.stringify({ format: FORMAT, fixtureOnly: true, storeId }))
    fsyncSync(markerFd)
  } finally {
    closeSync(markerFd)
  }
  const dirFd = openSync(directory, constants.O_RDONLY)
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
  return directory
}

export function openFixtureSQLiteStore({ fixtureOnly, directory, checkpoint } = {}) {
  if (fixtureOnly !== true) reject('fixture_opt_in_required')
  if (checkpoint !== undefined && typeof checkpoint !== 'function') reject('invalid_input')
  const storeId = checkedDirectory(directory)
  const dataPath = join(directory, 'workspaces.sqlite'),
    lockPath = join(directory, 'writer-lock.sqlite')
  let db,
    lock,
    identities,
    failure,
    lease = null,
    writing = false,
    closed = false,
    writeCount = 0
  try {
    identities = {
      data: privateFile(dataPath, MAX_DB_BYTES),
      lock: privateFile(lockPath, MAX_DB_BYTES),
    }
    checkSidecars(dataPath)
    checkSidecars(lockPath)
    db = new DatabaseSync(dataPath, OPTIONS)
    lock = new DatabaseSync(lockPath, OPTIONS)
    configure(db)
    configure(lock)
    validateDB(db, storeId, false)
    validateDB(lock, storeId, true)
  } catch (error) {
    failure = error.code === 'storage_corrupt' ? 'CORRUPT' : dbFailure(error)
    db?.close()
    lock?.close()
    db = lock = undefined
  }
  function guard() {
    if (closed || failure)
      reject(failure === 'CORRUPT' ? 'storage_corrupt' : 'storage_unavailable', 503)
    try {
      if (checkedDirectory(directory) !== storeId) reject('fixture_identity_changed', 503)
      sameFile(dataPath, identities.data)
      sameFile(lockPath, identities.lock)
      checkSidecars(dataPath)
      checkSidecars(lockPath)
      validateDB(db, storeId, false)
      validateDB(lock, storeId, true)
    } catch (error) {
      if (error.code === 'storage_corrupt' || dbFailure(error) === 'CORRUPT')
        reject('storage_corrupt', 503)
      reject('storage_unavailable', 503)
    }
  }
  function read(id, nowMs) {
    guard()
    const row = db.prepare('SELECT document FROM workspaces WHERE workspace_id=?').get(id)
    if (!row) return { state: 'FIRST_USE' }
    try {
      return { state: 'PRESENT', workspace: storedWorkspace(boundedJSON(row.document), id, nowMs) }
    } catch {
      return { state: 'CORRUPT' }
    }
  }
  return {
    async load(id, nowMs) {
      workspaceId(id)
      try {
        return read(id, nowMs)
      } catch (error) {
        return {
          state:
            error.code === 'storage_corrupt' || dbFailure(error) === 'CORRUPT'
              ? 'CORRUPT'
              : 'UNAVAILABLE',
        }
      }
    },
    async claimWriter() {
      guard()
      if (lease) reject('writer_already_active', 409)
      try {
        lock.exec('BEGIN IMMEDIATE')
      } catch (error) {
        if ((error.errcode & 255) === 5) reject('writer_already_active', 409)
        reject('storage_unavailable', 503)
      }
      lease = Object.freeze({})
      return lease
    },
    async releaseWriter(value) {
      if (value !== lease || !lease || writing || db.isTransaction)
        reject('writer_not_drained', 409)
      lock.exec('ROLLBACK')
      lease = null
    },
    async compareAndSwap(value, id, expectedRevision, next, nowMs) {
      if (value !== lease || !lease) reject('writer_required', 403)
      if (writing) reject('concurrent_store_write', 409)
      workspaceId(id)
      revision(expectedRevision)
      const validated = storedWorkspace(next, id, nowMs),
        encoded = stableJSON(validated)
      if (Buffer.byteLength(encoded) > GATEWAY_LIMITS.backupBytes) reject('input_too_large', 413)
      writing = true
      let committed = false
      try {
        guard()
        db.exec('BEGIN IMMEDIATE')
        const current = read(id, nowMs)
        if (current.state === 'CORRUPT') reject('storage_corrupt', 503)
        const actual = current.state === 'FIRST_USE' ? 0 : current.workspace.revision
        if (actual !== expectedRevision || validated.revision <= actual)
          reject('revision_conflict', 409)
        if (
          current.state === 'FIRST_USE' &&
          db.prepare('SELECT COUNT(*) n FROM workspaces').get().n >= GATEWAY_LIMITS.workspaces
        )
          reject('workspace_capacity_reached', 429)
        await checkpoint?.('before_write')
        guard()
        db.prepare(
          'INSERT INTO workspaces VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET document=excluded.document',
        ).run(id, encoded)
        await checkpoint?.('after_write')
        guard()
        db.exec('COMMIT')
        committed = true
        writeCount++
        await checkpoint?.('after_commit')
        return validated.revision
      } catch (error) {
        if (committed) reject('commit_outcome_unknown', 503)
        if (db?.isTransaction) {
          try {
            db.exec('ROLLBACK')
          } catch {
            failure = 'UNAVAILABLE'
            reject('commit_outcome_unknown', 503)
          }
        }
        if (error.status) throw error
        reject(dbFailure(error) === 'CORRUPT' ? 'storage_corrupt' : 'storage_write_failed', 503)
      } finally {
        writing = false
      }
    },
    async close() {
      if (closed) return
      if (lease || writing || db?.isTransaction) reject('writer_not_drained', 409)
      db?.close()
      lock?.close()
      closed = true
    },
    diagnostics: () => ({
      mode: 'sqlite_fixture_only',
      closed,
      writing,
      writerActive: !!lease,
      writeCount,
    }),
  }
}
