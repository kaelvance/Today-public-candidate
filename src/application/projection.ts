import type { Context } from '../domain/model'
import type { Item } from '../types'

export interface TodayProjection {
  items: Item[]
  sourceItems: Item[]
  contexts: Context[]
  compressionRatio: number
}
export function projectToday(sourceItems: Item[], contexts: Context[]): TodayProjection {
  const byId = new Map(sourceItems.map((item) => [item.id, item]))
  const grouped = new Set<string>()
  const projected: Item[] = []
  for (const context of contexts) {
    const members = context.itemRefs
      .map((id) => byId.get(id))
      .filter((item): item is Item => !!item && item.status === 'active')
    if (members.length < 2 || members.some((item) => grouped.has(item.id))) continue
    members.forEach((item) => grouped.add(item.id))
    const event = members.find((item) => item.kind === 'event' && item.startAt)
    const leader = event || members.find((item) => item.kind === 'task') || members[0]
    const conflicted = context.conflicts.some(
      (conflict) => conflict.resolutionState === 'UNRESOLVED',
    )
    const requirements = context.requirements.length
      ? `持ち物・準備: ${context.requirements.join('、')}`
      : ''
    const description = [
      requirements,
      `${members.length}件の関連情報${conflicted ? ' · 時刻の確認が必要' : ''}`,
    ]
      .filter(Boolean)
      .join(' · ')
    projected.push({
      ...leader,
      id: context.id,
      contextId: context.id,
      externalId: undefined,
      title: context.canonicalTitle,
      description,
      sourceId: 'context',
      source: `${members.length}件の関連情報`,
      kind: event ? 'event' : leader.kind,
      createdAt: context.createdAt,
      lastUpdated: context.updatedAt,
      sourceUpdatedAt: context.updatedAt,
      startAt: context.temporal.startsAt || event?.startAt,
      endAt: event?.endAt || context.temporal.endsAt,
      deadline: event ? undefined : leader.deadline,
      allDay: event?.allDay,
      importance: Math.max(...members.map((item) => item.importance)) as Item['importance'],
      pinned: members.some((item) => item.pinned),
      requiresAction: members.some((item) => item.requiresAction),
      conflict: conflicted,
      confidence: context.confidence,
      syncStatus: members.some((item) => item.syncStatus === 'failed') ? 'failed' : 'synced',
      actions: [
        {
          id: 'view',
          label: '詳細を見る',
          type: 'view',
          riskLevel: 0,
          requiresConfirmation: false,
          plugin: 'context',
        },
      ],
    })
  }
  const items = [...sourceItems.filter((item) => !grouped.has(item.id)), ...projected]
  return {
    items,
    sourceItems,
    contexts,
    compressionRatio: items.length ? Number((sourceItems.length / items.length).toFixed(2)) : 1,
  }
}
