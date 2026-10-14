import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createFixtureStoreDirectory, openFixtureSQLiteStore } from './sqlite-workspace-store.mjs'
import { createMockGateway } from './mock-gateway.mjs'
import {
  fixtureProjection,
  fixtureDevice,
  enrollFixture,
  readFixture,
} from './gateway-fixtures.mjs'
import { GATEWAY_LIMITS, digest } from './gateway-contract.mjs'

const NOW = Date.parse('2026-10-11T00:00:00.000Z')
const now = () => NOW
const seed = (suffix = '', operationId = 'seed', expectedRevision = 0) => ({
  fixtureOnly: true,
  expectedRevision,
  operationId,
  data: fixtureProjection(NOW, suffix),
})
const denied = (fn, code) => assert.rejects(fn, { code })
function directory(t) {
  const dir = createFixtureStoreDirectory({ fixtureOnly: true })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
async function runtime(t, dir, extra = {}) {
  const store = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir, ...extra })
  const gateway = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ['fixture-one'],
    store,
    now,
  })
  t.after(async () => {
    await gateway.close()
    await store.close()
  })
  return { store, gateway, owner: gateway.owners.get('fixture-one') }
}
function child(t, dir, mode, phase) {
  const worker = fork(
    fileURLToPath(new URL('./sqlite-fixture-worker.mjs', import.meta.url)),
    [dir, mode, ...(phase ? [phase] : [])],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: realpathSync(tmpdir()) },
    },
  )
  const messages = [],
    waiting = []
  worker.on('message', (message) => {
    const resolve = waiting.shift()
    if (resolve) resolve(message)
    else messages.push(message)
  })
  t.after(async () => {
    if (worker.exitCode === null && worker.signalCode === null) {
      const end = once(worker, 'exit')
      worker.kill('SIGKILL')
      await end
    }
  })
  return {
    worker,
    next: () =>
      messages.length
        ? Promise.resolve(messages.shift())
        : new Promise((resolve) => waiting.push(resolve)),
  }
}

