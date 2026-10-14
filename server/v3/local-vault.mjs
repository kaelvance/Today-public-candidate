import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  existsSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  constants,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { validatePortable, canonicalPortable } from '../../shared/v3-portable.mjs'
import { assembleOverview, validateQuery, validateSnapshot } from './overview.mjs'
import { storedProjection } from './gateway-contract.mjs'
import {
  deriveVaultKey,
  newSalt,
  openVault,
  sealVault,
  vaultError,
  VAULT_ITERATIONS,
  b64,
} from './vault-crypto.mjs'

const FORMAT = 'today.v3.local-vault.v1',
  BACKUP = 'today.v3.encrypted-backup.v1'
const META_SQL =
  'CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)'
const STATE_SQL =
  'CREATE TABLE encrypted_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, envelope TEXT NOT NULL)'
const OPT = { timeout: 0, allowExtension: false, enableDoubleQuotedStringLiterals: false }
const TTL = 900_000
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const hash = (v) => createHash('sha256').update(canonicalPortable(v)).digest('hex')
const binding = (meta, revision) => ({
  format: FORMAT,
  vaultId: meta.vaultId,
  epoch: meta.epoch,
  revision,
})
function file(path, allowMissing = false) {
  let st
  try {
    st = lstatSync(path)
  } catch (e) {
    if (allowMissing && e.code === 'ENOENT') return
    vaultError('vault_unavailable', 503)
  }
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    st.nlink !== 1 ||
    (st.mode & 0o777) !== 0o600 ||
    st.size > 8_388_608
  )
    vaultError('vault_unavailable', 503)
  return { dev: st.dev, ino: st.ino }
}
function privateDir(path) {
  const st = lstatSync(path)
  if (
    realpathSync(path) !== resolve(path) ||
    !st.isDirectory() ||
    st.uid !== process.getuid() ||
    (st.mode & 0o777) !== 0o700
  )
    vaultError('vault_unavailable', 503)
}
function createFile(path) {
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR,
    0o600,
  )
  closeSync(fd)
}
function config(db) {
  db.exec(
    'PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0; PRAGMA secure_delete=ON; PRAGMA max_page_count=2048',
  )
}
function metadata(v) {
  if (
    !exact(v, ['format', 'vaultId', 'epoch', 'salt', 'iterations']) ||
    v.format !== FORMAT ||
    !/^[-a-f0-9]{36}$/.test(v.vaultId) ||
    !/^[-a-f0-9]{36}$/.test(v.epoch) ||
    v.iterations !== VAULT_ITERATIONS
  )
    vaultError('vault_corrupt', 503)
  try {
    b64(v.salt, 16)
  } catch {
    vaultError('vault_corrupt', 503)
  }
  return v
}
function state(v, nowMs) {
  if (
    !exact(v, ['version', 'updatedAt', 'snapshot', 'archive', 'receipts']) ||
    v.version !== 1 ||
    !Number.isFinite(Date.parse(v.updatedAt)) ||
    !Array.isArray(v.receipts) ||
    v.receipts.length > 128
  )
    vaultError('vault_corrupt', 503)
  if (v.snapshot !== null) v.snapshot = storedProjection(v.snapshot, nowMs)
  if (v.archive !== null) v.archive = validatePortable(v.archive)
  const ids = new Set()
  for (const r of v.receipts) {
    if (
      !exact(r, ['id', 'hash', 'revision']) ||
      typeof r.id !== 'string' ||
      !/^[-a-zA-Z0-9_]{1,80}$/.test(r.id) ||
      ids.has(r.id) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !/^[a-f0-9]{64}$/.test(r.hash)
    )
      vaultError('vault_corrupt', 503)
    ids.add(r.id)
  }
  return v
}

