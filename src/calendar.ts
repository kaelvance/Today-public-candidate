import type { Item } from './types'

export type CalendarConnection = 'disconnected' | 'connected' | 'expired'
export interface CalendarStatus {
  configured: boolean
  connection: CalendarConnection
}
export interface CalendarPayload {
  events: unknown[]
  fetchedAt: string
  truncated: boolean
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const iso = (value: unknown): string | undefined =>
  typeof value === 'string' && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toISOString()
    : undefined

function eventDate(value: unknown): { date?: string; allDay: boolean } {
  if (!record(value)) return { allDay: false }
  if (typeof value.dateTime === 'string') return { date: iso(value.dateTime), allDay: false }
  if (typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    const [year, month, day] = value.date.split('-').map(Number)
    const local = new Date(year, month - 1, day)
    if (local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === day)
      return { date: local.toISOString(), allDay: true }
  }
  return { allDay: false }
}

export function normalizeCalendarEvents(values: unknown[], fetchedAt: string): Item[] {
  const byId = new Map<string, Item>()
  const updatedAt = iso(fetchedAt) || new Date().toISOString()
  for (const value of values) {
    if (!record(value) || typeof value.id !== 'string' || !value.id || value.status === 'cancelled')
      continue
    const start = eventDate(value.start)
    if (!start.date) continue
    const end = eventDate(value.end)
    const externalId = value.id.slice(0, 200)
    const timestamp = iso(value.updated) || updatedAt
    byId.set(externalId, {
      id: `google-calendar:${externalId}`,
      externalId,
      kind: 'event',
      title:
        typeof value.summary === 'string' && value.summary.trim()
          ? value.summary.trim().slice(0, 200)
          : '予定',
      description: '',
      source: 'Google Calendar',
      sourceId: 'google-calendar',
      createdAt: iso(value.created) || timestamp,
      startAt: start.date,
      endAt: end.date,
      allDay: start.allDay,
      importance: 2,
      pinned: false,
      requiresAction: false,
      confidence: 'high',
      status: 'active',
      syncStatus: 'synced',
      lastUpdated: timestamp,
      sourceUpdatedAt: timestamp,
      demo: false,
      actions: [
        {
          id: 'view',
          label: '詳細を見る',
          type: 'view',
          riskLevel: 0,
          requiresConfirmation: false,
          plugin: 'google-calendar',
        },
      ],
    })
  }
  const ordered = [...byId.values()].sort(
    (a, b) => (a.startAt || '').localeCompare(b.startAt || '') || a.id.localeCompare(b.id),
  )
  for (let first = 0; first < ordered.length; first += 1) {
    const event = ordered[first]
    if (event.allDay || !event.endAt) continue
    for (let second = first + 1; second < ordered.length; second += 1) {
      const following = ordered[second]
      if (new Date(following.startAt!).getTime() >= new Date(event.endAt).getTime()) break
      if (following.allDay || !following.endAt) continue
      if (new Date(following.endAt).getTime() > new Date(event.startAt!).getTime()) {
        event.conflict = true
        following.conflict = true
      }
    }
  }
  return ordered
}

export function mergeCalendarItems(current: Item[], fresh: Item[]): Item[] {
  const old = new Map(
    current.filter((item) => item.sourceId === 'google-calendar').map((item) => [item.id, item]),
  )
  return [
    ...current.filter((item) => item.sourceId !== 'google-calendar'),
    ...fresh.map((item) => {
      const previous = old.get(item.id)
      return previous
        ? {
            ...item,
            importance: previous.importance,
            pinned: previous.pinned,
            snoozedUntil: previous.snoozedUntil,
            status: previous.status,
          }
        : item
    }),
  ]
}

async function request<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'POST' ? { 'X-Today-Request': '1' } : undefined,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('invalid_response')
  }
  if (!response.ok)
    throw new Error(record(body) && typeof body.error === 'string' ? body.error : 'request_failed')
  return body as T
}

export const calendarApi = {
  status: () => request<CalendarStatus>('/api/calendar/status'),
  events: () => request<CalendarPayload>('/api/calendar/events'),
  connect: () => request<{ url: string }>('/api/calendar/connect', 'POST'),
  disconnect: () => request<{ revoked: boolean }>('/api/calendar/disconnect', 'POST'),
}
