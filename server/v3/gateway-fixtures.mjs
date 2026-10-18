import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { proofBytes, readInitMessage, READ_SCOPES } from './gateway-contract.mjs'

const fixtureSessions = new WeakMap()
const defaultClock = Date.parse('2026-10-11T00:00:00.000Z')

// Ephemeral test keys, kept only in this fixture client's closure. No owner credentials.
export function fixtureDevice() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return Object.freeze({
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    signature: (challenge) => sign(null, proofBytes(challenge), privateKey).toString('base64url'),
  })
}
export function fixtureProjection(nowMs, suffix = 'a') {
  return {
    schemaVersion: 1,
    capturedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 300_000).toISOString(),
    tasks: [
      {
        id: `fixture-task-${suffix}`,
        title: `架空の確認タスク ${suffix}`,
        sourceTime: new Date(nowMs - 3_600_000).toISOString(),
        dueAt: new Date(nowMs + 7_200_000).toISOString(),
        importance: 2,
      },
    ],
    events: [
      {
        id: `fixture-event-${suffix}`,
        title: `架空の打合せ ${suffix}`,
        sourceTime: new Date(nowMs - 3_600_000).toISOString(),
        source: 'manual',
        allDay: false,
        startAt: new Date(nowMs + 3_600_000).toISOString(),
        endAt: new Date(nowMs + 5_400_000).toISOString(),
        startDate: null,
        endDate: null,
      },
    ],
    calendar: { state: 'unconfigured', retrievedAt: null },
  }
}
export function enrollFixture(gateway, owner, device, approvedScopes = READ_SCOPES) {
  const ticket = gateway.client.requestPairing({
    publicKey: device.publicKey,
    label: '架空の試験端末',
  })
  owner.approvePairing({
    ticketId: ticket.ticketId,
    fingerprint: ticket.fingerprint,
    scopes: [...approvedScopes],
  })
  const { challenge } = gateway.client.pairingChallenge(ticket.ticketId)
  const grant = gateway.client.completePairing({
    ticketId: ticket.ticketId,
    signature: device.signature(challenge),
  })
  if (!fixtureSessions.has(gateway)) fixtureSessions.set(gateway, new Map())
  fixtureSessions.get(gateway).set(grant.deviceId, { device, grant })
  return grant
}
export function fixtureReadInit(gateway, deviceId, operation = 'overview', nowMs = defaultClock) {
  const session = fixtureSessions.get(gateway)?.get(deviceId)
  if (!session) throw new Error('fixture_device_not_enrolled')
  const request = {
    deviceId,
    operation,
    date: '2026-10-11',
    timeZone: 'Asia/Tokyo',
    clientNonce: randomBytes(32).toString('base64url'),
    issuedAt: new Date(nowMs).toISOString(),
  }
  return {
    ...request,
    signature: session.device.signature(readInitMessage(session.grant.issuer, request)),
  }
}
export function readFixture(
  gateway,
  device,
  deviceId,
  operation = 'overview',
  nowMs = defaultClock,
) {
  const challenge = gateway.client.beginRead(fixtureReadInit(gateway, deviceId, operation, nowMs))
  return gateway.client.completeRead({
    requestId: challenge.requestId,
    signature: device.signature(challenge),
  })
}
