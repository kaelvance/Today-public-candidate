import type { CaptureResult } from './types'

const jaDays: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 }
const enDays: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const validDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined
}
const startOfWeek = (date: Date) => {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}
const nextWeekday = (now: Date, day: number, nextWeek = false) => {
  const value = startOfWeek(now)
  value.setDate(value.getDate() + ((day + 6) % 7) + (nextWeek ? 7 : 0))
  if (
    !nextWeek &&
    value.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  )
    value.setDate(value.getDate() + 7)
  return value
}

export function parseCapture(sourceText: string, now = new Date()): CaptureResult {
  const raw = sourceText.trim()
  let remainder = raw
  let day: Date | undefined
  let dateConfidence: 'high' | 'medium' | 'low' = 'low'
  let explicitTime = false
  let hours = 23
  let minutes = 59
  let approximate = false

  const exact = remainder.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?/)
  const monthDay = !exact && remainder.match(/(\d{1,2})月(\d{1,2})日|(\d{1,2})[/-](\d{1,2})/)
  if (exact) {
    day = validDate(Number(exact[1]), Number(exact[2]), Number(exact[3]))
    if (day) {
      remainder = remainder.replace(exact[0], ' ')
      dateConfidence = 'high'
    }
  } else if (monthDay) {
    const month = Number(monthDay[1] || monthDay[3])
    const date = Number(monthDay[2] || monthDay[4])
    day = validDate(now.getFullYear(), month, date)
    if (day && day < new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      day = validDate(now.getFullYear() + 1, month, date)
    if (day) {
      remainder = remainder.replace(monthDay[0], ' ')
      dateConfidence = 'high'
    }
  }
  if (!day) {
    const relative = remainder.match(
      /明後日|あさって|明日|今日|今夜|\btomorrow\b|\btoday\b|\btonight\b/i,
    )
    if (relative) {
      day = new Date(now)
      const word = relative[0].toLowerCase()
      day.setDate(
        day.getDate() +
          (word === '明日' || word === 'tomorrow'
            ? 1
            : word === '明後日' || word === 'あさって'
              ? 2
              : 0),
      )
      remainder = remainder.replace(relative[0], ' ')
      dateConfidence = 'medium'
      if (word === '今夜' || word === 'tonight') {
        hours = 20
        minutes = 0
        approximate = true
      }
    }
  }
  if (!day) {
    const next = remainder.match(
      /(再来週|来週)\s*([日月火水木金土])曜(?:日)?|\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    )
    if (next) {
      day = nextWeekday(now, next[2] ? jaDays[next[2]] : enDays[next[3].toLowerCase()], true)
      if (next[1] === '再来週') day.setDate(day.getDate() + 7)
      remainder = remainder.replace(next[0], ' ')
      dateConfidence = 'medium'
    }
  }
  if (!day) {
    const thisWeek = remainder.match(/今週\s*([日月火水木金土])曜(?:日)?/)
    if (thisWeek) {
      day = nextWeekday(now, jaDays[thisWeek[1]])
      remainder = remainder.replace(thisWeek[0], ' ')
      dateConfidence = 'medium'
    }
  }
  if (!day) {
    const week = remainder.match(
      /([日月火水木金土])曜(?:日)?|\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    )
    if (week) {
      day = nextWeekday(now, week[1] ? jaDays[week[1]] : enDays[week[2].toLowerCase()])
      remainder = remainder.replace(week[0], ' ')
      dateConfidence = 'medium'
    }
  }
  if (!day) {
    const nextWeek = remainder.match(/再来週|来週|\bnext week\b/i)
    if (nextWeek) {
      day = startOfWeek(now)
      day.setDate(day.getDate() + (nextWeek[0] === '再来週' ? 14 : 7))
      remainder = remainder.replace(nextWeek[0], ' ')
      dateConfidence = 'low'
    }
  }

  const japaneseTime = remainder.match(/(午前|午後)?\s*([01]?\d|2[0-3])時(半|[0-5]?\d分)?/)
  const colonTime = !japaneseTime && remainder.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  const englishTime =
    !japaneseTime &&
    !colonTime &&
    remainder.match(/\b(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i)
  if (japaneseTime) {
    hours = Number(japaneseTime[2])
    if (japaneseTime[1] === '午後' && hours < 12) hours += 12
    if (japaneseTime[1] === '午前' && hours === 12) hours = 0
    minutes =
      japaneseTime[3] === '半'
        ? 30
        : japaneseTime[3]
          ? Number(japaneseTime[3].replace('分', ''))
          : 0
    remainder = remainder.replace(japaneseTime[0], ' ')
    explicitTime = true
  } else if (colonTime) {
    hours = Number(colonTime[1])
    minutes = Number(colonTime[2])
    remainder = remainder.replace(colonTime[0], ' ')
    explicitTime = true
  } else if (englishTime && Number(englishTime[1]) >= 1 && Number(englishTime[1]) <= 12) {
    hours = (Number(englishTime[1]) % 12) + (englishTime[3].toLowerCase() === 'pm' ? 12 : 0)
    minutes = Number(englishTime[2] || 0)
    remainder = remainder.replace(englishTime[0], ' ')
    explicitTime = true
  } else if (day && /朝|\bmorning\b/i.test(remainder)) {
    hours = 9
    minutes = 0
    approximate = true
    remainder = remainder.replace(/朝|\bmorning\b/i, ' ')
  }

  const deadline = /まで|締切|提出|宿題|\bdue\b|\bby\b/i.test(raw)
  const event =
    !deadline && /予定|予約|会議|面談|診察|歯医者|集合|\bmeeting\b|\bappointment\b/i.test(raw)
  if (!day && (explicitTime || approximate)) {
    day = new Date(now)
    if (hours * 60 + minutes < now.getHours() * 60 + now.getMinutes())
      day.setDate(day.getDate() + 1)
    dateConfidence = 'medium'
  }
  if (day && event && !explicitTime && !approximate) day = undefined
  if (day) day.setHours(hours, minutes, 0, 0)

  remainder = remainder
    .replace(/^(予定|タスク)[:：\s]*/, '')
    .replace(/^\s*(?:重要|急ぎ|urgent)[:：\s]*/i, '')
  for (let index = 0; index < 3; index += 1)
    remainder = remainder.replace(/^\s*(?:の|に|までに|まで|ごろ|頃|at)\s*/i, '')
  remainder = remainder
    .replace(/\s*(?:までに|まで|締切|期限|ごろ|頃)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const title = remainder || raw
  const confidence = day
    ? dateConfidence === 'low'
      ? 'low'
      : approximate
        ? 'medium'
        : dateConfidence
    : 'low'
  return {
    title,
    kind: event ? 'event' : 'task',
    date: day?.toISOString(),
    confidence,
    sourceText: raw,
    importance: /^(?:重要|急ぎ|urgent)[:：\s]/i.test(raw) ? 3 : undefined,
  }
}

export function shouldUseAI(input: string, local: CaptureResult): boolean {
  if (local.confidence !== 'low') return false
  return /来週|再来週|来月|今月|ごろ|頃|朝|昼|夜|曜|明日|明後日|\bnext\b|\blater\b|\bmorning\b|\bevening\b|\bfriday\b|\btomorrow\b/i.test(
    input,
  )
}

export function toLocalInputValue(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}
