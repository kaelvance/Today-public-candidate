import { createHash } from 'node:crypto'
import { OVERVIEW_SCOPES, validateSnapshot } from './overview.mjs'

export const GATEWAY_LIMITS = Object.freeze({
  pairTTL: 120_000,
  readTTL: 30_000,
  grantTTL: 900_000,
  workspaces: 8,
  devices: 32,
  pendingPairs: 32,
  pendingReads: 64,
  requestsPerMinute: 30,
  receipts: 32,
  queuedWrites: 16,
  auditEntries: 200,
  backupBytes: 131_072,
})
export const READ_SCOPES = OVERVIEW_SCOPES

export function reject(code, status = 400) {
  const error = new Error(code)
  error.code = code
  error.status = status
  throw error
}
export function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('invalid_input')
  if (Object.getPrototypeOf(value) !== Object.prototype) reject('invalid_input')
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    reject('invalid_input')
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) reject('invalid_input')
  return value
}
export function workspaceId(value) {
  if (typeof value !== 'string' || !/^fixture-[a-z0-9-]{1,48}$/.test(value))
    reject('fixture_workspace_required')
  return value
}
export function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    reject('invalid_input')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) reject('invalid_input')
  return value
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) reject('invalid_revision')
  return value
}
export function scopes(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > READ_SCOPES.length ||
    new Set(value).size !== value.length ||
    value.some((scope) => !READ_SCOPES.includes(scope))
  )
    reject('invalid_scope')
  return READ_SCOPES.filter((scope) => value.includes(scope))
}
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export const digest = (value) => createHash('sha256').update(stableJSON(value)).digest('hex')
export function boundedJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > GATEWAY_LIMITS.backupBytes)
    reject('input_too_large', 413)
  try {
    return JSON.parse(text)
  } catch {
    reject('invalid_json')
  }
}

// Validate persisted projections independently of expiry. Expiry is an access gate, not corruption.
export function storedProjection(value, nowMs) {
  if (!value || typeof value !== 'object') reject('invalid_input')
  const capture = Date.parse(instant(value.capturedAt))
  if (capture > nowMs + 30_000) reject('future_source')
  let data
  try {
    data = validateSnapshot(value, capture)
  } catch {
    reject('invalid_projection')
  }
  if (
    [...data.tasks, ...data.events].some((item) => Date.parse(item.sourceTime) > capture + 30_000)
  )
    reject('future_source')
  if (Buffer.byteLength(stableJSON(data)) > 65_536) reject('input_too_large', 413)
  return data
}
export function storedWorkspace(value, expectedId, nowMs) {
  exactObject(value, [
    'schemaVersion',
    'fixtureOnly',
    'workspaceId',
    'revision',
    'updatedAt',
    'data',
    'receipts',
  ])
  if (value.schemaVersion !== 1 || value.fixtureOnly !== true) reject('invalid_workspace')
  if (workspaceId(value.workspaceId) !== expectedId) reject('workspace_mismatch', 403)
  revision(value.revision)
  if (value.revision === 0) reject('invalid_workspace')
  const updatedAt = instant(value.updatedAt)
  if (Date.parse(updatedAt) > nowMs + 30_000) reject('future_source')
  const data = storedProjection(value.data, nowMs)
  if (Date.parse(data.capturedAt) > Date.parse(updatedAt) + 30_000) reject('future_source')
  if (!Array.isArray(value.receipts) || value.receipts.length > GATEWAY_LIMITS.receipts)
    reject('invalid_receipts')
  const seen = new Set()
  const receipts = value.receipts.map((entry) => {
    exactObject(entry, ['operationId', 'requestHash', 'revision'])
    identifier(entry.operationId)
    if (
      seen.has(entry.operationId) ||
      typeof entry.requestHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.requestHash)
    )
      reject('invalid_receipts')
    seen.add(entry.operationId)
    revision(entry.revision)
    if (!entry.revision || entry.revision > value.revision) reject('invalid_receipts')
    return { ...entry }
  })
  return {
    schemaVersion: 1,
    fixtureOnly: true,
    workspaceId: expectedId,
    revision: value.revision,
    updatedAt,
    data,
    receipts,
  }
}
export function backupDocument(text, expectedId, nowMs) {
  const input = boundedJSON(text)
  exactObject(input, ['format', 'fixtureOnly', 'workspaceId', 'createdAt', 'workspace', 'sha256'])
  if (input.format !== 'today.gateway.fixture-backup.v1' || input.fixtureOnly !== true)
    reject('invalid_backup')
  if (workspaceId(input.workspaceId) !== expectedId) reject('workspace_mismatch', 403)
  if (Date.parse(instant(input.createdAt)) > nowMs + 30_000) reject('future_source')
  const workspace = storedWorkspace(input.workspace, expectedId, nowMs)
  if (typeof input.sha256 !== 'string' || input.sha256 !== digest(workspace))
    reject('backup_checksum_mismatch')
  return workspace
}

// These bytes are also used by the independent fixture client. The purpose/issuer prevents cross-protocol replay.
export function proofBytes(challenge) {
  return Buffer.from(stableJSON(challenge), 'utf8')
}
export function readInitMessage(issuer, request) {
  return {
    purpose: 'today.mock.read-init.v1',
    issuer,
    deviceId: request.deviceId,
    operation: request.operation,
    date: request.date,
    timeZone: request.timeZone,
    clientNonce: request.clientNonce,
    issuedAt: request.issuedAt,
  }
}