test('fixture opt-in, private scope and initialized format are required', async (t) => {
  assert.throws(() => createFixtureStoreDirectory(), { code: 'fixture_opt_in_required' })
  const dir = directory(t)
  assert.throws(() => openFixtureSQLiteStore({ directory: dir }), {
    code: 'fixture_opt_in_required',
  })
  assert.throws(() => openFixtureSQLiteStore({ fixtureOnly: true, directory: tmpdir() }), {
    code: 'fixture_directory_required',
  })
  assert.throws(
    () =>
      openFixtureSQLiteStore({
        fixtureOnly: true,
        directory: join(dir, 'today-v3-fixture-missing'),
      }),
    {
      code: 'fixture_directory_required',
    },
  )
  assert.equal(lstatSync(dir).mode & 0o777, 0o700)
  for (const name of ['fixture.json', 'workspaces.sqlite', 'writer-lock.sqlite'])
    assert.equal(lstatSync(join(dir, name)).mode & 0o777, 0o600)
  const ctx = await runtime(t, dir)
  assert.deepEqual(await ctx.owner.storageStatus(), { state: 'FIRST_USE', revision: null })
})
test('source, revision and receipts survive full close/reopen; grants do not', async (t) => {
  const dir = directory(t),
    first = await runtime(t, dir)
  await first.owner.replaceFixture(seed())
  const device = fixtureDevice(),
    grant = enrollFixture(first.gateway, first.owner, device)
  const before = await readFixture(first.gateway, device, grant.deviceId)
  await first.gateway.close()
  await first.store.close()
  const second = await runtime(t, dir)
  assert.equal((await second.owner.replaceFixture(seed())).revision, 1)
  assert.equal(second.store.diagnostics().writeCount, 0)
  const row = await second.store.load('fixture-one', NOW)
  assert.equal(row.workspace.revision, 1)
  assert.equal(row.workspace.receipts.length, 1)
  assert.equal(row.workspace.data.capturedAt, before.capturedAt)
  assert.equal(second.gateway.diagnostics().devices, 0)
  const newDevice = fixtureDevice(),
    newGrant = enrollFixture(second.gateway, second.owner, newDevice)
  assert.equal((await readFixture(second.gateway, newDevice, newGrant.deviceId)).revision, 1)
})
test('two Store objects cannot hold the writer; rejected CAS preserves data', async (t) => {
  const dir = directory(t),
    ctx = await runtime(t, dir)
  await ctx.owner.replaceFixture(seed())
  const other = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
  t.after(() => other.close())
  await denied(() => other.claimWriter(), 'writer_already_active')
  await denied(() => ctx.owner.replaceFixture(seed('-new', 'bad-revision', 0)), 'revision_conflict')
  assert.equal((await other.load('fixture-one', NOW)).workspace.revision, 1)
  await ctx.gateway.close()
  await ctx.store.close()
  const lease = await other.claimWriter()
  await other.releaseWriter(lease)
})
test(
  'another PROCESS is excluded; SIGKILL releases the SQLite lease',
  { timeout: 5000 },
  async (t) => {
    const dir = directory(t),
      hold = child(t, dir, 'hold')
    assert.deepEqual(await hold.next(), { kind: 'claimed' })
    const store = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
    t.after(() => store.close())
    await denied(() => store.claimWriter(), 'writer_already_active')
    const exit = once(hold.worker, 'exit')
    hold.worker.kill('SIGKILL')
    await exit
    const lease = await store.claimWriter()
    await store.releaseWriter(lease)
  },
)
for (const phase of ['before_write', 'after_write', 'after_commit']) {
  test(
    `SIGKILL at ${phase}: recover atomic data+receipt and reconcile once`,
    { timeout: 5000 },
    async (t) => {
      const dir = directory(t),
        first = await runtime(t, dir)
      await first.owner.replaceFixture(seed())
      await first.gateway.close()
      await first.store.close()
      const worker = child(t, dir, 'write', phase)
      assert.deepEqual(await worker.next(), { kind: 'checkpoint', phase })
      const exit = once(worker.worker, 'exit')
      worker.worker.kill('SIGKILL')
      await exit
      const recovered = await runtime(t, dir)
      const row = await recovered.store.load('fixture-one', NOW)
      assert.equal(row.state, 'PRESENT')
      const committed = phase === 'after_commit'
      assert.equal(row.workspace.revision, committed ? 2 : 1)
      assert.equal(
        row.workspace.receipts.some((r) => r.operationId === 'child-write'),
        committed,
      )
      assert.equal(
        row.workspace.data.tasks[0].id,
        fixtureProjection(NOW, committed ? '-child' : '').tasks[0].id,
      )
      const command = seed('-child', 'child-write', 1)
      assert.equal((await recovered.owner.replaceFixture(command)).revision, 2)
      assert.equal(recovered.store.diagnostics().writeCount, committed ? 0 : 1)
      await recovered.owner.replaceFixture(command)
      assert.equal(recovered.store.diagnostics().writeCount, committed ? 0 : 1)
    },
  )
}
test('pre-commit injected I/O failure rolls back; after-commit failure is UNKNOWN', async (t) => {
  const dir = directory(t)
  let fail = 'after_write'
  const ctx = await runtime(t, dir, {
    checkpoint: async (phase) => {
      if (phase === fail) throw new Error('fixture-io-failure')
    },
  })
  await denied(() => ctx.owner.replaceFixture(seed()), 'storage_write_failed')
  assert.equal((await ctx.store.load('fixture-one', NOW)).state, 'FIRST_USE')
  fail = 'after_commit'
  await denied(() => ctx.owner.replaceFixture(seed()), 'commit_outcome_unknown')
  fail = null
  assert.equal((await ctx.owner.replaceFixture(seed())).revision, 1)
  assert.equal(ctx.store.diagnostics().writeCount, 1)
})
test('close/release cannot bypass an unsettled write; Runtime drains before release', async (t) => {
  const dir = directory(t)
  let release, started
  const ready = new Promise((r) => {
      started = r
    }),
    pause = new Promise((r) => {
      release = r
    })
  const ctx = await runtime(t, dir, {
    checkpoint: async (phase) => {
      if (phase === 'after_write') {
        started()
        await pause
      }
    },
  })
  const write = ctx.owner.replaceFixture(seed())
  await ready
  await denied(() => ctx.store.close(), 'writer_not_drained')
  let drained = false
  const closing = ctx.gateway.close().then(() => {
    drained = true
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(drained, false)
  release()
  await write
  await closing
  await ctx.store.close()
  assert.equal(drained, true)
})
test('JSON-valid invalid row is CORRUPT, never reset by a write', async (t) => {
  const dir = directory(t),
    ctx = await runtime(t, dir)
  await ctx.owner.replaceFixture(seed())
  await ctx.gateway.close()
  await ctx.store.close()
  const db = new DatabaseSync(join(dir, 'workspaces.sqlite'))
  db.prepare('UPDATE workspaces SET document=?').run('[]')
  db.close()
  const next = await runtime(t, dir)
  assert.deepEqual(await next.store.load('fixture-one', NOW), { state: 'CORRUPT' })
  await denied(() => next.owner.replaceFixture(seed()), 'storage_corrupt')
  const inspect = new DatabaseSync(join(dir, 'workspaces.sqlite'), { readOnly: true })
  assert.equal(inspect.prepare('SELECT document FROM workspaces').get().document, '[]')
  inspect.close()
})
test('missing DB is UNAVAILABLE, zeroed/malformed/schema-changed DB is CORRUPT; no replacement', async (t) => {
  for (const mode of ['missing', 'zero', 'malformed', 'schema']) {
    const dir = directory(t),
      path = join(dir, 'workspaces.sqlite')
    if (mode === 'missing') unlinkSync(path)
    if (mode === 'zero') writeFileSync(path, '')
    if (mode === 'malformed') writeFileSync(path, 'not-a-sqlite-database')
    if (mode === 'schema') {
      const db = new DatabaseSync(path)
      db.exec('CREATE TABLE unknown (data TEXT)')
      db.close()
    }
    const before = mode === 'missing' ? null : readFileSync(path)
    const store = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
    const expected = mode === 'missing' ? 'UNAVAILABLE' : 'CORRUPT'
    assert.deepEqual(await store.load('fixture-one', NOW), { state: expected })
    await denied(
      () => store.claimWriter(),
      expected === 'CORRUPT' ? 'storage_corrupt' : 'storage_unavailable',
    )
    await store.close()
    if (before) assert.deepEqual(readFileSync(path), before)
    else assert.throws(() => lstatSync(path), { code: 'ENOENT' })
  }
})
test('unsafe permissions or symlink paths fail closed without changing their targets', async (t) => {
  const dir = directory(t),
    path = join(dir, 'workspaces.sqlite')
  const bytes = readFileSync(path)
  chmodSync(path, 0o644)
  const deniedStore = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
  assert.deepEqual(await deniedStore.load('fixture-one', NOW), { state: 'UNAVAILABLE' })
  await deniedStore.close()
  assert.deepEqual(readFileSync(path), bytes)
  chmodSync(path, 0o600)
  const other = directory(t)
  const otherBytes = readFileSync(join(other, 'workspaces.sqlite'))
  unlinkSync(path)
  symlinkSync(join(other, 'workspaces.sqlite'), path)
  const linked = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
  assert.deepEqual(await linked.load('fixture-one', NOW), { state: 'UNAVAILABLE' })
  await linked.close()
  assert.deepEqual(readFileSync(join(other, 'workspaces.sqlite')), otherBytes)
})
test('dangling journal symlink and changed directory identity are rejected before access', async (t) => {
  const dir = directory(t),
    target = join(dir, 'must-not-be-created')
  symlinkSync(target, join(dir, 'workspaces.sqlite-journal'))
  const linked = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
  assert.deepEqual(await linked.load('fixture-one', NOW), { state: 'UNAVAILABLE' })
  await linked.close()
  assert.throws(() => lstatSync(target), { code: 'ENOENT' })
  unlinkSync(join(dir, 'workspaces.sqlite-journal'))
  const store = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
  const manifest = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'))
  manifest.storeId = '00000000-0000-0000-0000-000000000000'
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify(manifest))
  assert.deepEqual(await store.load('fixture-one', NOW), { state: 'UNAVAILABLE' })
  await store.close()
})
test('expired source stays PRESENT and backups recover data/receipts into a fresh DB', async (t) => {
  const first = await runtime(t, directory(t))
  await first.owner.replaceFixture(seed())
  const backup = await first.owner.exportBackup(),
    original = JSON.parse(backup).workspace
  const second = await runtime(t, directory(t))
  await second.owner.restoreFixture({
    fixtureOnly: true,
    expectedRevision: 0,
    operationId: 'restore',
    backupJSON: backup,
  })
  const recovered = (await second.store.load('fixture-one', NOW + 600_000)).workspace
  assert.deepEqual(recovered.data, original.data)
  assert.deepEqual(recovered.receipts[0], original.receipts[0])
  assert.equal(second.gateway.diagnostics().devices, 0)
  assert.equal(digest(recovered.data), digest(original.data))
})
test('workspace cap is enforced by SQLite after reopen and membership changes', async (t) => {
  const dir = directory(t),
    store = openFixtureSQLiteStore({ fixtureOnly: true, directory: dir })
  const ids = Array.from({ length: GATEWAY_LIMITS.workspaces }, (_, i) => `fixture-${i}`)
  const gateway = await createMockGateway({ fixtureOnly: true, workspaceIds: ids, store, now })
  for (const id of ids) await gateway.owners.get(id).replaceFixture(seed())
  await gateway.close()
  await store.close()
  const ctx = await runtime(t, dir)
  await denied(() => ctx.owner.replaceFixture(seed()), 'workspace_capacity_reached')
  for (const id of ids) assert.equal((await ctx.store.load(id, NOW)).workspace.revision, 1)
})
