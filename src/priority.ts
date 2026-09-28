import type { Item, PriorityResult } from './types'

export interface PriorityProvider {
  rank(items: Item[], now?: Date): PriorityResult[]
}

const hoursUntil = (iso: string, now: Date) => (new Date(iso).getTime() - now.getTime()) / 3_600_000

export const localPriorityProvider: PriorityProvider = {
  rank(items, now = new Date()) {
    const openIds = new Set(items.filter((item) => item.status === 'active').map((item) => item.id))
    return items
      .filter((item) => item.status === 'active')
      .map((item) => {
        const date = item.deadline || item.startAt
        const hours = date ? hoursUntil(date, now) : Infinity
        const eventDay = date ? new Date(date) : undefined
        const dayOffset = eventDay
          ? Math.round(
              (new Date(eventDay.getFullYear(), eventDay.getMonth(), eventDay.getDate()).getTime() -
                new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
                86_400_000,
            )
          : Infinity
        const snoozed = !!item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now.getTime()
        const oldEvent = item.kind === 'event' && (item.allDay ? dayOffset < 0 : hours < -2)
        const blocked = item.dependsOn?.some((id) => openIds.has(id)) ?? false
        let urgency = 0
        if (item.kind === 'event') {
          if (item.allDay) urgency = dayOffset === 0 ? 18 : dayOffset === 1 ? 10 : 0
          else if (hours >= 0 && hours <= 1) urgency = 42
          else if (hours > 1 && hours <= 4) urgency = 34
          else if (hours > 4 && hours <= 24) urgency = 18
          else if (hours > -2 && hours < 0) urgency = 12
        } else if (Number.isFinite(hours)) {
          if (hours < 0) urgency = 45
          else if (hours <= 2) urgency = 42
          else if (hours <= 12) urgency = 34
          else if (hours <= 36) urgency = 25
          else if (hours <= 72) urgency = 12
        }
        const importance = item.importance * 12
        const action = item.requiresAction ? 12 : 0
        const unread = item.unread ? 6 : 0
        const recency =
          now.getTime() - new Date(item.sourceUpdatedAt).getTime() < 86_400_000 ? 2 : 0
        const reliability = item.demo ? 0 : 3
        const confidence = item.confidence === 'low' ? -6 : 0
        const priorityScore =
          snoozed || oldEvent
            ? -1
            : Math.max(
                0,
                Math.min(
                  100,
                  importance +
                    urgency +
                    action +
                    unread +
                    recency +
                    reliability +
                    confidence +
                    (item.pinned ? 45 : 0) +
                    (item.conflict ? 10 : 0) -
                    (blocked ? 15 : 0),
                ),
              )
        const layer =
          snoozed || oldEvent
            ? 'later'
            : priorityScore >= 70
              ? 'now'
              : priorityScore >= 40
                ? 'next'
                : 'awareness'
        let reason = item.pinned
          ? '固定した項目'
          : item.requiresAction && item.kind === 'email'
            ? '返信の確認が必要'
            : '確認しておく項目'
        if (blocked) reason = '先に別の項目が必要'
        if (Number.isFinite(hours)) {
          if (item.kind === 'event')
            reason = item.allDay
              ? '終日の予定'
              : hours < 0
                ? '開始時刻を過ぎています'
                : hours <= 1
                  ? 'まもなく始まります'
                  : '予定があります'
          else
            reason =
              hours < 0
                ? '期限を過ぎています'
                : hours <= 36
                  ? '期限が近づいています'
                  : '期限があります'
        }
        if (oldEvent) reason = '過去の予定'
        else if (item.conflict)
          reason = item.contextId ? '時刻の情報に食い違いがあります' : '予定が重なっています'
        if (snoozed) reason = '保留中'
        return {
          itemId: item.id,
          priorityScore,
          reason,
          confidence: item.confidence,
          suggestedActions: item.actions.map((action) => action.id),
          layer,
        } satisfies PriorityResult
      })
      .sort((a, b) => b.priorityScore - a.priorityScore || a.itemId.localeCompare(b.itemId))
  },
}
