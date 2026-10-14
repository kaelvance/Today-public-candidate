import { createHash, randomUUID } from 'node:crypto'

export const OVERVIEW_SCOPES = Object.freeze(['brief:read', 'tasks:read', 'agenda:read'])
export const SNAPSHOT_TTL = 300_000
const calendarStates = ['ready', 'partial', 'stale', 'unavailable', 'disconnected', 'unconfigured']
const fail = (code = 'invalid_snapshot', status = 400) => {
  const error = new Error(code)
  error.status = status
  throw error
}
const fields = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  if (Object.keys(value).some((key) => !keys.includes(key))) fail()
}
const text = (value, max) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    fail()
  return value
}
export function validDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1000
  )
    fail('invalid_query')
  const d = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('invalid_query')
  return value
}
function instant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(value)
  )
    fail()
  const d = new Date(value)
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')
  )
    fail()
  return value
}
export function dayInZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type) => parts.find((p) => p.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function validateQuery(date, timeZone) {
  validDate(date)
  if (typeof timeZone !== 'string' || timeZone.length > 80) fail('invalid_query')
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0))
  } catch {
    fail('invalid_query')
  }
  return { date, timeZone }
}

// A bounded, explicitly selected projection. This never reads IndexedDB or a provider.
export function validateSnapshot(input, nowMs) {
  fields(input, ['schemaVersion', 'capturedAt', 'expiresAt', 'tasks', 'events', 'calendar'])
  if (input.schemaVersion !== 1) fail()
  const capturedAt = instant(input.capturedAt),
    expiresAt = instant(input.expiresAt)
  const capturedMs = Date.parse(capturedAt),
    expiresMs = Date.parse(expiresAt)
  if (
    capturedMs > nowMs + 30_000 ||
    capturedMs < nowMs - SNAPSHOT_TTL ||
    expiresMs <= nowMs ||
    expiresMs > nowMs + SNAPSHOT_TTL ||
    expiresMs <= capturedMs ||
    expiresMs > capturedMs + SNAPSHOT_TTL
  )
    fail('snapshot_expired', 410)
  if (
    !Array.isArray(input.tasks) ||
    !Array.isArray(input.events) ||
    input.tasks.length + input.events.length > 250
  )
    fail()
  const ids = new Set()
  const identity = (item) => {
    const id = text(item.id, 160),
      title = text(item.title, 240),
      sourceTime = instant(item.sourceTime)
    if (!/^[A-Za-z0-9_.:@/-]+$/.test(id) || ids.has(id)) fail()
    ids.add(id)
    return { id, title, sourceTime }
  }
  const tasks = input.tasks.map((item) => {
    fields(item, ['id', 'title', 'sourceTime', 'dueAt', 'importance'])
    const common = identity(item)
    if (![1, 2, 3].includes(item.importance)) fail()
    return {
      ...common,
      dueAt: item.dueAt === null ? null : instant(item.dueAt),
      importance: item.importance,
    }
  })
  const events = input.events.map((item) => {
    fields(item, [
      'id',
      'title',
      'sourceTime',
      'source',
      'allDay',
      'startAt',
      'endAt',
      'startDate',
      'endDate',
    ])
    const common = identity(item)
    if (!['manual', 'google-calendar'].includes(item.source) || typeof item.allDay !== 'boolean')
      fail()
    if (item.allDay) {
      if (item.startAt !== null || item.endAt !== null) fail()
      const startDate = validDate(item.startDate),
        endDate = validDate(item.endDate)
      if (endDate <= startDate) fail()
      return {
        ...common,
        source: item.source,
        allDay: true,
        startAt: null,
        endAt: null,
        startDate,
        endDate,
      }
    }
    if (item.startDate !== null || item.endDate !== null) fail()
    const startAt = instant(item.startAt),
      endAt = item.endAt === null ? null : instant(item.endAt)
    if (endAt && endAt <= startAt) fail()
    return {
      ...common,
      source: item.source,
      allDay: false,
      startAt,
      endAt,
      startDate: null,
      endDate: null,
    }
  })
  fields(input.calendar, ['state', 'retrievedAt'])
  if (!calendarStates.includes(input.calendar.state)) fail()
  const retrievedAt =
    input.calendar.retrievedAt === null ? null : instant(input.calendar.retrievedAt)
  if (['ready', 'partial', 'stale'].includes(input.calendar.state) && !retrievedAt) fail()
  if (retrievedAt && Date.parse(retrievedAt) > nowMs + 30_000) fail()
  if (
    ['unconfigured', 'disconnected'].includes(input.calendar.state) &&
    events.some((item) => item.source === 'google-calendar')
  )
    fail()
  // Provider freshness comes from the browser's last retrieval, never from upload time.
  const state =
    input.calendar.state === 'ready' && nowMs - Date.parse(retrievedAt) > SNAPSHOT_TTL
      ? 'stale'
      : input.calendar.state
  return {
    schemaVersion: 1,
    capturedAt,
    expiresAt,
    tasks,
    events,
    calendar: { state, retrievedAt },
  }
}

