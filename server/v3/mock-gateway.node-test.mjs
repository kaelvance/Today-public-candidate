import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockGateway } from './mock-gateway.mjs'
import { createMockWorkspaceStore } from './mock-workspace-store.mjs'
import { GATEWAY_LIMITS, digest, readInitMessage } from './gateway-contract.mjs'
import {
  enrollFixture,
  fixtureDevice,
  fixtureProjection,
  fixtureReadInit,
  readFixture,
} from './gateway-fixtures.mjs'

const start = Date.parse('2026-10-11T00:00:00.000Z')
const denied = (fn, code) =>
  assert.rejects(
    async () => fn(),
    (error) => error.code === code || error.message === code,
  )
async function setup(t, ids = ['fixture-a', 'fixture-b']) {
  let time = start
  const store = createMockWorkspaceStore({ fixtureOnly: true })
  const gateway = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ids,
    store,
    now: () => time,
  })
  t.after(() => gateway.close())
  return {
    store,
    gateway,
    owner: gateway.owners.get('fixture-a'),
    now: () => time,
    advance: (ms) => {
      time += ms
    },
  }
}
const replace = (
  ctx,
  { expectedRevision = 0, operationId = 'fixture-seed', data = fixtureProjection(ctx.now()) } = {},
) => ctx.owner.replaceFixture({ fixtureOnly: true, expectedRevision, operationId, data })
const deviceRead = (ctx, deviceId, operation = 'overview') =>
  ctx.gateway.client.beginRead(fixtureReadInit(ctx.gateway, deviceId, operation, ctx.now()))

