import type { ChatReply, ChatRequest } from './contracts'

function localParts(date: Date, timezone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(p.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
}
/** Resolve explicit civil time without relying on an LLM's UTC conversion; reject DST folds/gaps. */
export function civilTime(
  date: string,
  hour: number,
  minute: number,
  timezone: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hour < 0 || hour > 23 || minute < 0 || minute > 59)
    return null
  const expected = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const numeric = Date.parse(expected + 'Z')
  if (!Number.isFinite(numeric) || new Date(numeric).toISOString().slice(0, 16) !== expected)
    return null
  const format = (t: number) => {
    const p = localParts(new Date(t), timezone)
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
  }
  let value = numeric
  for (let n = 0; n < 4; n++) value += numeric - Date.parse(format(value) + 'Z')
  if (format(value) !== expected) return null
  for (const shift of [-120, -90, -60, -30, 30, 60, 90, 120])
    if (format(value + shift * 60_000) === expected) return null
  return new Date(value).toISOString()
}
export function explicitCommand(request: ChatRequest): ChatReply | null {
  const text = request.messages.at(-1)!.content.trim()
  const task = text.match(
    /^タスク「([^」]{1,160})」を(?:追加|作成|登録)(?:してください|して|する)?[。！!]?$/,
  )
  if (task)
    return {
      text: 'タスク追加案です。確認するまで保存しません。',
      citations: [],
      proposal: { type: 'create', kind: 'task', title: task[1] },
    }
  const done = text.match(/^「([^」]{1,160})」を完了(?:にして|してください|して|する)?[。！!]?$/)
  if (done) {
    const targets = request.context.facts.filter((f) => f.title === done[1])
    if (targets.length !== 1)
      return {
        text: '同じ名前の対象が複数あるか、共有されていません。対象を1件に絞ってください。',
        citations: [],
        proposal: null,
      }
    return {
      text: '完了への変更案です。確認するまで保存しません。',
      citations: [targets[0].id],
      proposal: { type: 'update', targetId: targets[0].id, patch: { status: 'done' } },
    }
  }
  const event = text.match(
    /^予定「([^」]{1,160})」を(今日|明日|\d{4}-\d{2}-\d{2})(?:の|\s)?(\d{1,2})(?:時|:)(\d{2})?(?:分)?に(?:追加|登録)(?:してください|して|する)?[。！!]?$/,
  )
  if (event) {
    const c = request.context,
      p = localParts(new Date(c.now), c.timezone)
    const today = `${p.year}-${p.month}-${p.day}`
    const day =
      event[2] === '今日'
        ? today
        : event[2] === '明日'
          ? new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
          : event[2]
    const at = civilTime(day, Number(event[3]), Number(event[4] || 0), c.timezone)
    if (!at)
      return {
        text: '日時を一意に確認できません。日付・24時間表記・タイムゾーンを確認し、予定エディタで指定してください。',
        citations: [],
        proposal: null,
      }
    return {
      text: `予定追加案です。${day} ${event[3]}:${event[4] || '00'} (${c.timezone})。確認するまで保存しません。`,
      citations: [],
      proposal: { type: 'create', kind: 'event', title: event[1], at },
    }
  }
  return null
}
