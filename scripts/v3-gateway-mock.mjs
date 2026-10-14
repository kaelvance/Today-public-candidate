import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createMockGateway } from '../server/v3/mock-gateway.mjs'
import { createMockWorkspaceStore } from '../server/v3/mock-workspace-store.mjs'
import {
  enrollFixture,
  fixtureDevice,
  fixtureProjection,
  fixtureReadInit,
  readFixture,
} from '../server/v3/gateway-fixtures.mjs'

// In-process integration scenario with only fictional records and ephemeral test keys.
const clock = Date.parse('2026-10-11T00:00:00.000Z')
const now = () => clock
const store = createMockWorkspaceStore({ fixtureOnly: true })
const runtime = await createMockGateway({
  fixtureOnly: true,
  workspaceIds: ['fixture-a', 'fixture-b'],
  store,
  now,
})
let nextRuntime = null
let externalFetchCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = () => {
  externalFetchCalls += 1
  throw new Error('external_fetch_forbidden_in_mock')
}
const flows = []
try {
  const owner = runtime.owners.get('fixture-a')
  const source = fixtureProjection(clock)
  const seed = { fixtureOnly: true, expectedRevision: 0, operationId: 'fixture-seed', data: source }
  await owner.replaceFixture(seed)
  const device = fixtureDevice()
  const grant = enrollFixture(runtime, owner, device)
  const result = await readFixture(runtime, device, grant.deviceId)
  assert.equal(result.overview.tasks[0].id, 'fixture-task-a')
  flows.push({ id: 'owner-approval-key-proof-read', passed: true, revision: result.revision })
  assert.equal(result.overview.counts.mail, null)
  assert.equal(result.overview.counts.calendarEvents, null)
  flows.push({ id: 'source-time-selected-coverage-missing-is-not-zero', passed: true })
  for (let i = 0; i < 31; i++)
    await assert.rejects(
      async () =>
        runtime.client.beginRead({
          deviceId: grant.deviceId,
          operation: 'overview',
          date: '2026-10-11',
          timeZone: 'Asia/Tokyo',
        }),
      { message: 'invalid_input' },
    )
  assert.equal(runtime.diagnostics().pendingReads, 0)
  assert.ok(await readFixture(runtime, device, grant.deviceId))
  flows.push({ id: 'unsigned-read-init-does-not-consume-device-capacity', passed: true })
  await assert.rejects(async () =>
    runtime.client.beginRead({
      ...fixtureReadInit(runtime, grant.deviceId),
      workspaceId: 'fixture-b',
    }),
  )
  const tasksDevice = fixtureDevice(),
    tasksGrant = enrollFixture(runtime, owner, tasksDevice, ['tasks:read'])
  await assert.rejects(
    async () => runtime.client.beginRead(fixtureReadInit(runtime, tasksGrant.deviceId)),
    { message: 'scope_denied' },
  )
  const tasks = await readFixture(runtime, tasksDevice, tasksGrant.deviceId, 'tasks')
  assert.equal(Object.hasOwn(tasks, 'events'), false)
  flows.push({ id: 'tenant-and-scope-isolation', passed: true })
  const challenge = runtime.client.beginRead(fixtureReadInit(runtime, grant.deviceId))
  const proof = { requestId: challenge.requestId, signature: device.signature(challenge) }
  await runtime.client.completeRead(proof)
  await assert.rejects(runtime.client.completeRead(proof), {
    message: 'read_challenge_expired_or_consumed',
  })
  owner.revokeDevice(grant.deviceId)
  await assert.rejects(async () => readFixture(runtime, device, grant.deviceId), {
    message: 'device_not_authorized',
  })
  flows.push({ id: 'proof-replay-and-revocation', passed: true })
  store.faults.setReadFault('fixture-a', 'unavailable')
  await assert.rejects(
    owner.replaceFixture({ ...seed, expectedRevision: 1, operationId: 'unavailable' }),
    { message: 'storage_unavailable' },
  )
  assert.equal(store.diagnostics().writeCount, 1)
  store.faults.setReadFault('fixture-a', null)
  flows.push({ id: 'unavailable-read-preserves-source', passed: true })
  store.faults.failNextWrite('after')
  const change = {
    ...seed,
    expectedRevision: 1,
    operationId: 'unknown-outcome',
    data: fixtureProjection(clock, 'updated'),
  }
  await assert.rejects(owner.replaceFixture(change), { message: 'commit_outcome_unknown' })
  assert.deepEqual(await owner.replaceFixture(change), { revision: 2, replayed: true })
  assert.equal(store.diagnostics().writeCount, 2)
  flows.push({ id: 'unknown-commit-reconciles-without-duplicate-effect', passed: true })
  const backupJSON = await owner.exportBackup()
  await runtime.close()
  const recoveredStore = createMockWorkspaceStore({ fixtureOnly: true })
  nextRuntime = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ['fixture-a'],
    store: recoveredStore,
    now,
  })
  const restoredOwner = nextRuntime.owners.get('fixture-a')
  const restore = await restoredOwner.restoreFixture({
    fixtureOnly: true,
    expectedRevision: 0,
    operationId: 'restore-fixture',
    backupJSON,
  })
  assert.equal(restore.revision, 3)
  const newGrant = enrollFixture(nextRuntime, restoredOwner, device)
  const recovered = await readFixture(nextRuntime, device, newGrant.deviceId)
  assert.equal(recovered.overview.tasks[0].id, 'fixture-task-updated')
  assert.equal(recovered.capturedAt, source.capturedAt)
  assert.deepEqual(await restoredOwner.replaceFixture(change), { revision: 2, replayed: true })
  flows.push({
    id: 'backup-restore-fresh-store-source-and-ledger-preserved',
    passed: true,
    revision: restore.revision,
  })
  await assert.rejects(
    async () =>
      nextRuntime.client.beginRead(fixtureReadInit(runtime, tasksGrant.deviceId, 'tasks')),
    { message: 'device_not_authorized' },
  )
  flows.push({ id: 'backup-does-not-resurrect-device-grants', passed: true })
  assert.equal(externalFetchCalls, 0)
  const resultDocument = {
    recordedAt: new Date().toISOString(),
    passed: true,
    mode: 'offline_fixture_only',
    transport: 'in-process Mock, not real device/TLS/HTTP',
    syntheticClock: new Date(clock).toISOString(),
    flows,
    externalFetchCalls,
    modelInference: false,
    realAccounts: false,
    realUserData: false,
    paidAPI: false,
    durableDiskStorage: false,
    limitations: [
      'Runtime restart is within one process',
      'Gateway workspace holds selected projections; V2 Core remains unchanged',
      'Physical iPhone, live pairing UI, secure transport and production auth are unverified',
    ],
  }
  const directory = resolve('../evidence/gateway-mock')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'result.json'), JSON.stringify(resultDocument, null, 2) + '\n')
  console.log(JSON.stringify(resultDocument, null, 2))
} finally {
  globalThis.fetch = originalFetch
  await runtime.close()
  if (nextRuntime) await nextRuntime.close()
}
