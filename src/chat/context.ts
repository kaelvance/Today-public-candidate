import type { PersistedState } from '../types'
import { budget, type ChatContext } from './contracts'
export function contextSnapshot(
  state: PersistedState,
  selected: string[],
  now = new Date(),
): ChatContext {
  if (selected.length > budget.facts || new Set(selected).size !== selected.length)
    throw new Error('context_limit')
  const facts = selected.map((id) => {
    const item = state.items.find((item) => item.id === id)
    if (!item || item.sourceId !== 'manual' || item.demo || !['task', 'event'].includes(item.kind))
      throw new Error('context_denied')
    return {
      id: item.id,
      kind: item.kind as 'task' | 'event',
      title: item.title.slice(0, 160),
      status: item.status,
      at: item.kind === 'event' ? item.startAt : item.deadline,
      priority: item.importance,
    }
  })
  const relations = (state.contexts || [])
    .filter((c) => c.itemRefs.length > 1 && c.itemRefs.every((id) => selected.includes(id)))
    .slice(0, 3)
    .map((c) => ({ title: c.canonicalTitle.slice(0, 160), itemIds: [...c.itemRefs] }))
  return {
    now: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    facts,
    relations,
  }
}
