import { normalizePersistedState } from './storage'
import type { PersistedState } from './types'

export function makeBackup(state: PersistedState): string {
  return JSON.stringify(
    {
      app: 'Today',
      version: 2,
      exportedAt: new Date().toISOString(),
      state: {
        version: 2,
        items: state.items.filter((item) => item.sourceId === 'manual' && !item.demo),
        queuedActions: [],
        theme: state.theme,
        showSamples: false,
      },
    },
    null,
    2,
  )
}

export function mergeBackup(
  current: PersistedState,
  value: unknown,
): { state: PersistedState; added: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_backup')
  const record = value as Record<string, unknown>
  if (record.app !== 'Today' || record.version !== 2 || !record.state)
    throw new Error('invalid_backup')
  const imported = normalizePersistedState(record.state)
  const currentIds = new Set(current.items.map((item) => item.id))
  const additions = imported.items.filter((item) => {
    if (item.demo || item.sourceId !== 'manual' || currentIds.has(item.id)) return false
    currentIds.add(item.id)
    return true
  })
  return { state: { ...current, items: [...current.items, ...additions] }, added: additions.length }
}
