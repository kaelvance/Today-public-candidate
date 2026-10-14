import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { assembleOverview, validateQuery } from './overview.mjs'
import {
  GATEWAY_LIMITS,
  READ_SCOPES,
  backupDocument,
  digest,
  exactObject,
  identifier,
  instant,
  proofBytes,
  readInitMessage,
  reject,
  revision,
  scopes,
  stableJSON,
  storedProjection,
  workspaceId,
} from './gateway-contract.mjs'

function publicKey(value) {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value))
    reject('invalid_public_key')
  try {
    const der = Buffer.from(value, 'base64url')
    if (der.toString('base64url') !== value || der.length !== 44) reject('invalid_public_key')
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') reject('invalid_public_key')
    return { key, fingerprint: createHash('sha256').update(der).digest('hex') }
  } catch {
    reject('invalid_public_key')
  }
}
function verified(key, challenge, signature) {
  if (
    typeof signature !== 'string' ||
    signature.length !== 86 ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  )
    return false
  const bytes = Buffer.from(signature, 'base64url')
  return (
    bytes.length === 64 &&
    bytes.toString('base64url') === signature &&
    verify(null, proofBytes(challenge), key, bytes)
  )
}
function snapshotInput(value) {
  try {
    return structuredClone(value)
  } catch {
    reject('invalid_input')
  }
}

