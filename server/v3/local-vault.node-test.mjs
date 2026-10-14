import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createLocalVault } from './local-vault.mjs'
import { fixtureProjection } from './gateway-fixtures.mjs'
import { sealVault, openVault, deriveVaultKey, newSalt } from './vault-crypto.mjs'
import { validatePortable } from '../../shared/v3-portable.mjs'

const PHRASE = 'fixture-only-long-passphrase-rc1',
  SID = 'fixture-owner',
  START = Date.parse('2026-10-14T00:00:00.000Z')
const denied = (fn, code) => assert.rejects(fn, { code })
async function fixture(t, extra = {}) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'today-vault-test-')),
    directory = join(parent, 'private-vault')
  let clock = START
  const vault = createLocalVault({ directory, now: () => clock, ...extra }),
    stores = [vault]
  t.after(async () => {
    for (const s of stores) await s.close()
    rmSync(parent, { recursive: true, force: true })
  })
  return {
    vault,
    directory,
    now: () => clock,
    setTime: (v) => {
      clock = v
    },
    reopen() {
      const s = createLocalVault({ directory, now: () => clock })
      stores.push(s)
      return s
    },
  }
}
function request(v, rev = 0, id = 'fixture-share', data = fixtureProjection(START)) {
  return { epoch: v.status(SID).epoch, expectedRevision: rev, operationId: id, consent: true, data }
}
function archive() {
  const stamp = new Date(START).toISOString()
  return validatePortable({
    format: 'today.v3.portable.v1',
    createdAt: stamp,
    sourceSchemaVersion: 3,
    scope: 'manual_readonly_archive',
    records: [
      {
        id: 'fixture-secret',
        sourceRevision: null,
        allDayDates: 'not_applicable',
        record: {
          id: 'fixture-secret',
          kind: 'task',
          sourceId: 'manual',
          title: 'fixture plaintext must not be on disk',
          description: 'fixture private description',
          demo: false,
          status: 'active',
          importance: 2,
          createdAt: stamp,
          lastUpdated: stamp,
          sourceUpdatedAt: stamp,
        },
      },
    ],
    contexts: [],
    contextCorrections: [],
    excluded: { items: 0, contexts: 0, queuedActions: 0 },
  })
}
for (const stage of ['before_commit', 'after_commit']) {
  test(
    `encrypted vault SIGKILL ${stage}: reopen validates and reconciles exactly once`,
    { timeout: 5000 },
    async (t) => {
      const ctx = await fixture(t),
        v = ctx.vault
      await v.setup(SID, PHRASE)
      await v.publish(SID, request(v))
      await v.close()
      const child = fork(
        fileURLToPath(new URL('./vault-crash-fixture.mjs', import.meta.url)),
        [ctx.directory, stage],
        {
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          env: { PATH: '/usr/bin:/bin', TMPDIR: realpathSync(tmpdir()) },
        },
      )
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const end = once(child, 'exit')
          child.kill('SIGKILL')
          await end
        }
      })
      const [message] = await once(child, 'message')
      assert.deepEqual(message, { stage })
      const end = once(child, 'exit')
      child.kill('SIGKILL')
      await end
      const reopened = ctx.reopen()
      await reopened.unlock(SID, PHRASE)
      assert.equal(reopened.status(SID).revision, stage === 'after_commit' ? 2 : 1)
      const input = request(reopened, 1, 'fixture-child', fixtureProjection(START, 'child'))
      const result = await reopened.publish(SID, input)
      assert.equal(result.replayed, stage === 'after_commit')
      assert.equal(reopened.status(SID).revision, 2)
      assert.equal((await reopened.publish(SID, input)).replayed, true)
    },
  )
}
test('AES-GCM uses unique nonce and binds metadata; bad key/tag/header fail', async () => {
  const key = await deriveVaultKey(PHRASE, newSalt()),
    binding = { vaultId: 'fixture', epoch: 'one', revision: 1 }
  const a = sealVault({ fictional: true }, key, binding),
    b = sealVault({ fictional: true }, key, binding)
  assert.notEqual(a.nonce, b.nonce)
  assert.deepEqual(openVault(a, key, binding), { fictional: true })
  assert.throws(() => openVault(a, Buffer.alloc(32), binding), {
    code: 'vault_authentication_failed',
  })
  assert.throws(() => openVault(a, key, { ...binding, revision: 2 }), {
    code: 'vault_authentication_failed',
  })
  assert.throws(
    () => openVault({ ...a, tag: Buffer.alloc(16).toString('base64url') }, key, binding),
    { code: 'vault_authentication_failed' },
  )
  key.fill(0)
})
test('metadata export is detached; clock rollback fails closed; restart needs a fresh explicit share', async (t) => {
  const ctx = await fixture(t),
    v = ctx.vault
  await v.setup(SID, PHRASE)
  await v.publish(SID, request(v))
  const exported = v.export(SID),
    epoch = v.status(SID).epoch
  exported.metadata.epoch = 'not-the-live-epoch'
  assert.equal(v.status(SID).epoch, epoch)
  await v.close()
  const next = ctx.reopen()
  await next.unlock(SID, PHRASE)
  assert.throws(() => next.overview(SID, '2026-10-14', 'UTC'), { code: 'vault_reshare_required' })
  await next.publish(SID, request(next, 1, 'fresh-share'))
  assert.equal(next.overview(SID, '2026-10-14', 'UTC').tasks.length, 1)
  ctx.setTime(START - 1)
  assert.throws(() => next.status(SID), { code: 'vault_clock_regressed' })
})
test('setup is explicit; invalid phrase does not create a broken vault; separate session denied', async (t) => {
  const { vault } = await fixture(t)
  assert.equal(vault.status(SID).initialized, false)
  await denied(() => vault.setup(SID, 'short'), 'vault_passphrase_length')
  assert.equal(vault.status(SID).initialized, false)
  await vault.setup(SID, PHRASE)
  assert.equal(vault.status('other-session').locked, true)
  assert.throws(() => vault.overview('other-session', '2026-10-14', 'UTC'), {
    code: 'vault_locked',
  })
  assert.throws(() => vault.export('other-session'), { code: 'vault_locked' })
  await denied(() => vault.setup('other-session', PHRASE), 'vault_already_unlocked')
})
test('ciphertext-only persistence survives close/reopen; old session is never restored', async (t) => {
  const ctx = await fixture(t),
    v = ctx.vault
  await v.setup(SID, PHRASE)
  await v.archive(SID, request(v, 0, 'archive', archive()))
  const bytes = readFileSync(join(ctx.directory, 'vault.sqlite'))
  assert.equal(bytes.includes(Buffer.from('fixture plaintext must not be on disk')), false)
  assert.equal(bytes.includes(Buffer.from(PHRASE)), false)
  await v.close()
  const next = ctx.reopen()
  assert.equal(next.status(SID).locked, true)
  await denied(
    () => next.unlock(SID, 'incorrect-fixture-passphrase'),
    'vault_authentication_failed',
  )
  await next.unlock(SID, PHRASE)
  assert.equal(next.status(SID).archiveRecords, 1)
  assert.equal((await next.archive(SID, request(next, 0, 'archive', archive()))).replayed, true)
  assert.equal(next.status(SID).revision, 1)
})
test('CAS, request consent, one accepted writer and idempotency payload are enforced', async (t) => {
  const { vault: v } = await fixture(t)
  await v.setup(SID, PHRASE)
  const first = request(v)
  await denied(() => v.publish(SID, { ...first, consent: false }), 'vault_invalid_input')
  await v.publish(SID, first)
  assert.equal((await v.publish(SID, first)).replayed, true)
  await denied(
    () => v.publish(SID, { ...first, data: fixtureProjection(START, 'b') }),
    'vault_idempotency_conflict',
  )
  await denied(() => v.publish(SID, request(v, 0, 'stale')), 'vault_revision_conflict')
  assert.equal(
    v.overview(SID, '2026-10-14', 'Asia/Tokyo').tasks[0].id,
    fixtureProjection(START).tasks[0].id,
  )
})
test('before-commit failure rolls back; after-commit response loss is reconciled without another write', async (t) => {
  let fail = 'before_commit'
  const ctx = await fixture(t, {
      checkpoint: async (stage) => {
        if (stage === fail) throw new Error('fixture write failure')
      },
    }),
    v = ctx.vault
  await v.setup(SID, PHRASE)
  const input = request(v)
  await denied(() => v.publish(SID, input), 'vault_write_failed')
  assert.equal(v.status(SID).revision, 0)
  fail = 'after_commit'
  await denied(() => v.publish(SID, input), 'vault_outcome_unknown')
  fail = null
  assert.equal((await v.publish(SID, input)).replayed, true)
  assert.equal(v.status(SID).revision, 1)
})
test('expiry during in-flight transaction retains lease until rollback and hides data', async (t) => {
  let release, started
  const pause = new Promise((r) => {
      release = r
    }),
    ready = new Promise((r) => {
      started = r
    })
  const ctx = await fixture(t, {
      checkpoint: async () => {
        started()
        await pause
      },
    }),
    v = ctx.vault
  await v.setup(SID, PHRASE)
  const write = v.publish(SID, request(v))
  await ready
  ctx.setTime(START + 900_001)
  assert.equal(v.status(SID).locked, true)
  const competitor = ctx.reopen()
  await denied(() => competitor.unlock('fixture-other', PHRASE), 'vault_writer_active')
  release()
  await denied(() => write, 'vault_locked')
  await v.close()
  await competitor.unlock(SID, PHRASE)
  assert.equal(competitor.status(SID).revision, 0)
})
test('lease is held across two Vault objects and released by lock/close', async (t) => {
  const ctx = await fixture(t)
  await ctx.vault.setup(SID, PHRASE)
  const other = ctx.reopen()
  await denied(() => other.unlock('fixture-other', PHRASE), 'vault_writer_active')
  ctx.vault.lock(SID)
  await other.unlock('fixture-other', PHRASE)
  assert.equal(other.status('fixture-other').locked, false)
})
test('encrypted backup preview verifies password, metadata, data schema; never changes Core/vault', async (t) => {
  const { vault: v } = await fixture(t)
  await v.setup(SID, PHRASE)
  await v.archive(SID, request(v, 0, 'archive', archive()))
  const backup = v.export(SID),
    before = v.status(SID)
  const preview = await v.preview(SID, { backup, passphrase: PHRASE })
  assert.equal(preview.previewOnly, true)
  assert.equal(preview.coreRestoreReady, false)
  assert.equal(preview.archiveRecords, 1)
  await denied(
    () => v.preview(SID, { backup: { ...backup, revision: 2 }, passphrase: PHRASE }),
    'vault_authentication_failed',
  )
  await denied(
    () => v.preview(SID, { backup, passphrase: 'wrong-fixture-passphrase' }),
    'vault_authentication_failed',
  )
  assert.deepEqual(v.status(SID), before)
})
test('delete requires a bound fresh one-use preview; epoch blocks replay and downloaded backup remains', async (t) => {
  const { vault: v } = await fixture(t)
  await v.setup(SID, PHRASE)
  const input = request(v)
  await v.publish(SID, input)
  const backup = v.export(SID),
    preview = v.deletePreview(SID),
    approve = {
      nonce: preview.nonce,
      epoch: preview.epoch,
      revision: preview.revision,
      confirmed: true,
    }
  await denied(() => v.confirmDelete('other', approve), 'vault_locked')
  const result = await v.confirmDelete(SID, approve)
  assert.equal(result.coreUnchanged, true)
  assert.equal(v.status(SID).hasSnapshot, false)
  await denied(() => v.confirmDelete(SID, approve), 'vault_confirmation_expired')
  await denied(() => v.publish(SID, input), 'vault_epoch_conflict')
  assert.equal(
    (await v.preview(SID, { backup, passphrase: PHRASE })).sourceCapturedAt,
    new Date(START).toISOString(),
  )
})
test('stale and expired deletion previews never clear a newer revision', async (t) => {
  const { vault: v, setTime } = await fixture(t)
  await v.setup(SID, PHRASE)
  const p = v.deletePreview(SID)
  await v.publish(SID, request(v))
  await denied(
    () =>
      v.confirmDelete(SID, {
        nonce: p.nonce,
        epoch: p.epoch,
        revision: p.revision,
        confirmed: true,
      }),
    'vault_revision_conflict',
  )
  const fresh = v.deletePreview(SID)
  setTime(START + 60_001)
  await denied(
    () =>
      v.confirmDelete(SID, {
        nonce: fresh.nonce,
        epoch: fresh.epoch,
        revision: fresh.revision,
        confirmed: true,
      }),
    'vault_confirmation_expired',
  )
  assert.equal(v.status(SID).hasSnapshot, true)
})
test('explicit cancellation consumes deletion intent without changing data', async (t) => {
  const { vault: v } = await fixture(t)
  await v.setup(SID, PHRASE)
  await v.publish(SID, request(v))
  const p = v.deletePreview(SID)
  v.cancelDelete(SID, p.nonce)
  await denied(
    () =>
      v.confirmDelete(SID, {
        nonce: p.nonce,
        epoch: p.epoch,
        revision: p.revision,
        confirmed: true,
      }),
    'vault_confirmation_expired',
  )
  assert.equal(v.status(SID).hasSnapshot, true)
})
test('encrypted restore requires approval, rotates epoch, preserves archive/source/ledger; cancel and stale intent reject', async (t) => {
  const { vault: v } = await fixture(t)
  await v.setup(SID, PHRASE)
  await v.archive(SID, request(v, 0, 'archive', archive()))
  const backup = v.export(SID),
    before = v.status(SID),
    p = await v.preview(SID, { backup, passphrase: PHRASE })
  const approval = {
    restoreToken: p.restoreToken,
    epoch: p.epoch,
    revision: p.revision,
    confirmed: true,
  }
  await denied(() => v.confirmRestore('another-session', approval), 'vault_locked')
  v.cancelRestore(SID, p.restoreToken)
  await denied(() => v.confirmRestore(SID, approval), 'vault_confirmation_expired')
  const next = await v.preview(SID, { backup, passphrase: PHRASE })
  const result = await v.confirmRestore(SID, {
    restoreToken: next.restoreToken,
    epoch: next.epoch,
    revision: next.revision,
    confirmed: true,
  })
  assert.equal(result.coreUnchanged, true)
  assert.notEqual(v.status(SID).epoch, before.epoch)
  assert.deepEqual(v.archiveExport(SID), archive())
  await denied(
    () =>
      v.confirmRestore(SID, {
        restoreToken: next.restoreToken,
        epoch: next.epoch,
        revision: next.revision,
        confirmed: true,
      }),
    'vault_confirmation_expired',
  )
  const stale = await v.preview(SID, { backup, passphrase: PHRASE })
  await v.publish(SID, request(v, v.status(SID).revision, 'new-after-preview'))
  await denied(
    () =>
      v.confirmRestore(SID, {
        restoreToken: stale.restoreToken,
        epoch: stale.epoch,
        revision: stale.revision,
        confirmed: true,
      }),
    'vault_revision_conflict',
  )
})
test('expired source is kept but not served; future source is rejected before save', async (t) => {
  const { vault: v, setTime } = await fixture(t)
  await v.setup(SID, PHRASE)
  const future = fixtureProjection(START)
  future.tasks[0].sourceTime = new Date(START + 600_000).toISOString()
  await assert.rejects(() => v.publish(SID, request(v, 0, 'future', future)))
  assert.equal(v.status(SID).revision, 0)
  await v.publish(SID, request(v))
  setTime(START + 300_001)
  assert.throws(() => v.overview(SID, '2026-10-14', 'UTC'), { code: 'vault_snapshot_expired' })
  assert.equal(v.status(SID).hasSnapshot, true)
})
test('missing/malformed/tampered DB is never overwritten; unsafe sidecar rejected', async (t) => {
  const ctx = await fixture(t)
  await ctx.vault.setup(SID, PHRASE)
  await ctx.vault.close()
  const path = join(ctx.directory, 'vault.sqlite'),
    bytes = readFileSync(path)
  const db = new DatabaseSync(path)
  db.prepare('UPDATE encrypted_state SET envelope=?').run('{}')
  db.close()
  const before = readFileSync(path),
    bad = ctx.reopen()
  await assert.rejects(() => bad.unlock(SID, PHRASE))
  await bad.close()
  assert.deepEqual(readFileSync(path), before)
  writeFileSync(path, bytes)
  symlinkSync(join(ctx.directory, 'missing-target'), `${path}-journal`)
  const linked = ctx.reopen()
  await denied(() => linked.unlock(SID, PHRASE), 'vault_unavailable')
  await linked.close()
  unlinkSync(`${path}-journal`)
  unlinkSync(path)
  const missing = ctx.reopen()
  await denied(() => missing.unlock(SID, PHRASE), 'vault_unavailable')
  assert.throws(() => readFileSync(path), { code: 'ENOENT' })
})