export function assembleOverview(snapshot, date, timeZone, nowMs) {
  validateQuery(date, timeZone)
  const tasks = snapshot.tasks
    .map((item) => {
      const dueDate = item.dueAt ? dayInZone(item.dueAt, timeZone) : null
      const group =
        dueDate === null
          ? 'unscheduled'
          : dueDate < date
            ? 'overdue'
            : dueDate === date
              ? 'due_today'
              : 'later'
      const reasons = {
        overdue: '期限を過ぎています',
        due_today: '今日が期限です',
        unscheduled: '期限は未設定です',
        later: '期限は明日以降です',
      }
      return { ...item, group, reason: reasons[group] }
    })
    .sort((a, b) => {
      const order = ['overdue', 'due_today', 'unscheduled', 'later']
      return (
        order.indexOf(a.group) - order.indexOf(b.group) ||
        b.importance - a.importance ||
        (a.dueAt || '').localeCompare(b.dueAt || '') ||
        a.id.localeCompare(b.id)
      )
    })
  const events = snapshot.events
    .filter((event) => {
      if (event.allDay) return event.startDate <= date && event.endDate > date
      const first = dayInZone(event.startAt, timeZone)
      // Subtract one millisecond because an end at midnight is exclusive; DST uses IANA rules.
      const last = event.endAt ? dayInZone(Date.parse(event.endAt) - 1, timeZone) : first
      return first <= date && last >= date
    })
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        (a.startAt || a.startDate).localeCompare(b.startAt || b.startDate) ||
        a.id.localeCompare(b.id),
    )
  const overdue = tasks.filter((item) => item.group === 'overdue').length
  const dueToday = tasks.filter((item) => item.group === 'due_today').length
  const expired = Date.parse(snapshot.expiresAt) <= nowMs
  const calendarState =
    snapshot.calendar.state === 'ready' &&
    nowMs - Date.parse(snapshot.calendar.retrievedAt) > SNAPSHOT_TTL
      ? 'stale'
      : snapshot.calendar.state
  const warnings = [
    '選択したデータだけのサマリーです。Today全体・Google Calendar全体の件数ではありません。',
  ]
  if (calendarState !== 'ready')
    warnings.push('Google Calendarは未確認または不完全です。未取得分を0件とは扱いません。')
  if (expired)
    warnings.push('このスナップショットは期限切れです。最新のデータを選び直してください。')
  return {
    schemaVersion: 1,
    contractVersion: 'today.overview.v1',
    coverage: 'selected_only',
    date,
    timeZone,
    generatedAt: new Date(nowMs).toISOString(),
    capturedAt: snapshot.capturedAt,
    expiresAt: snapshot.expiresAt,
    snapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    sources: {
      local: { state: expired ? 'stale' : 'ready', retrievedAt: snapshot.capturedAt },
      calendar: { state: calendarState, retrievedAt: snapshot.calendar.retrievedAt },
      mail: { state: 'unavailable', retrievedAt: null },
      weather: { state: 'unavailable', retrievedAt: null },
    },
    counts: {
      overdue,
      dueToday,
      tasksSelected: tasks.length,
      manualEvents: events.filter((e) => e.source === 'manual').length,
      calendarEvents:
        calendarState === 'ready'
          ? events.filter((e) => e.source === 'google-calendar').length
          : null,
      mail: null,
      weather: null,
    },
    summary: `選択したタスク: ${tasks.length}件。今日の期限: ${dueToday}件、期限超過: ${overdue}件。選択した予定: ${events.length}件。`,
    warnings,
    tasks,
    events,
  }
}

