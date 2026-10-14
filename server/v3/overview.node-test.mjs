import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:net'
import { createTodayServer } from '../index.mjs'
import {
  assembleOverview,
  createOverviewGateway,
  validateSnapshot,
  validateQuery,
} from './overview.mjs'

const nowMs = Date.parse('2026-10-10T00:00:00.000Z')
const fixture = () => ({
  schemaVersion: 1,
  capturedAt: new Date(nowMs).toISOString(),
  expiresAt: new Date(nowMs + 300_000).toISOString(),
  tasks: [
    {
      id: 'fictional-task',
      title: '架空の資料を確認する',
      sourceTime: '2026-10-09T00:00:00.000Z',
      dueAt: '2026-10-10T02:00:00.000Z',
      importance: 3,
    },
  ],
  events: [],
  calendar: { state: 'unconfigured', retrievedAt: null },
})
const payload = (snapshot = fixture()) => ({
  consent: true,
  scopes: ['brief:read', 'tasks:read', 'agenda:read'],
  snapshot,
})
const event = (properties) => ({
  id: 'fictional-event',
  title: '架空の予定',
  sourceTime: '2026-10-09T00:00:00.000Z',
  source: 'manual',
  allDay: false,
  startAt: '2026-10-10T00:00:00.000Z',
  endAt: null,
  startDate: null,
  endDate: null,
  ...properties,
})

test('overview is deterministic, limited to selections, and missing providers stay null', () => {
  const snapshot = validateSnapshot(fixture(), nowMs)
  const result = assembleOverview(snapshot, '2026-10-10', 'Asia/Tokyo', nowMs)
  assert.equal(result.counts.dueToday, 1)
  assert.equal(result.counts.calendarEvents, null)
  assert.equal(result.counts.mail, null)
  assert.equal(result.counts.weather, null)
  assert.equal(result.coverage, 'selected_only')
  assert.deepEqual(result, assembleOverview(snapshot, '2026-10-10', 'Asia/Tokyo', nowMs))
})
test('DST days, overlapping events, midnight exclusive ends and floating all-day dates', () => {
  const snapshot = {
    ...fixture(),
    events: [
      event({
        id: 'dst-crossing',
        startAt: '2026-03-08T06:30:00.000Z',
        endAt: '2026-03-08T08:30:00.000Z',
      }),
      event({
        id: 'midnight-exclusive',
        startAt: '2026-03-07T12:00:00.000Z',
        endAt: '2026-03-08T05:00:00.000Z',
      }),
      event({
        id: 'all-day',
        allDay: true,
        startAt: null,
        endAt: null,
        startDate: '2026-03-07',
        endDate: '2026-03-09',
      }),
    ],
  }
  const r = assembleOverview(
    validateSnapshot(snapshot, nowMs),
    '2026-03-08',
    'America/New_York',
    nowMs,
  )
  assert.deepEqual(
    r.events.map((e) => e.id),
    ['all-day', 'dst-crossing'],
  )
  assert.equal(assembleOverview(snapshot, '2026-03-09', 'America/New_York', nowMs).events.length, 0)
  const fall = {
    ...snapshot,
    events: [event({ startAt: '2026-11-01T05:30:00.000Z', endAt: '2026-11-01T06:30:00.000Z' })],
  }
  assert.equal(assembleOverview(fall, '2026-11-01', 'America/New_York', nowMs).events.length, 1)
})
test('due dates are evaluated in the requested timezone and priority remains explicit', () => {
  const snapshot = fixture()
  snapshot.tasks.push({ ...snapshot.tasks[0], id: 'higher', importance: 2, dueAt: null })
  assert.equal(
    assembleOverview(snapshot, '2026-10-09', 'America/Los_Angeles', nowMs).tasks[0].group,
    'due_today',
  )
  assert.equal(
    assembleOverview(snapshot, '2026-10-11', 'Asia/Tokyo', nowMs).tasks[0].group,
    'overdue',
  )
})
test('invalid query, impossible instants, duplicate IDs, excess records and unknown secrets fail closed', () => {
  for (const d of ['2026-02-30', '0000-01-01', '2026-2-01', 'today'])
    assert.throws(() => validateQuery(d, 'UTC'))
  assert.throws(() => validateQuery('2026-10-10', 'fictional/timezone'))
  for (const changes of [
    { token: 'fictional-not-a-secret' },
    { tasks: Array(251).fill(fixture().tasks[0]) },
    { tasks: [{ ...fixture().tasks[0], sourceTime: '2026-02-30T00:00:00.000Z' }] },
    { tasks: [{ ...fixture().tasks[0], description: 'private content' }] },
    { tasks: [fixture().tasks[0], fixture().tasks[0]] },
  ])
    assert.throws(() => validateSnapshot({ ...fixture(), ...changes }, nowMs))
  assert.throws(() =>
    validateSnapshot({ ...fixture(), expiresAt: new Date(nowMs + 301_000).toISOString() }, nowMs),
  )
})
test('stale and partial calendars retain evidence but never imply complete zero results', () => {
  const snapshot = fixture()
  snapshot.calendar = { state: 'ready', retrievedAt: '2026-10-09T23:40:00.000Z' }
  assert.equal(validateSnapshot(snapshot, nowMs).calendar.state, 'stale')
  snapshot.calendar = { state: 'partial', retrievedAt: new Date(nowMs).toISOString() }
  assert.equal(
    assembleOverview(validateSnapshot(snapshot, nowMs), '2026-10-10', 'UTC', nowMs).counts
      .calendarEvents,
    null,
  )
})
test('consent, exact read scopes, session isolation, revocation, TTL and bounded capacity', () => {
  let clock = nowMs
  const g = createOverviewGateway({ now: () => new Date(clock), maxSessions: 1 })
  assert.throws(() => g.publish('a', { ...payload(), consent: false }), /consent_required/)
  assert.throws(() => g.publish('a', { ...payload(), scopes: ['tasks:write'] }), /consent_required/)
  g.publish('a', payload())
  assert.throws(() => g.read('b', '2026-10-10', 'UTC'), /snapshot_required/)
  assert.throws(() => g.publish('b', payload()), /capacity_reached/)
  g.revoke('a')
  assert.throws(() => g.read('a', '2026-10-10', 'UTC'), /snapshot_required/)
  g.publish('a', payload())
  clock += 300_000
  assert.throws(() => g.read('a', '2026-10-10', 'UTC'), /snapshot_required/)
  g.clear()
})
test('repeated publication is bounded and a rejected snapshot does not replace an approved one', () => {
  const g = createOverviewGateway({ now: () => new Date(nowMs) })
  g.publish('a', payload())
  assert.throws(() => g.publish('a', payload({ ...fixture(), token: 'fictional' })))
  assert.equal(g.read('a', '2026-10-10', 'UTC').tasks[0].title, fixture().tasks[0].title)
  for (let i = 0; i < 10; i++) g.publish('a', payload())
  assert.throws(() => g.publish('a', payload()), /rate_limited/)
})