// Offline fixture protocol. There are no sockets, cookies, real accounts or provider calls here.
// owners is a trusted test control port, not an externally exposed authentication mechanism.
export async function createMockGateway({
  fixtureOnly,
  workspaceIds,
  store,
  now = () => Date.now(),
} = {}) {
  if (fixtureOnly !== true) reject('mock_opt_in_required')
  if (
    !Array.isArray(workspaceIds) ||
    !workspaceIds.length ||
    workspaceIds.length > GATEWAY_LIMITS.workspaces
  )
    reject('invalid_workspaces')
  const allowed = new Set(workspaceIds.map(workspaceId))
  if (allowed.size !== workspaceIds.length) reject('invalid_workspaces')
  let lastTime = -1
  const clock = () => {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) reject('clock_unavailable', 503)
    if (value < lastTime) reject('clock_regressed', 503)
    lastTime = value
    return value
  }
  clock()
  const lease = await store.claimWriter()
  const issuer = `mock-${randomUUID()}`
  const pairs = new Map(),
    devices = new Map(),
    reads = new Map(),
    readStarts = new Map(),
    rates = new Map()
  const audit = []
  let omittedAuditEntries = 0,
    closed = false,
    queued = 0,
    queue = Promise.resolve()
  const assertOpen = () => {
    if (closed) reject('gateway_closed', 503)
  }
  const record = (action, details = {}) => {
    if (audit.length === GATEWAY_LIMITS.auditEntries) {
      audit.shift()
      omittedAuditEntries += 1
    }
    audit.push({ at: new Date(clock()).toISOString(), action, ...details })
  }
  const cleanup = () => {
    const time = clock()
    for (const [id, pair] of pairs) if (pair.expiresAt <= time) pairs.delete(id)
    for (const [id, read] of reads)
      if (Date.parse(read.challenge.expiresAt) <= time) reads.delete(id)
    for (const [id, start] of readStarts) if (start.expiresAt <= time) readStarts.delete(id)
    for (const [id, times] of rates) {
      const active = times.filter((at) => at > time - 60_000)
      if (active.length) rates.set(id, active)
      else rates.delete(id)
    }
    for (const [id, device] of devices)
      if (device.expiresAt <= time) {
        devices.delete(id)
        for (const [requestId, read] of reads) if (read.deviceId === id) reads.delete(requestId)
        for (const [nonce, start] of readStarts) if (start.deviceId === id) readStarts.delete(nonce)
      }
  }
  const registered = (id) => {
    identifier(id)
    const device = devices.get(id)
    if (!device || device.expiresAt <= clock()) reject('device_not_authorized', 403)
    return device
  }
  const load = async (id) => {
    const result = await store.load(id, clock())
    if (result.state === 'UNAVAILABLE') reject('storage_unavailable', 503)
    if (result.state === 'CORRUPT') reject('storage_corrupt', 503)
    if (result.state === 'FIRST_USE') return null
    if (result.state !== 'PRESENT') reject('storage_unavailable', 503)
    return result.workspace
  }
  const enqueue = (work) => {
    assertOpen()
    if (queued >= GATEWAY_LIMITS.queuedWrites) reject('write_queue_full', 429)
    queued += 1
    const pending = queue.then(work)
    queue = pending
      .catch(() => {})
      .finally(() => {
        queued -= 1
      })
    return pending
  }
  const replace = (id, request, backup = null) => {
    assertOpen()
    const input = snapshotInput(request)
    exactObject(
      input,
      backup
        ? ['fixtureOnly', 'expectedRevision', 'operationId', 'backupJSON']
        : ['fixtureOnly', 'expectedRevision', 'operationId', 'data'],
    )
    if (input.fixtureOnly !== true) reject('mock_opt_in_required')
    const expectedRevision = revision(input.expectedRevision),
      operationId = identifier(input.operationId)
    const data = backup ? backup.data : storedProjection(input.data, clock())
    const requestHash = digest({
      kind: backup ? 'restore' : 'replace',
      expectedRevision,
      data,
      backup: backup || null,
    })
    return enqueue(async () => {
      const current = await load(id)
      const old = current?.receipts.find((entry) => entry.operationId === operationId)
      if (old) {
        if (old.requestHash !== requestHash) reject('idempotency_conflict', 409)
        record('fixture_write_replayed', { workspaceId: id, revision: old.revision })
        return { revision: old.revision, replayed: true }
      }
      const actual = current?.revision || 0
      if (actual !== expectedRevision) reject('revision_conflict', 409)
      const merged = new Map((current?.receipts || []).map((entry) => [entry.operationId, entry]))
      for (const entry of backup?.receipts || []) {
        const previous = merged.get(entry.operationId)
        if (previous && previous.requestHash !== entry.requestHash)
          reject('backup_ledger_conflict', 409)
        if (!previous) merged.set(entry.operationId, entry)
      }
      if (merged.has(operationId)) reject('idempotency_conflict', 409)
      if (merged.size >= GATEWAY_LIMITS.receipts) reject('receipt_capacity_reached', 409)
      const nextRevision = revision(Math.max(actual, backup?.revision || 0) + 1)
      merged.set(operationId, { operationId, requestHash, revision: nextRevision })
      const next = {
        schemaVersion: 1,
        fixtureOnly: true,
        workspaceId: id,
        revision: nextRevision,
        updatedAt: new Date(clock()).toISOString(),
        data,
        receipts: [...merged.values()],
      }
      try {
        await store.compareAndSwap(lease, id, actual, next, clock())
      } catch (error) {
        record('fixture_write_failed', {
          workspaceId: id,
          code: error.code || 'storage_unavailable',
        })
        // Unknown outcome is returned, never retried automatically. A replay must consult the stored receipt.
        throw error
      }
      record(backup ? 'fixture_backup_restored' : 'fixture_workspace_replaced', {
        workspaceId: id,
        revision: nextRevision,
      })
      return { revision: nextRevision, replayed: false }
    })
  }

  const owners = new Map(
    [...allowed].map((id) => [
      id,
      Object.freeze({
        async storageStatus() {
          assertOpen()
          const result = await store.load(id, clock())
          return {
            state: result.state,
            revision: result.state === 'PRESENT' ? result.workspace.revision : null,
          }
        },
        replaceFixture: (request) => replace(id, request),
        async exportBackup() {
          assertOpen()
          const workspace = await load(id)
          if (!workspace) reject('workspace_missing', 404)
          const document = {
            format: 'today.gateway.fixture-backup.v1',
            fixtureOnly: true,
            workspaceId: id,
            createdAt: new Date(clock()).toISOString(),
            workspace,
            sha256: digest(workspace),
          }
          const encoded = stableJSON(document)
          if (Buffer.byteLength(encoded) > GATEWAY_LIMITS.backupBytes)
            reject('input_too_large', 413)
          record('fixture_backup_exported', { workspaceId: id, revision: workspace.revision })
          return encoded
        },
        restoreFixture(request) {
          assertOpen()
          const input = snapshotInput(request)
          exactObject(input, ['fixtureOnly', 'expectedRevision', 'operationId', 'backupJSON'])
          const workspace = backupDocument(input.backupJSON, id, clock())
          return replace(id, input, workspace)
        },
        approvePairing(request) {
          assertOpen()
          cleanup()
          const input = snapshotInput(request)
          exactObject(input, ['ticketId', 'fingerprint', 'scopes'])
          identifier(input.ticketId)
          const pair = pairs.get(input.ticketId)
          if (!pair || pair.approval) reject('pairing_not_pending', 409)
          if (input.fingerprint !== pair.fingerprint) reject('fingerprint_mismatch', 403)
          const approved = scopes(input.scopes)
          if (
            devices.size + [...pairs.values()].filter((item) => item.approval).length >=
            GATEWAY_LIMITS.devices
          )
            reject('device_capacity_reached', 429)
          pair.approval = { workspaceId: id, deviceId: `device-${randomUUID()}`, scopes: approved }
          record('fixture_pairing_approved', { workspaceId: id, deviceId: pair.approval.deviceId })
          return { approved: true }
        },
        revokeDevice(deviceId) {
          assertOpen()
          const device = devices.get(identifier(deviceId))
          if (!device || device.workspaceId !== id) reject('device_not_authorized', 403)
          devices.delete(deviceId)
          rates.delete(deviceId)
          for (const [requestId, read] of reads)
            if (read.deviceId === deviceId) reads.delete(requestId)
          for (const [nonce, start] of readStarts)
            if (start.deviceId === deviceId) readStarts.delete(nonce)
          record('fixture_device_revoked', { workspaceId: id, deviceId })
          return { revoked: true }
        },
        rejectPairing(ticketId) {
          assertOpen()
          const pair = pairs.get(identifier(ticketId))
          if (!pair || (pair.approval && pair.approval.workspaceId !== id))
            reject('pairing_not_pending', 409)
          pairs.delete(ticketId)
          record('fixture_pairing_rejected', { workspaceId: id })
          return { rejected: true }
        },
      }),
    ]),
  )

  const client = Object.freeze({
    requestPairing(request) {
      assertOpen()
      cleanup()
      const input = snapshotInput(request)
      exactObject(input, ['publicKey', 'label'])
      if (
        typeof input.label !== 'string' ||
        !input.label.trim() ||
        input.label.length > 64 ||
        /[\u0000-\u001f\u007f]/u.test(input.label)
      )
        reject('invalid_input')
      const parsed = publicKey(input.publicKey)
      if (pairs.size >= GATEWAY_LIMITS.pendingPairs) reject('pairing_capacity_reached', 429)
      const ticketId = `pair-${randomUUID()}`
      pairs.set(ticketId, {
        ...parsed,
        expiresAt: clock() + GATEWAY_LIMITS.pairTTL,
        nonce: randomBytes(32).toString('base64url'),
        approval: null,
      })
      return {
        ticketId,
        fingerprint: parsed.fingerprint,
        expiresAt: new Date(clock() + GATEWAY_LIMITS.pairTTL).toISOString(),
      }
    },
    pairingChallenge(ticketId) {
      assertOpen()
      cleanup()
      const pair = pairs.get(identifier(ticketId))
      if (!pair) reject('pairing_not_pending', 409)
      if (!pair.approval) return { state: 'pending' }
      return {
        state: 'approved',
        challenge: {
          purpose: 'today.mock.pair.v1',
          issuer,
          ticketId,
          nonce: pair.nonce,
          fingerprint: pair.fingerprint,
          ...pair.approval,
          expiresAt: new Date(pair.expiresAt).toISOString(),
        },
      }
    },
    completePairing(request) {
      assertOpen()
      cleanup()
      const input = snapshotInput(request)
      exactObject(input, ['ticketId', 'signature'])
      const pair = pairs.get(identifier(input.ticketId))
      if (!pair?.approval) reject('pairing_not_approved', 403)
      const challenge = client.pairingChallenge(input.ticketId).challenge
      // Each completed or failed signature consumes this approved enrollment attempt.
      pairs.delete(input.ticketId)
      if (!verified(pair.key, challenge, input.signature)) reject('invalid_device_proof', 403)
      const expiresAt = clock() + GATEWAY_LIMITS.grantTTL
      devices.set(pair.approval.deviceId, {
        ...pair.approval,
        key: pair.key,
        fingerprint: pair.fingerprint,
        expiresAt,
        grantVersion: randomUUID(),
      })
      record('fixture_device_registered', {
        workspaceId: pair.approval.workspaceId,
        deviceId: pair.approval.deviceId,
      })
      return {
        issuer,
        deviceId: pair.approval.deviceId,
        workspaceId: pair.approval.workspaceId,
        scopes: [...pair.approval.scopes],
        expiresAt: new Date(expiresAt).toISOString(),
      }
    },
    beginRead(request) {
      assertOpen()
      cleanup()
      const input = snapshotInput(request)
      exactObject(input, [
        'deviceId',
        'operation',
        'date',
        'timeZone',
        'clientNonce',
        'issuedAt',
        'signature',
      ])
      const device = registered(input.deviceId)
      if (!['overview', 'tasks', 'agenda'].includes(input.operation))
        reject('read_operation_required', 403)
      validateQuery(input.date, input.timeZone)
      if (
        typeof input.clientNonce !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.clientNonce) ||
        Buffer.from(input.clientNonce, 'base64url').toString('base64url') !== input.clientNonce
      )
        reject('invalid_input')
      const issuedAt = Date.parse(instant(input.issuedAt))
      if (issuedAt <= clock() - GATEWAY_LIMITS.readTTL || issuedAt > clock() + 5_000)
        reject('read_init_expired', 403)
      if (!verified(device.key, readInitMessage(issuer, input), input.signature))
        reject('invalid_device_proof', 403)
      const nonceKey = `${input.deviceId}:${input.clientNonce}`
      if (readStarts.has(nonceKey)) reject('read_init_consumed', 403)
      const needed =
        input.operation === 'overview'
          ? READ_SCOPES
          : [input.operation === 'tasks' ? 'tasks:read' : 'agenda:read']
      if (needed.some((scope) => !device.scopes.includes(scope))) reject('scope_denied', 403)
      const times = rates.get(input.deviceId) || []
      if (times.length >= GATEWAY_LIMITS.requestsPerMinute) reject('rate_limited', 429)
      if (reads.size >= GATEWAY_LIMITS.pendingReads) reject('read_capacity_reached', 429)
      readStarts.set(nonceKey, {
        deviceId: input.deviceId,
        expiresAt: issuedAt + GATEWAY_LIMITS.readTTL,
      })
      rates.set(input.deviceId, [...times, clock()])
      const requestId = `read-${randomUUID()}`
      const challenge = {
        purpose: 'today.mock.read.v1',
        issuer,
        requestId,
        nonce: randomBytes(32).toString('base64url'),
        deviceId: input.deviceId,
        workspaceId: device.workspaceId,
        grantVersion: device.grantVersion,
        operation: input.operation,
        date: input.date,
        timeZone: input.timeZone,
        expiresAt: new Date(clock() + GATEWAY_LIMITS.readTTL).toISOString(),
      }
      reads.set(requestId, { deviceId: input.deviceId, challenge })
      return structuredClone(challenge)
    },
    async completeRead(request) {
      assertOpen()
      cleanup()
      const input = snapshotInput(request)
      exactObject(input, ['requestId', 'signature'])
      const read = reads.get(identifier(input.requestId))
      if (!read) reject('read_challenge_expired_or_consumed', 403)
      reads.delete(input.requestId)
      const before = registered(read.deviceId)
      if (
        before.grantVersion !== read.challenge.grantVersion ||
        !verified(before.key, read.challenge, input.signature)
      )
        reject('invalid_device_proof', 403)
      const workspace = await load(before.workspaceId)
      // Re-check after asynchronous storage: revocation must also stop an in-flight response.
      assertOpen()
      const after = registered(read.deviceId)
      if (after !== before || Date.parse(read.challenge.expiresAt) <= clock())
        reject('read_challenge_expired_or_consumed', 403)
      if (!workspace) reject('workspace_missing', 404)
      if (Date.parse(workspace.data.expiresAt) <= clock()) reject('source_expired', 410)
      const overview = assembleOverview(
        workspace.data,
        read.challenge.date,
        read.challenge.timeZone,
        clock(),
      )
      const metadata = {
        contractVersion: 'today.mock.gateway.v1',
        fixtureOnly: true,
        workspaceId: before.workspaceId,
        revision: workspace.revision,
        capturedAt: workspace.data.capturedAt,
        expiresAt: workspace.data.expiresAt,
      }
      const result =
        read.challenge.operation === 'overview'
          ? { ...metadata, overview }
          : read.challenge.operation === 'tasks'
            ? { ...metadata, tasks: overview.tasks }
            : { ...metadata, events: overview.events, calendar: overview.sources.calendar }
      record('fixture_read_completed', {
        workspaceId: before.workspaceId,
        deviceId: read.deviceId,
        operation: read.challenge.operation,
        revision: workspace.revision,
      })
      return structuredClone(result)
    },
  })
  return {
    client,
    owners,
    audit: () => ({ entries: structuredClone(audit), omittedEntries: omittedAuditEntries }),
    diagnostics: () => ({
      mode: 'offline_fixture_only',
      pendingPairs: pairs.size,
      devices: devices.size,
      pendingReads: reads.size,
      readInitReceipts: readStarts.size,
      queuedWrites: queued,
      closed,
    }),
    async close() {
      if (closed) {
        await queue
        return
      }
      closed = true
      pairs.clear()
      devices.clear()
      reads.clear()
      readStarts.clear()
      rates.clear()
      await queue
      await store.releaseWriter(lease)
    },
  }
}
