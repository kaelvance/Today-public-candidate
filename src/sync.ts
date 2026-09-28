import { assertPluginAction, type Plugin } from './plugins'
import type { Item, ItemAction, PersistedState, QueuedAction } from './types'

export function enqueueRemoteAction(
  state: PersistedState,
  item: Item,
  action: ItemAction,
  key: string = crypto.randomUUID(),
): PersistedState {
  if (state.queuedActions.some((queued) => queued.idempotencyKey === key)) return state
  const entry: QueuedAction = {
    id: crypto.randomUUID(),
    idempotencyKey: key,
    itemId: item.id,
    actionId: action.id,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  }
  return {
    ...state,
    queuedActions: [...state.queuedActions, entry],
    items: state.items.map((current) =>
      current.id === item.id ? { ...current, syncStatus: 'pending' } : current,
    ),
  }
}

export async function replayQueue(
  state: PersistedState,
  availablePlugins: Record<string, Plugin>,
): Promise<{ state: PersistedState; completed: number; failed: number }> {
  let completed = 0
  let failed = 0
  const remaining: QueuedAction[] = []
  const items = state.items.map((item) => ({ ...item }))
  const seen = new Set<string>()
  for (const queued of state.queuedActions) {
    if (seen.has(queued.idempotencyKey)) continue
    seen.add(queued.idempotencyKey)
    if (queued.status !== 'pending') {
      remaining.push(queued)
      continue
    }
    const item = items.find((candidate) => candidate.id === queued.itemId)
    const action = item?.actions.find((candidate) => candidate.id === queued.actionId)
    const plugin = item && availablePlugins[item.sourceId]
    try {
      if (!item || !action || !plugin) throw new Error('plugin_unavailable')
      assertPluginAction(plugin, action)
      await plugin.executeAction(action, item, queued.idempotencyKey)
      item.syncStatus = 'synced'
      completed += 1
    } catch (error) {
      failed += 1
      const conflict = error instanceof Error && error.message === 'conflict'
      remaining.push({
        ...queued,
        attempts: queued.attempts + 1,
        status: conflict ? 'conflict' : 'failed',
      })
      if (item) item.syncStatus = conflict ? 'conflict' : 'failed'
    }
  }
  return { state: { ...state, items, queuedActions: remaining }, completed, failed }
}