async function withServer(enabled, operation) {
  const reserve = createServer()
  await new Promise((r) => reserve.listen(0, '127.0.0.1', r))
  const port = reserve.address().port
  await new Promise((r) => reserve.close(r))
  const app = await createTodayServer({
    production: true,
    port,
    env: { TODAY_V3_OVERVIEW: enabled ? '1' : '0' },
    now: () => new Date(nowMs),
    fetchImpl: () => {
      throw new Error('external_network_forbidden')
    },
  })
  const base = await app.listen()
  try {
    await operation(base)
  } finally {
    await app.close()
  }
}
test('HTTP policy rejects anonymous, cross-session, cross-origin and caller-selected tenant access', async () => {
  await withServer(true, async (base) => {
    const bootstrap = await fetch(`${base}/api/v3/status`)
    const cookie = bootstrap.headers.get('set-cookie').split(';')[0]
    const headers = {
      cookie,
      origin: base,
      'x-today-request': '1',
      'content-type': 'application/json',
    }
    assert.equal((await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC`)).status, 403)
    assert.equal(
      (
        await fetch(`${base}/v3/workspace-snapshot`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload()),
        })
      ).status,
      200,
    )
    const ok = await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC`, { headers })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.equal((await ok.json()).counts.dueToday, 1)
    assert.equal(
      (await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC&tenant_id=other`, { headers }))
        .status,
      400,
    )
    assert.equal(
      (
        await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC`, {
          headers: { ...headers, origin: 'https://example.invalid' },
        })
      ).status,
      403,
    )
    const otherCookie = (await fetch(`${base}/api/v3/status`)).headers
      .get('set-cookie')
      .split(';')[0]
    assert.equal(
      (
        await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC`, {
          headers: { ...headers, cookie: otherCookie },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await fetch(`${base}/api/v3/overview?date=2026-10-10&tz=UTC`, {
          headers: { cookie, 'x-today-request': '1', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await fetch(`${base}/v3/workspace-snapshot`, {
          method: 'DELETE',
          headers: { ...headers, origin: 'https://example.invalid' },
        })
      ).status,
      403,
    )
    assert.equal(
      (await fetch(`${base}/api/v3/workspace-snapshot`, { method: 'DELETE', headers })).status,
      200,
    )
    assert.equal(
      (await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC`, { headers })).status,
      403,
    )
    assert.equal(
      (await fetch(`${base}/v3/tasks`, { method: 'POST', headers, body: '{}' })).status,
      405,
    )
  })
})
test('V3 is off by default and malformed/oversized input never triggers provider calls', async () => {
  await withServer(false, async (base) =>
    assert.equal((await fetch(`${base}/v3/overview?date=2026-10-10&tz=UTC`)).status, 404),
  )
  await withServer(true, async (base) => {
    const cookie = (await fetch(`${base}/api/v3/status`)).headers.get('set-cookie').split(';')[0]
    const headers = {
      cookie,
      origin: base,
      'x-today-request': '1',
      'content-type': 'application/json',
    }
    for (const body of [
      '{',
      JSON.stringify({ padding: 'x'.repeat(66_000) }),
      JSON.stringify({ ...payload(), consent: false }),
    ]) {
      assert.ok(
        (await fetch(`${base}/v3/workspace-snapshot`, { method: 'POST', headers, body })).status >=
          400,
      )
    }
    assert.equal((await fetch(`${base}/api/v3/status`)).status, 200)
  })
})