// Loopback browser session policy only. It is not a user account or remote-device identity.
export function createOverviewGateway({ now = () => new Date(), maxSessions = 32 } = {}) {
  const snapshots = new Map(),
    requests = new Map(),
    timers = new Map()
  const remove = (id) => {
    snapshots.delete(id)
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  const sweep = () => {
    const ms = now().getTime()
    for (const [id, snapshot] of snapshots) if (Date.parse(snapshot.expiresAt) <= ms) remove(id)
    for (const [id, times] of requests) if (!times.some((t) => t > ms - 60_000)) requests.delete(id)
    return ms
  }
  return {
    publish(id, body) {
      const ms = sweep()
      fields(body, ['consent', 'scopes', 'snapshot'])
      if (
        body.consent !== true ||
        !Array.isArray(body.scopes) ||
        body.scopes.length !== OVERVIEW_SCOPES.length ||
        !OVERVIEW_SCOPES.every((s, i) => s === body.scopes[i])
      )
        fail('consent_required', 403)
      const times = (requests.get(id) || []).filter((t) => t > ms - 60_000)
      if (times.length >= 12) fail('rate_limited', 429)
      if (!requests.has(id) && requests.size >= maxSessions) fail('capacity_reached', 503)
      requests.set(id, [...times, ms])
      const snapshot = validateSnapshot(body.snapshot, ms)
      if (!snapshots.has(id) && snapshots.size >= maxSessions) fail('capacity_reached', 503)
      remove(id)
      snapshots.set(id, snapshot)
      const timer = setTimeout(() => remove(id), Date.parse(snapshot.expiresAt) - ms)
      timer.unref()
      timers.set(id, timer)
      return { expiresAt: snapshot.expiresAt, scopes: OVERVIEW_SCOPES, coverage: 'selected_only' }
    },
    read(id, date, timeZone) {
      const ms = sweep(),
        snapshot = snapshots.get(id)
      if (!snapshot) fail('snapshot_required', 403)
      return assembleOverview(snapshot, date, timeZone, ms)
    },
    revoke(id) {
      remove(id)
      return { revoked: true }
    },
    clear() {
      snapshots.clear()
      requests.clear()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}

export async function handleOverviewRequest({
  req,
  res,
  url,
  baseUrl,
  enabled,
  gateway,
  validSession,
  readJson,
  send,
}) {
  if (url.pathname === '/api/v3/status' && req.method === 'GET') {
    send(res, 200, { enabled, contractVersion: 'today.overview.v1', mode: 'local-session-preview' })
    return true
  }
  const path = url.pathname.replace(/^\/api(?=\/v3\/)/, '')
  if (!path.startsWith('/v3/')) return false
  const requestId = randomUUID()
  res.setHeader('X-Request-ID', requestId)
  res.setHeader('X-Today-Contract', 'today.overview.v1')
  try {
    if (!enabled) fail('v3_disabled', 404)
    const sid = validSession(req)
    const sameOrigin =
      req.headers.origin === baseUrl ||
      (req.method === 'GET' &&
        !req.headers.origin &&
        req.headers['sec-fetch-site'] === 'same-origin')
    if (!sid || !sameOrigin || req.headers['x-today-request'] !== '1') fail('request_denied', 403)
    const queryKeys = [...url.searchParams.keys()]
    if (path === '/v3/overview' && req.method === 'GET') {
      if (queryKeys.length !== 2 || !queryKeys.includes('date') || !queryKeys.includes('tz'))
        fail('invalid_query')
      send(res, 200, gateway.read(sid, url.searchParams.get('date'), url.searchParams.get('tz')))
    } else if (path === '/v3/workspace-snapshot' && req.method === 'POST') {
      if (queryKeys.length || req.headers['content-type'] !== 'application/json')
        fail('invalid_snapshot')
      send(res, 200, gateway.publish(sid, await readJson(req, 65_536)))
    } else if (path === '/v3/workspace-snapshot' && req.method === 'DELETE') {
      if (queryKeys.length) fail('invalid_query')
      send(res, 200, gateway.revoke(sid))
    } else fail('method_not_allowed', 405)
  } catch (error) {
    const code = error.status ? error.message : 'invalid_snapshot'
    send(res, error.status || 400, {
      code,
      message: '日次サマリーを取得できません。選択・権限・期限を確認してください。',
      requestId,
      retryable: [429, 503].includes(error.status),
    })
  }
  return true
}