export function createLocalVault({ directory, now = () => Date.now(), checkpoint } = {}) {
  const clock = now
  let lastClock = -1
  now = () => {
    const value = clock()
    if (!Number.isSafeInteger(value) || value < lastClock || value < 0)
      vaultError('vault_clock_regressed', 503)
    lastClock = value
    return value
  }
  if (
    typeof directory !== 'string' ||
    !directory.startsWith('/') ||
    directory !== resolve(directory)
  )
    vaultError('vault_directory_required')
  let db,
    lock,
    identities,
    meta,
    key,
    owner,
    grantTimer,
    expires = 0,
    closed = false,
    busy = false,
    generation = 0,
    queue = Promise.resolve(),
    liveSnapshotHash = null
  const attempts = [],
    confirmations = new Map(),
    restorations = new Map()
  function cryptoAdmission() {
    while (attempts.length && attempts[0] <= now() - 60_000) attempts.shift()
    if (attempts.length >= 5) vaultError('vault_rate_limited', 429)
    attempts.push(now())
  }
  const path = join(directory, 'vault.sqlite'),
    lockPath = join(directory, 'writer.sqlite')
  function guardFiles() {
    privateDir(directory)
    for (const p of [path, lockPath]) {
      const identity = file(p),
        old = identities?.[p]
      if (old && (old.dev !== identity.dev || old.ino !== identity.ino))
        vaultError('vault_unavailable', 503)
      file(`${p}-journal`, true)
      if (file(`${p}-wal`, true) || file(`${p}-shm`, true)) vaultError('vault_corrupt', 503)
    }
  }
  function connect() {
    if (db) return
    guardFiles()
    let next, lease
    try {
      next = new DatabaseSync(path, OPT)
      lease = new DatabaseSync(lockPath, OPT)
      config(next)
      config(lease)
      const schema = next
        .prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY sql")
        .all()
        .map((r) => r.sql)
      if (
        JSON.stringify(schema) !== JSON.stringify([META_SQL, STATE_SQL].sort()) ||
        next.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
        next.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete' ||
        next.prepare('PRAGMA user_version').get().user_version !== 1
      )
        vaultError('vault_corrupt', 503)
      const m = next.prepare('SELECT document FROM metadata').all(),
        rows = next.prepare('SELECT revision FROM encrypted_state').all()
      if (
        m.length !== 1 ||
        rows.length !== 1 ||
        !Number.isSafeInteger(rows[0].revision) ||
        rows[0].revision < 0
      )
        vaultError('vault_corrupt', 503)
      meta = metadata(JSON.parse(m[0].document))
      db = next
      lock = lease
      identities = { [path]: file(path), [lockPath]: file(lockPath) }
    } catch (e) {
      next?.close()
      lease?.close()
      if (e.status) throw e
      vaultError('vault_corrupt', 503)
    }
  }
  function clear() {
    clearTimeout(grantTimer)
    key?.fill(0)
    key = undefined
    owner = undefined
    expires = 0
    generation++
    confirmations.clear()
    restorations.clear()
    if (lock?.isTransaction && !db?.isTransaction) lock.exec('ROLLBACK')
  }
  function auth(sid) {
    if (closed) vaultError('vault_closed', 503)
    if (key && expires <= now()) clear()
    if (!key || owner !== sid) vaultError('vault_locked', 403)
    guardFiles()
    return key
  }
  function read(sid) {
    const k = auth(sid),
      r = db.prepare('SELECT revision,envelope FROM encrypted_state WHERE id=1').get()
    if (!r) vaultError('vault_corrupt', 503)
    return {
      revision: r.revision,
      data: state(openVault(JSON.parse(r.envelope), k, binding(meta, r.revision)), now()),
    }
  }
  function enqueue(run) {
    if (closed) vaultError('vault_closed', 503)
    if (busy) vaultError('vault_busy', 409)
    busy = true
    const result = queue.then(run).finally(() => {
      busy = false
      if (!key && lock?.isTransaction && !db?.isTransaction) lock.exec('ROLLBACK')
    })
    queue = result.catch(() => {})
    return result
  }
  async function acquire(sid, passphrase, setup) {
    if (typeof sid !== 'string' || !sid) vaultError('vault_session_required', 403)
    if (key && expires <= now()) clear()
    if (key) vaultError('vault_already_unlocked', 409)
    cryptoAdmission()
    if (setup) {
      if (existsSync(directory)) vaultError('vault_already_exists', 409)
      if (!existsSync(dirname(directory)))
        mkdirSync(dirname(directory), { recursive: true, mode: 0o700 })
      if (realpathSync(dirname(directory)) !== resolve(dirname(directory)))
        vaultError('vault_unavailable', 503)
      // Validate BEFORE creating files, so invalid credentials cannot leave a broken empty vault.
      const salt = newSalt(),
        derived = await deriveVaultKey(passphrase, salt)
      if (closed) {
        derived.fill(0)
        vaultError('vault_closed', 503)
      }
      try {
        mkdirSync(directory, { mode: 0o700 })
        createFile(path)
        createFile(lockPath)
        db = new DatabaseSync(path, OPT)
        lock = new DatabaseSync(lockPath, OPT)
        config(db)
        config(lock)
        lock.exec('CREATE TABLE writer (id INTEGER PRIMARY KEY)')
        lock.exec('BEGIN IMMEDIATE')
        meta = {
          format: FORMAT,
          vaultId: randomUUID(),
          epoch: randomUUID(),
          salt,
          iterations: VAULT_ITERATIONS,
        }
        db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; PRAGMA user_version=1')
        db.exec(META_SQL)
        db.exec(STATE_SQL)
        db.prepare('INSERT INTO metadata VALUES (1,?)').run(JSON.stringify(meta))
        const data = {
          version: 1,
          updatedAt: new Date(now()).toISOString(),
          snapshot: null,
          archive: null,
          receipts: [],
        }
        db.prepare('INSERT INTO encrypted_state VALUES (1,0,?)').run(
          JSON.stringify(sealVault(data, derived, binding(meta, 0))),
        )
        db.exec('COMMIT')
        identities = { [path]: file(path), [lockPath]: file(lockPath) }
        key = derived
      } catch (e) {
        derived.fill(0)
        if (db?.isTransaction) db.exec('ROLLBACK')
        if (lock?.isTransaction) lock.exec('ROLLBACK')
        db?.close()
        lock?.close()
        db = lock = undefined
        throw e
      }
    } else {
      connect()
      try {
        lock.exec('BEGIN IMMEDIATE')
      } catch {
        vaultError('vault_writer_active', 409)
      }
      let derived
      try {
        derived = await deriveVaultKey(passphrase, meta.salt)
        if (closed) vaultError('vault_closed', 503)
        const r = db.prepare('SELECT revision,envelope FROM encrypted_state WHERE id=1').get()
        state(openVault(JSON.parse(r.envelope), derived, binding(meta, r.revision)), now())
        key = derived
      } catch (e) {
        derived?.fill(0)
        lock.exec('ROLLBACK')
        throw e
      }
    }
    owner = sid
    expires = now() + TTL
    generation++
    grantTimer = setTimeout(clear, TTL)
    grantTimer.unref()
    return info(sid)
  }
  function info(sid) {
    if (closed) return { enabled: true, initialized: true, locked: true, unavailable: true }
    if (key && expires <= now()) clear()
    const initialized = existsSync(directory)
    if (!key || owner !== sid) return { enabled: true, initialized, locked: true, localOnly: true }
    const r = read(sid)
    return {
      enabled: true,
      initialized: true,
      locked: false,
      localOnly: true,
      revision: r.revision,
      epoch: meta.epoch,
      expiresAt: new Date(expires).toISOString(),
      hasSnapshot: r.data.snapshot !== null,
      hasArchive: r.data.archive !== null,
      archiveRecords: r.data.archive?.records.length || 0,
    }
  }
  async function commit(sid, expected, data, nextMeta = meta, restoredRevision = 0) {
    const k = auth(sid),
      current = db.prepare('SELECT revision FROM encrypted_state WHERE id=1').get()
    if (current.revision !== expected) vaultError('vault_revision_conflict', 409)
    if (Math.max(expected, restoredRevision) >= 1_000_000_000)
      vaultError('vault_revision_limit', 409)
    const revision = Math.max(expected, restoredRevision) + 1,
      envelope = sealVault(data, k, binding(nextMeta, revision))
    let committed = false
    const g = generation
    try {
      db.exec('BEGIN IMMEDIATE')
      if (db.prepare('SELECT revision FROM encrypted_state WHERE id=1').get().revision !== expected)
        vaultError('vault_revision_conflict', 409)
      db.prepare('UPDATE encrypted_state SET revision=?,envelope=? WHERE id=1').run(
        revision,
        JSON.stringify(envelope),
      )
      db.prepare('UPDATE metadata SET document=? WHERE id=1').run(JSON.stringify(nextMeta))
      await checkpoint?.('before_commit')
      auth(sid)
      if (generation !== g) vaultError('vault_locked', 403)
      db.exec('COMMIT')
      committed = true
      meta = nextMeta
      await checkpoint?.('after_commit')
      return revision
    } catch (e) {
      if (committed) vaultError('vault_outcome_unknown', 503)
      if (db.isTransaction) db.exec('ROLLBACK')
      if (e.status) throw e
      vaultError('vault_write_failed', 503)
    }
  }
  function change(sid, input, type) {
    input = structuredClone(input)
    return enqueue(async () => {
      if (
        !exact(input, ['epoch', 'expectedRevision', 'operationId', 'consent', 'data']) ||
        input.consent !== true ||
        typeof input.operationId !== 'string' ||
        !/^[-a-zA-Z0-9_]{1,80}$/.test(input.operationId) ||
        !Number.isSafeInteger(input.expectedRevision)
      )
        vaultError('vault_invalid_input')
      const current = read(sid)
      if (input.epoch !== meta.epoch) vaultError('vault_epoch_conflict', 409)
      const data =
        type === 'snapshot'
          ? storedProjection(validateSnapshot(input.data, now()), now())
          : validatePortable(input.data)
      const digest = hash({ ...input, data, type }),
        prior = current.data.receipts.find((r) => r.id === input.operationId)
      if (prior) {
        if (prior.hash !== digest) vaultError('vault_idempotency_conflict', 409)
        if (type === 'snapshot') liveSnapshotHash = hash(data)
        return { revision: prior.revision, replayed: true }
      }
      if (current.revision !== input.expectedRevision) vaultError('vault_revision_conflict', 409)
      if (current.data.receipts.length >= 128) vaultError('vault_receipt_limit', 409)
      current.data[type] = data
      current.data.updatedAt = new Date(now()).toISOString()
      current.data.receipts.push({
        id: input.operationId,
        hash: digest,
        revision: current.revision + 1,
      })
      const revision = await commit(sid, current.revision, current.data)
      if (type === 'snapshot') liveSnapshotHash = hash(data)
      return { revision, replayed: false }
    })
  }
  return {
    status: info,
    setup: (sid, phrase) => enqueue(() => acquire(sid, phrase, true)),
    unlock: (sid, phrase) => enqueue(() => acquire(sid, phrase, false)),
    lock(sid) {
      auth(sid)
      if (busy) vaultError('vault_busy', 409)
      clear()
      return { locked: true }
    },
    publish: (sid, input) => change(sid, input, 'snapshot'),
    archive: (sid, input) => change(sid, input, 'archive'),
    overview(sid, date, tz) {
      validateQuery(date, tz)
      const r = read(sid)
      if (!r.data.snapshot) vaultError('vault_snapshot_required', 404)
      if (liveSnapshotHash !== hash(r.data.snapshot)) vaultError('vault_reshare_required', 409)
      if (Date.parse(r.data.snapshot.expiresAt) <= now()) vaultError('vault_snapshot_expired', 410)
      return assembleOverview(r.data.snapshot, date, tz, now())
    },
    export(sid) {
      auth(sid)
      read(sid)
      const r = db.prepare('SELECT revision,envelope FROM encrypted_state WHERE id=1').get()
      return {
        format: BACKUP,
        metadata: structuredClone(meta),
        revision: r.revision,
        envelope: JSON.parse(r.envelope),
      }
    },
    archiveExport(sid) {
      const r = read(sid)
      if (!r.data.archive) vaultError('vault_archive_required', 404)
      return r.data.archive
    },
    preview(sid, input) {
      return enqueue(async () => {
        auth(sid)
        cryptoAdmission()
        if (
          !exact(input, ['backup', 'passphrase']) ||
          !exact(input.backup, ['format', 'metadata', 'revision', 'envelope']) ||
          input.backup.format !== BACKUP ||
          !Number.isSafeInteger(input.backup.revision) ||
          input.backup.revision < 0 ||
          input.backup.revision > 1_000_000_000
        )
          vaultError('vault_invalid_input')
        const m = metadata(input.backup.metadata),
          g = generation,
          k = await deriveVaultKey(input.passphrase, m.salt)
        let decoded
        try {
          decoded = state(
            openVault(input.backup.envelope, k, binding(m, input.backup.revision)),
            now(),
          )
        } finally {
          k.fill(0)
        }
        auth(sid)
        if (g !== generation) vaultError('vault_locked', 403)
        restorations.clear()
        const restoreToken = randomUUID(),
          current = read(sid)
        restorations.set(restoreToken, {
          sid,
          epoch: meta.epoch,
          revision: current.revision,
          sourceRevision: input.backup.revision,
          expires: now() + 60_000,
          data: decoded,
        })
        const expiry = setTimeout(() => restorations.delete(restoreToken), 60_000)
        expiry.unref()
        return {
          restoreToken,
          epoch: meta.epoch,
          revision: current.revision,
          expiresAt: new Date(now() + 60_000).toISOString(),
          previewOnly: true,
          coreRestoreReady: false,
          archiveRecords: decoded.archive?.records.length || 0,
          contexts: decoded.archive?.contexts.length || 0,
          unresolvedAllDay:
            decoded.archive?.records.filter((r) => r.allDayDates === 'unknown_v2').length || 0,
          sourceCapturedAt: decoded.snapshot?.capturedAt || null,
          sourceExpired: decoded.snapshot ? Date.parse(decoded.snapshot.expiresAt) <= now() : null,
        }
      })
    },
    cancelRestore(sid, token) {
      auth(sid)
      const intent = restorations.get(token)
      if (intent?.sid === sid) restorations.delete(token)
      return { cancelled: true }
    },
    confirmRestore(sid, input) {
      return enqueue(async () => {
        auth(sid)
        if (
          !exact(input, ['restoreToken', 'epoch', 'revision', 'confirmed']) ||
          input.confirmed !== true
        )
          vaultError('vault_invalid_input')
        const intent = restorations.get(input.restoreToken)
        restorations.delete(input.restoreToken)
        if (
          !intent ||
          intent.sid !== sid ||
          intent.epoch !== input.epoch ||
          intent.revision !== input.revision ||
          intent.expires <= now()
        )
          vaultError('vault_confirmation_expired', 409)
        const current = read(sid)
        if (meta.epoch !== intent.epoch || current.revision !== intent.revision)
          vaultError('vault_revision_conflict', 409)
        const restored = state(intent.data, now())
        restored.updatedAt = new Date(now()).toISOString()
        const nextMeta = { ...meta, epoch: randomUUID() }
        const revision = await commit(
          sid,
          current.revision,
          restored,
          nextMeta,
          intent.sourceRevision,
        )
        confirmations.clear()
        liveSnapshotHash = null
        return { restored: true, revision, epoch: nextMeta.epoch, coreUnchanged: true }
      })
    },
    deletePreview(sid) {
      const r = read(sid)
      confirmations.clear()
      const nonce = randomUUID()
      confirmations.set(nonce, {
        sid,
        epoch: meta.epoch,
        revision: r.revision,
        expires: now() + 60_000,
      })
      return {
        nonce,
        epoch: meta.epoch,
        revision: r.revision,
        expiresAt: new Date(now() + 60_000).toISOString(),
        scope: 'local_vault_copies_only',
      }
    },
    cancelDelete(sid, nonce) {
      auth(sid)
      const c = confirmations.get(nonce)
      if (c?.sid === sid) confirmations.delete(nonce)
      return { cancelled: true }
    },
    confirmDelete(sid, input) {
      return enqueue(async () => {
        auth(sid)
        if (!exact(input, ['nonce', 'epoch', 'revision', 'confirmed']) || input.confirmed !== true)
          vaultError('vault_invalid_input')
        const c = confirmations.get(input.nonce)
        confirmations.delete(input.nonce)
        if (
          !c ||
          c.sid !== sid ||
          c.expires <= now() ||
          c.epoch !== input.epoch ||
          c.revision !== input.revision
        )
          vaultError('vault_confirmation_expired', 409)
        const current = read(sid)
        if (current.revision !== c.revision || meta.epoch !== c.epoch)
          vaultError('vault_revision_conflict', 409)
        const nextMeta = { ...meta, epoch: randomUUID() }
        const revision = await commit(
          sid,
          c.revision,
          {
            version: 1,
            updatedAt: new Date(now()).toISOString(),
            snapshot: null,
            archive: null,
            receipts: [],
          },
          nextMeta,
        )
        restorations.clear()
        return {
          revision,
          epoch: nextMeta.epoch,
          cleared: true,
          coreUnchanged: true,
          downloadedBackupsUnaffected: true,
        }
      })
    },
    async close() {
      if (closed) {
        await queue
        return
      }
      closed = true
      await queue
      clear()
      db?.close()
      lock?.close()
      db = lock = undefined
    },
  }
}
