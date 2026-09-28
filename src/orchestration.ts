import { localPriorityProvider, type PriorityProvider } from './priority'
import type { Plugin } from './plugins'
import type { Item, ItemAction, PriorityResult } from './types'

export interface TodayModel {
  items: Item[]
  priorities: PriorityResult[]
  usedFallback: boolean
}

export function orchestrateItems(
  items: Item[],
  availablePlugins: Record<string, Plugin>,
  provider: PriorityProvider = localPriorityProvider,
  now = new Date(),
): TodayModel {
  const normalized = items.map((item) => ({
    ...item,
    title: item.title.trim(),
    actions:
      availablePlugins[item.sourceId]?.getAvailableActions(item) ??
      item.actions.filter((action) => action.type === 'view' && action.riskLevel === 0),
    syncStatus: availablePlugins[item.sourceId] ? item.syncStatus : ('failed' as const),
  }))
  const byContext = new Map<string, Item>()
  for (const item of normalized) {
    const key =
      item.sourceId === 'manual'
        ? item.id
        : `${item.sourceId}:${item.externalId || `${item.title.toLowerCase()}:${item.startAt || item.deadline || ''}`}`
    const previous = byContext.get(key)
    if (
      !previous ||
      new Date(item.sourceUpdatedAt).getTime() > new Date(previous.sourceUpdatedAt).getTime()
    )
      byContext.set(key, item)
  }
  const unique = [...byContext.values()]
  try {
    return { items: unique, priorities: provider.rank(unique, now), usedFallback: false }
  } catch {
    return {
      items: unique,
      priorities: localPriorityProvider.rank(unique, now),
      usedFallback: true,
    }
  }
}

export function actionPolicy(
  item: Item,
  action: ItemAction,
): 'local' | 'read' | 'prepare' | 'confirm' | 'blocked' {
  if (action.plugin !== item.sourceId) return 'blocked'
  if (action.riskLevel === 4) return 'blocked'
  if (action.type === 'complete' && action.riskLevel <= 1) return 'local'
  if (action.type === 'compose' && action.riskLevel <= 1) return 'prepare'
  if (
    action.requiresConfirmation ||
    action.riskLevel >= 2 ||
    (item.confidence === 'low' && action.riskLevel >= 1)
  )
    return 'confirm'
  return 'read'
}
