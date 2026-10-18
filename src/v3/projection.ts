import type { Item, PersistedState } from '../types'
import type { CalendarUi } from '../ConnectedServices'
import type { SourceFreshness, WorkspaceSnapshot } from './contracts'

export const selectableOverviewItems = (items: Item[]) =>
  items.filter(
    (item) =>
      !item.demo &&
      item.status === 'active' &&
      ((item.kind === 'task' && item.sourceId === 'manual') ||
        (item.kind === 'event' &&
          ['manual', 'google-calendar'].includes(item.sourceId) &&
          !!item.startAt)),
  )
const calendarFreshness = (calendar: CalendarUi, retrievedAt?: string): SourceFreshness => {
  if (!calendar.configured) return { state: 'unconfigured', retrievedAt: null }
  if (calendar.connection !== 'connected') return { state: 'disconnected', retrievedAt: null }
  if (!retrievedAt) return { state: 'unavailable', retrievedAt: null }
  if (calendar.phase !== 'synced') return { state: 'stale', retrievedAt }
  return { state: calendar.error ? 'partial' : 'ready', retrievedAt }
}
const utcProjection = (value: string) => {
  if (
    !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new Error('日時の形式を確認してください。元の日時を推測して共有しません。')
  return value.endsWith('Z') ? value : new Date(value).toISOString()
}
export function projectWorkspace(
  state: PersistedState,
  selected: string[],
  calendar: CalendarUi,
  now = new Date(),
): WorkspaceSnapshot {
  const wanted = new Set(selected),
    items = selectableOverviewItems(state.items).filter((item) => wanted.has(item.id))
  if (wanted.size !== selected.length || items.length !== wanted.size || items.length > 250)
    throw new Error('選択したデータが変化しました。選び直してください。')
  // V2 all-day instants have lost the provider's original floating dates. Exclude them until migration is defined.
  if (items.some((item) => item.kind === 'event' && item.allDay))
    throw new Error('終日の予定は元の暦日を確認できないため、この実験では共有できません。')
  const freshness = calendarFreshness(
    calendar,
    state.calendarSyncedAt ? utcProjection(state.calendarSyncedAt) : undefined,
  )
  if (
    items.some((item) => item.sourceId === 'google-calendar') &&
    ['unconfigured', 'disconnected'].includes(freshness.state)
  )
    throw new Error('Google Calendarの接続状態を確認してください。')
  return {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    calendar: freshness,
    tasks: items
      .filter((item) => item.kind === 'task')
      .map((item) => ({
        id: item.id,
        title: item.title,
        sourceTime: utcProjection(item.sourceUpdatedAt),
        dueAt: item.deadline ? utcProjection(item.deadline) : null,
        importance: item.importance,
      })),
    events: items
      .filter((item) => item.kind === 'event')
      .map((item) => ({
        id: item.id,
        title: item.title,
        sourceTime: utcProjection(item.sourceUpdatedAt),
        source: item.sourceId as 'manual' | 'google-calendar',
        allDay: false,
        startAt: utcProjection(item.startAt!),
        endAt: item.endAt ? utcProjection(item.endAt) : null,
        startDate: null,
        endDate: null,
      })),
  }
}