test('Mock requires explicit fixture opt-in and never treats a missing workspace as initialized', async (t) => {
  assert.throws(() => createMockWorkspaceStore(), { message: 'mock_opt_in_required' })
  await denied(() => createMockGateway({}), 'mock_opt_in_required')
  const ctx = await setup(t)
  assert.deepEqual(await ctx.owner.storageStatus(), { state: 'FIRST_USE', revision: null })
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  await denied(() => readFixture(ctx.gateway, device, grant.deviceId), 'workspace_missing')
  assert.equal(ctx.store.diagnostics().writeCount, 0)
})
test('owner approval and private-key possession are both required, enrollment is single-use', async (t) => {
  const ctx = await setup(t),
    device = fixtureDevice()
  const ticket = ctx.gateway.client.requestPairing({
    publicKey: device.publicKey,
    label: '架空端末',
  })
  assert.deepEqual(ctx.gateway.client.pairingChallenge(ticket.ticketId), { state: 'pending' })
  await denied(
    () =>
      ctx.gateway.client.completePairing({ ticketId: ticket.ticketId, signature: 'x'.repeat(86) }),
    'pairing_not_approved',
  )
  await denied(
    () =>
      ctx.owner.approvePairing({
        ticketId: ticket.ticketId,
        fingerprint: '0'.repeat(64),
        scopes: ['tasks:read'],
      }),
    'fingerprint_mismatch',
  )
  ctx.owner.approvePairing({
    ticketId: ticket.ticketId,
    fingerprint: ticket.fingerprint,
    scopes: ['tasks:read'],
  })
  const { challenge } = ctx.gateway.client.pairingChallenge(ticket.ticketId)
  const proof = { ticketId: ticket.ticketId, signature: device.signature(challenge) }
  const grant = ctx.gateway.client.completePairing(proof)
  assert.deepEqual(grant.scopes, ['tasks:read'])
  await denied(() => ctx.gateway.client.completePairing(proof), 'pairing_not_approved')
})
test('different key or altered scope/tenant/issuer cannot complete approved enrollment', async (t) => {
  const ctx = await setup(t)
  for (const transform of [
    (challenge) => ({ ...challenge, workspaceId: 'fixture-b' }),
    (challenge) => ({ ...challenge, scopes: ['tasks:read', 'agenda:read'] }),
    (challenge) => ({ ...challenge, issuer: 'other-runtime' }),
  ]) {
    const device = fixtureDevice(),
      ticket = ctx.gateway.client.requestPairing({ publicKey: device.publicKey, label: '架空端末' })
    ctx.owner.approvePairing({
      ticketId: ticket.ticketId,
      fingerprint: ticket.fingerprint,
      scopes: ['tasks:read'],
    })
    const { challenge } = ctx.gateway.client.pairingChallenge(ticket.ticketId)
    await denied(
      () =>
        ctx.gateway.client.completePairing({
          ticketId: ticket.ticketId,
          signature: device.signature(transform(challenge)),
        }),
      'invalid_device_proof',
    )
  }
  const original = fixtureDevice(),
    other = fixtureDevice()
  const ticket = ctx.gateway.client.requestPairing({
    publicKey: original.publicKey,
    label: '架空端末',
  })
  ctx.owner.approvePairing({
    ticketId: ticket.ticketId,
    fingerprint: ticket.fingerprint,
    scopes: ['tasks:read'],
  })
  const { challenge } = ctx.gateway.client.pairingChallenge(ticket.ticketId)
  await denied(
    () =>
      ctx.gateway.client.completePairing({
        ticketId: ticket.ticketId,
        signature: other.signature(challenge),
      }),
    'invalid_device_proof',
  )
  assert.equal(ctx.gateway.diagnostics().devices, 0)
})
test('pairing expiration, owner rejection, unsafe keys and scope expansion fail closed', async (t) => {
  const ctx = await setup(t),
    device = fixtureDevice()
  for (const key of ['not-a-key', device.publicKey + '=', 'x'.repeat(200)])
    await denied(
      () => ctx.gateway.client.requestPairing({ publicKey: key, label: '架空端末' }),
      'invalid_public_key',
    )
  const ticket = ctx.gateway.client.requestPairing({
    publicKey: device.publicKey,
    label: '架空端末',
  })
  for (const scopes of [['tasks:write'], ['tasks:read', 'tasks:read'], []])
    await denied(
      () =>
        ctx.owner.approvePairing({
          ticketId: ticket.ticketId,
          fingerprint: ticket.fingerprint,
          scopes,
        }),
      'invalid_scope',
    )
  ctx.owner.rejectPairing(ticket.ticketId)
  await denied(() => ctx.gateway.client.pairingChallenge(ticket.ticketId), 'pairing_not_pending')
  const pending = ctx.gateway.client.requestPairing({
    publicKey: device.publicKey,
    label: '架空端末',
  })
  ctx.advance(GATEWAY_LIMITS.pairTTL)
  await denied(
    () =>
      ctx.owner.approvePairing({
        ticketId: pending.ticketId,
        fingerprint: pending.fingerprint,
        scopes: ['tasks:read'],
      }),
    'pairing_not_pending',
  )
})
test('signed read returns selected fixture data with revision, provenance and missing providers', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const result = await readFixture(ctx.gateway, device, grant.deviceId)
  assert.equal(result.fixtureOnly, true)
  assert.equal(result.workspaceId, 'fixture-a')
  assert.equal(result.revision, 1)
  assert.equal(result.overview.coverage, 'selected_only')
  assert.equal(result.overview.counts.mail, null)
  assert.equal(result.overview.counts.calendarEvents, null)
  assert.equal(result.overview.tasks[0].title, '架空の確認タスク a')
  assert.equal(result.capturedAt, new Date(start).toISOString())
})
test('read scopes constrain output and reject caller-selected tenant, write tools and URLs', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device, ['tasks:read'])
  const result = await readFixture(ctx.gateway, device, grant.deviceId, 'tasks')
  assert.equal(result.tasks.length, 1)
  assert.equal(Object.hasOwn(result, 'events'), false)
  await denied(() => deviceRead(ctx, grant.deviceId), 'scope_denied')
  await denied(() => deviceRead(ctx, grant.deviceId, 'agenda'), 'scope_denied')
  await denied(() => deviceRead(ctx, grant.deviceId, 'tasks:write'), 'read_operation_required')
  await denied(
    () => deviceRead(ctx, grant.deviceId, 'https://example.invalid'),
    'read_operation_required',
  )
  await denied(
    () =>
      ctx.gateway.client.beginRead({
        ...fixtureReadInit(ctx.gateway, grant.deviceId, 'tasks'),
        workspaceId: 'fixture-b',
      }),
    'invalid_input',
  )
})
test('tenant B data and proofs do not leak into tenant A reads', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  await ctx.gateway.owners.get('fixture-b').replaceFixture({
    fixtureOnly: true,
    expectedRevision: 0,
    operationId: 'fixture-seed-b',
    data: fixtureProjection(ctx.now(), 'b'),
  })
  const a = fixtureDevice(),
    b = fixtureDevice()
  const ga = enrollFixture(ctx.gateway, ctx.owner, a),
    gb = enrollFixture(ctx.gateway, ctx.gateway.owners.get('fixture-b'), b)
  const challenge = deviceRead(ctx, gb.deviceId)
  await denied(
    () =>
      ctx.gateway.client.completeRead({
        requestId: challenge.requestId,
        signature: a.signature(challenge),
      }),
    'invalid_device_proof',
  )
  const result = await readFixture(ctx.gateway, a, ga.deviceId)
  assert.deepEqual(
    result.overview.tasks.map((task) => task.id),
    ['fixture-task-a'],
  )
  await denied(() => ctx.owner.revokeDevice(gb.deviceId), 'device_not_authorized')
})
test('one-time read challenges reject replay, altered queries and cross-protocol proofs', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const challenge = deviceRead(ctx, grant.deviceId),
    proof = { requestId: challenge.requestId, signature: device.signature(challenge) }
  await ctx.gateway.client.completeRead(proof)
  await denied(() => ctx.gateway.client.completeRead(proof), 'read_challenge_expired_or_consumed')
  for (const changes of [
    { date: '2026-10-12' },
    { purpose: 'today.mock.pair.v1' },
    { workspaceId: 'fixture-b' },
  ]) {
    const next = deviceRead(ctx, grant.deviceId)
    await denied(
      () =>
        ctx.gateway.client.completeRead({
          requestId: next.requestId,
          signature: device.signature({ ...next, ...changes }),
        }),
      'invalid_device_proof',
    )
  }
})
test('device revocation blocks pending and subsequent reads, including in-flight storage', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const challenge = deviceRead(ctx, grant.deviceId)
  ctx.owner.revokeDevice(grant.deviceId)
  await denied(
    () =>
      ctx.gateway.client.completeRead({
        requestId: challenge.requestId,
        signature: device.signature(challenge),
      }),
    'read_challenge_expired_or_consumed',
  )
  await denied(() => deviceRead(ctx, grant.deviceId), 'device_not_authorized')
  const regrant = enrollFixture(ctx.gateway, ctx.owner, device),
    next = deviceRead(ctx, regrant.deviceId)
  const inflight = ctx.gateway.client.completeRead({
    requestId: next.requestId,
    signature: device.signature(next),
  })
  ctx.owner.revokeDevice(regrant.deviceId)
  await assert.rejects(inflight, { message: 'device_not_authorized' })
})
test('expiry does not refresh a persisted source or turn it into corrupt/empty storage', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const challenge = deviceRead(ctx, grant.deviceId)
  ctx.advance(GATEWAY_LIMITS.readTTL)
  await denied(
    () =>
      ctx.gateway.client.completeRead({
        requestId: challenge.requestId,
        signature: device.signature(challenge),
      }),
    'read_challenge_expired_or_consumed',
  )
  ctx.advance(300_000)
  assert.deepEqual(await ctx.owner.storageStatus(), { state: 'PRESENT', revision: 1 })
  await denied(
    () => readFixture(ctx.gateway, device, grant.deviceId, 'overview', ctx.now()),
    'source_expired',
  )
  ctx.advance(GATEWAY_LIMITS.grantTTL)
  await denied(() => deviceRead(ctx, grant.deviceId), 'device_not_authorized')
  assert.equal(ctx.store.diagnostics().writeCount, 1)
})
test('clock rollback fails closed instead of extending authorization or freshness', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  ctx.advance(-1)
  await denied(() => deviceRead(ctx, grant.deviceId), 'clock_regressed')
})
test('bounded enrollments and per-device read rate reject floods without provider calls', async (t) => {
  const ctx = await setup(t),
    device = fixtureDevice()
  const grant = enrollFixture(ctx.gateway, ctx.owner, device)
  for (let i = 0; i < GATEWAY_LIMITS.pendingPairs; i++)
    ctx.gateway.client.requestPairing({ publicKey: device.publicKey, label: '架空端末' })
  await denied(
    () => ctx.gateway.client.requestPairing({ publicKey: device.publicKey, label: '架空端末' }),
    'pairing_capacity_reached',
  )
  for (let i = 0; i < GATEWAY_LIMITS.requestsPerMinute; i++) deviceRead(ctx, grant.deviceId)
  await denied(() => deviceRead(ctx, grant.deviceId), 'rate_limited')
  ctx.advance(60_000)
  assert.ok(deviceRead(ctx, grant.deviceId))
})
test('knowing a device ID cannot consume its read challenge or rate capacity', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  for (let i = 0; i < GATEWAY_LIMITS.requestsPerMinute + 1; i++)
    await denied(
      () =>
        ctx.gateway.client.beginRead({
          deviceId: grant.deviceId,
          operation: 'overview',
          date: '2026-10-11',
          timeZone: 'Asia/Tokyo',
        }),
      'invalid_input',
    )
  assert.equal(ctx.gateway.diagnostics().pendingReads, 0)
  assert.ok(await readFixture(ctx.gateway, device, grant.deviceId))
})
test('signed read-init is bound to query/issuer/time and cannot be replayed to allocate slots', async (t) => {
  const ctx = await setup(t)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const request = fixtureReadInit(ctx.gateway, grant.deviceId)
  for (const changes of [
    { date: '2026-10-12' },
    { timeZone: 'UTC' },
    { clientNonce: 'A'.repeat(43) },
  ])
    await denied(
      () => ctx.gateway.client.beginRead({ ...request, ...changes }),
      'invalid_device_proof',
    )
  const wrongIssuer = {
    ...request,
    signature: device.signature(readInitMessage('other-runtime', request)),
  }
  await denied(() => ctx.gateway.client.beginRead(wrongIssuer), 'invalid_device_proof')
  const wrongKey = {
    ...request,
    signature: fixtureDevice().signature(readInitMessage(grant.issuer, request)),
  }
  await denied(() => ctx.gateway.client.beginRead(wrongKey), 'invalid_device_proof')
  assert.equal(ctx.gateway.diagnostics().pendingReads, 0)
  ctx.gateway.client.beginRead(request)
  await denied(() => ctx.gateway.client.beginRead(request), 'read_init_consumed')
  assert.equal(ctx.gateway.diagnostics().pendingReads, 1)
  ctx.advance(GATEWAY_LIMITS.readTTL)
  await denied(() => ctx.gateway.client.beginRead(request), 'read_init_expired')
  const future = {
    ...fixtureReadInit(ctx.gateway, grant.deviceId, 'overview', ctx.now()),
    issuedAt: new Date(ctx.now() + 5_001).toISOString(),
  }
  future.signature = device.signature(readInitMessage(grant.issuer, future))
  await denied(() => ctx.gateway.client.beginRead(future), 'read_init_expired')
})
test('device capacity refuses extra approval and becomes available after revocation', async (t) => {
  const ctx = await setup(t),
    device = fixtureDevice()
  const grants = []
  for (let i = 0; i < GATEWAY_LIMITS.devices; i++)
    grants.push(enrollFixture(ctx.gateway, ctx.owner, device))
  const ticket = ctx.gateway.client.requestPairing({
    publicKey: device.publicKey,
    label: '架空端末',
  })
  const approval = {
    ticketId: ticket.ticketId,
    fingerprint: ticket.fingerprint,
    scopes: ['tasks:read'],
  }
  await denied(() => ctx.owner.approvePairing(approval), 'device_capacity_reached')
  ctx.owner.revokeDevice(grants[0].deviceId)
  ctx.owner.approvePairing(approval)
  const { challenge } = ctx.gateway.client.pairingChallenge(ticket.ticketId)
  ctx.gateway.client.completePairing({
    ticketId: ticket.ticketId,
    signature: device.signature(challenge),
  })
  assert.equal(ctx.gateway.diagnostics().devices, GATEWAY_LIMITS.devices)
})
test('pending read capacity is bounded across devices and expires independently of grants', async (t) => {
  const ctx = await setup(t),
    device = fixtureDevice()
  const grants = Array.from({ length: 3 }, () => enrollFixture(ctx.gateway, ctx.owner, device))
  for (let i = 0; i < GATEWAY_LIMITS.pendingReads; i++)
    deviceRead(ctx, grants[Math.floor(i / 30)].deviceId)
  await denied(() => deviceRead(ctx, grants[2].deviceId), 'read_capacity_reached')
  assert.equal(ctx.gateway.diagnostics().pendingReads, GATEWAY_LIMITS.pendingReads)
  ctx.advance(GATEWAY_LIMITS.readTTL)
  assert.ok(deviceRead(ctx, grants[2].deviceId))
  assert.equal(ctx.gateway.diagnostics().pendingReads, 1)
})
test('invalid fixture writes preserve existing records and revision', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const invalid = fixtureProjection(ctx.now())
  invalid.tasks.push(invalid.tasks[0])
  await denied(
    () => replace(ctx, { expectedRevision: 1, operationId: 'invalid', data: invalid }),
    'invalid_projection',
  )
  await denied(
    () =>
      ctx.owner.replaceFixture({
        fixtureOnly: false,
        expectedRevision: 1,
        operationId: 'invalid',
        data: fixtureProjection(ctx.now()),
      }),
    'mock_opt_in_required',
  )
  assert.deepEqual(await ctx.owner.storageStatus(), { state: 'PRESENT', revision: 1 })
  assert.equal(ctx.store.diagnostics().writeCount, 1)
})
test('concurrent owner fixture commands use one writer and optimistic revision', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const results = await Promise.allSettled([
    replace(ctx, {
      expectedRevision: 1,
      operationId: 'next-a',
      data: fixtureProjection(ctx.now(), 'next-a'),
    }),
    replace(ctx, {
      expectedRevision: 1,
      operationId: 'next-b',
      data: fixtureProjection(ctx.now(), 'next-b'),
    }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'revision_conflict')
  assert.equal(ctx.store.diagnostics().writeCount, 2)
  await denied(
    () =>
      createMockGateway({
        fixtureOnly: true,
        workspaceIds: ['fixture-a'],
        store: ctx.store,
        now: ctx.now,
      }),
    'writer_already_active',
  )
})
test('idempotency is atomic with fixture state, survives Runtime restart, and binds payload', async (t) => {
  const ctx = await setup(t)
  const data = fixtureProjection(ctx.now())
  const first = await replace(ctx, { data })
  assert.equal(first.revision, 1)
  assert.deepEqual(await replace(ctx, { data }), { revision: 1, replayed: true })
  await denied(
    () => replace(ctx, { data: fixtureProjection(ctx.now(), 'different') }),
    'idempotency_conflict',
  )
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const pending = deviceRead(ctx, grant.deviceId)
  await ctx.gateway.close()
  const restarted = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ['fixture-a'],
    store: ctx.store,
    now: ctx.now,
  })
  t.after(() => restarted.close())
  assert.deepEqual(
    await restarted.owners.get('fixture-a').replaceFixture({
      fixtureOnly: true,
      expectedRevision: 0,
      operationId: 'fixture-seed',
      data,
    }),
    { revision: 1, replayed: true },
  )
  await denied(
    () =>
      restarted.client.completeRead({
        requestId: pending.requestId,
        signature: device.signature(pending),
      }),
    'read_challenge_expired_or_consumed',
  )
  await denied(
    () => restarted.client.beginRead(fixtureReadInit(ctx.gateway, grant.deviceId)),
    'device_not_authorized',
  )
  assert.equal(ctx.store.diagnostics().writeCount, 1)
})
test('before-commit failure preserves state; unknown commit is reconciled through the receipt', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  ctx.store.faults.failNextWrite('before')
  await denied(
    () => replace(ctx, { expectedRevision: 1, operationId: 'before' }),
    'storage_write_failed',
  )
  assert.deepEqual(await ctx.owner.storageStatus(), { state: 'PRESENT', revision: 1 })
  ctx.store.faults.failNextWrite('after')
  const data = fixtureProjection(ctx.now(), 'after')
  await denied(
    () => replace(ctx, { expectedRevision: 1, operationId: 'after', data }),
    'commit_outcome_unknown',
  )
  assert.equal(ctx.store.diagnostics().writeCount, 2)
  assert.deepEqual(await replace(ctx, { expectedRevision: 1, operationId: 'after', data }), {
    revision: 2,
    replayed: true,
  })
  assert.equal(ctx.store.diagnostics().writeCount, 2)
})
test('unavailable/corrupt reads block writes and preserve the last valid workspace', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  for (const [fault, code, state] of [
    ['unavailable', 'storage_unavailable', 'UNAVAILABLE'],
    ['corrupt', 'storage_corrupt', 'CORRUPT'],
  ]) {
    ctx.store.faults.setReadFault('fixture-a', fault)
    assert.deepEqual(await ctx.owner.storageStatus(), { state, revision: null })
    await denied(() => readFixture(ctx.gateway, device, grant.deviceId), code)
    await denied(() => replace(ctx, { expectedRevision: 0, operationId: `bad-${fault}` }), code)
    assert.equal(ctx.store.diagnostics().writeCount, 1)
  }
  ctx.store.faults.setReadFault('fixture-a', null)
  const result = await readFixture(ctx.gateway, device, grant.deviceId)
  assert.equal(result.revision, 1)
  assert.equal(result.overview.tasks[0].id, 'fixture-task-a')
})
test('JSON-valid invalid stored shapes are CORRUPT, never FIRST_USE', async (t) => {
  const ctx = await setup(t)
  for (const raw of ['{', '[]', '{}', '{"schemaVersion":999}', '{"revision":0}']) {
    ctx.store.faults.injectRawEntry('fixture-a', raw)
    assert.deepEqual(await ctx.owner.storageStatus(), { state: 'CORRUPT', revision: null })
    await denied(() => replace(ctx), 'storage_corrupt')
  }
  assert.equal(ctx.store.diagnostics().writeCount, 0)
})
test('closing drains accepted writes before releasing the writer lease', async (t) => {
  const ctx = await setup(t)
  const pause = ctx.store.faults.pauseNextWrite(),
    writing = replace(ctx)
  await pause.started
  const closing = ctx.gateway.close()
  assert.equal(ctx.store.diagnostics().writerActive, true)
  await denied(() => replace(ctx, { operationId: 'too-late' }), 'gateway_closed')
  await denied(
    () =>
      createMockGateway({
        fixtureOnly: true,
        workspaceIds: ['fixture-a'],
        store: ctx.store,
        now: ctx.now,
      }),
    'writer_already_active',
  )
  pause.release()
  await writing
  await closing
  assert.equal(ctx.store.diagnostics().writerActive, false)
  const next = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ['fixture-a'],
    store: ctx.store,
    now: ctx.now,
  })
  t.after(() => next.close())
  assert.deepEqual(await next.owners.get('fixture-a').storageStatus(), {
    state: 'PRESENT',
    revision: 1,
  })
})
test('write queue is bounded without dropping or prematurely releasing accepted writes', async (t) => {
  const ctx = await setup(t)
  const pause = ctx.store.faults.pauseNextWrite()
  t.after(pause.release)
  const writes = [replace(ctx, { operationId: 'queued-0' })]
  await pause.started
  for (let i = 1; i < GATEWAY_LIMITS.queuedWrites; i++)
    writes.push(replace(ctx, { expectedRevision: i, operationId: `queued-${i}` }))
  const settled = Promise.allSettled(writes)
  await denied(() => replace(ctx, { operationId: 'overflow' }), 'write_queue_full')
  assert.equal(ctx.store.diagnostics().writerActive, true)
  pause.release()
  assert.equal(
    (await settled).filter((result) => result.status === 'fulfilled').length,
    GATEWAY_LIMITS.queuedWrites,
  )
  assert.equal(ctx.store.diagnostics().writeCount, GATEWAY_LIMITS.queuedWrites)
})
test('workspace capacity remains bounded across Runtime restarts with different memberships', async (t) => {
  const ids = Array.from({ length: GATEWAY_LIMITS.workspaces }, (_, i) => `fixture-workspace-${i}`)
  const ctx = await setup(t, ids)
  for (const id of ids)
    await ctx.gateway.owners.get(id).replaceFixture({
      fixtureOnly: true,
      expectedRevision: 0,
      operationId: 'seed',
      data: fixtureProjection(ctx.now()),
    })
  await ctx.gateway.close()
  const next = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ['fixture-extra'],
    store: ctx.store,
    now: ctx.now,
  })
  t.after(() => next.close())
  await denied(
    () =>
      next.owners.get('fixture-extra').replaceFixture({
        fixtureOnly: true,
        expectedRevision: 0,
        operationId: 'seed',
        data: fixtureProjection(ctx.now()),
      }),
    'workspace_capacity_reached',
  )
  assert.throws(() => ctx.store.faults.injectRawEntry('fixture-extra', '{}'), {
    code: 'workspace_capacity_reached',
  })
  assert.equal(ctx.store.diagnostics().entries, GATEWAY_LIMITS.workspaces)
  for (const id of ids) assert.equal((await ctx.store.load(id, ctx.now())).state, 'PRESENT')
  assert.deepEqual(await next.owners.get('fixture-extra').storageStatus(), {
    state: 'FIRST_USE',
    revision: null,
  })
})
test('backup restore is owner-only, validates checksum/tenant/schema, and retains receipt history', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const backup = await ctx.owner.exportBackup(),
    document = JSON.parse(backup)
  assert.equal(document.sha256, digest(document.workspace))
  assert.equal(
    /privateKey|publicKey|signature|nonce|cookie|token|ticket|deviceId/u.test(backup),
    false,
  )
  const request = {
    fixtureOnly: true,
    expectedRevision: 1,
    operationId: 'restore-one',
    backupJSON: backup,
  }
  for (const mutate of [
    (d) => {
      d.workspace.data.tasks[0].title = '改変された架空データ'
    },
    (d) => {
      d.format = 'unsupported'
    },
    (d) => {
      d.workspaceId = 'fixture-b'
    },
    (d) => {
      d.token = 'fictional-not-a-secret'
    },
  ]) {
    const changed = structuredClone(document)
    mutate(changed)
    await assert.rejects(async () =>
      ctx.owner.restoreFixture({ ...request, backupJSON: JSON.stringify(changed) }),
    )
  }
  assert.equal(ctx.store.diagnostics().writeCount, 1)
  assert.deepEqual(await ctx.owner.restoreFixture(request), { revision: 2, replayed: false })
  assert.deepEqual(await ctx.owner.restoreFixture(request), { revision: 2, replayed: true })
  assert.deepEqual(await replace(ctx), { revision: 1, replayed: true })
  assert.equal(ctx.store.diagnostics().writeCount, 2)
  assert.equal(Object.hasOwn(ctx.gateway.client, 'restoreFixture'), false)
})
test('backup recovers a fresh Mock store without resurrecting enrollment or refreshing old data', async (t) => {
  const ctx = await setup(t)
  await replace(ctx)
  const device = fixtureDevice(),
    oldGrant = enrollFixture(ctx.gateway, ctx.owner, device)
  const backup = await ctx.owner.exportBackup()
  const fresh = createMockWorkspaceStore({ fixtureOnly: true })
  const recovered = await createMockGateway({
    fixtureOnly: true,
    workspaceIds: ['fixture-a'],
    store: fresh,
    now: ctx.now,
  })
  t.after(() => recovered.close())
  await recovered.owners.get('fixture-a').restoreFixture({
    fixtureOnly: true,
    expectedRevision: 0,
    operationId: 'restore-fresh',
    backupJSON: backup,
  })
  await denied(
    () => recovered.client.beginRead(fixtureReadInit(ctx.gateway, oldGrant.deviceId)),
    'device_not_authorized',
  )
  const grant = enrollFixture(recovered, recovered.owners.get('fixture-a'), device)
  const result = await readFixture(recovered, device, grant.deviceId)
  assert.equal(result.revision, 2)
  assert.equal(result.capturedAt, new Date(start).toISOString())
  ctx.advance(300_000)
  await denied(
    () => readFixture(recovered, device, grant.deviceId, 'overview', ctx.now()),
    'source_expired',
  )
})
test('receipt capacity holds writes rather than evicting replay protection', async (t) => {
  const ctx = await setup(t)
  for (let i = 0; i < GATEWAY_LIMITS.receipts; i++)
    await replace(ctx, { expectedRevision: i, operationId: `operation-${i}` })
  await denied(
    () => replace(ctx, { expectedRevision: GATEWAY_LIMITS.receipts, operationId: 'overflow' }),
    'receipt_capacity_reached',
  )
  assert.deepEqual(await replace(ctx, { operationId: 'operation-0' }), {
    revision: 1,
    replayed: true,
  })
  assert.equal(ctx.store.diagnostics().writeCount, GATEWAY_LIMITS.receipts)
})
test('returned values and bounded audit cannot mutate state or leak fixture text/proofs', async (t) => {
  const ctx = await setup(t)
  const data = fixtureProjection(ctx.now())
  const pending = replace(ctx, { data })
  data.tasks[0].title = '呼出側での変更'
  await pending
  const device = fixtureDevice(),
    grant = enrollFixture(ctx.gateway, ctx.owner, device)
  const result = await readFixture(ctx.gateway, device, grant.deviceId)
  result.overview.tasks[0].title = '受信側での変更'
  assert.equal(
    (await readFixture(ctx.gateway, device, grant.deviceId)).overview.tasks[0].title,
    '架空の確認タスク a',
  )
  for (let i = 0; i < GATEWAY_LIMITS.auditEntries; i++) await replace(ctx)
  const audit = ctx.gateway.audit()
  assert.equal(audit.entries.length, GATEWAY_LIMITS.auditEntries)
  assert.ok(audit.omittedEntries > 0)
  assert.equal(
    /架空の確認タスク|signature|nonce|privateKey|publicKey/u.test(JSON.stringify(audit)),
    false,
  )
})
