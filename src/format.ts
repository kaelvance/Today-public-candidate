import type { Item } from './types'

export function dateLabel(
  iso?: string,
  kind?: Item['kind'],
  now = new Date(),
  allDay = false,
): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '日時を確認してください'
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = sameDay(date, now)
    ? '今日'
    : sameDay(date, tomorrow)
      ? '明日'
      : new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date)
  if (allDay) return `${day} 終日`
  const time = new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit' }).format(date)
  return `${day} ${time}${kind === 'task' ? 'まで' : 'から'}`
}

export function matchesQuery(item: Item, query: string, now = new Date()): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (/返信|メール/.test(q)) return item.kind === 'email'
  if (/明日/.test(q)) {
    const target = item.startAt || item.deadline
    if (!target) return false
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return new Date(target).toDateString() === tomorrow.toDateString()
  }
  if (/提出|課題/.test(q)) return item.kind === 'task'
  if (/今日|必要/.test(q)) return true
  return `${item.title} ${item.description} ${item.source}`.toLowerCase().includes(q)
}
