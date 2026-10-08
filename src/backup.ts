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
  if (
    record.app !== 'Today' ||
    record.version !== 2 ||
    !record.state ||
    typeof record.state !== 'object' ||
    Array.isArray(record.state) ||
    !Array.isArray((record.state as Record<string, unknown>).items) ||
    ((record.state as Record<string, unknown>).version !== undefined &&
      ![1, 2, 3].includes(Number((record.state as Record<string, unknown>).version)))
  )
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

/** Normalize untrusted records before preview; only manual items may be committed. */
export function previewBackup(current: PersistedState, value: unknown) {
  const result = mergeBackup(current, value)
  const record = value as { state: { items: unknown[] } }
  const normalized = normalizePersistedState(record.state)
  const ids = new Set(current.items.map((item) => item.id))
  let duplicates = 0,
    excluded = 0
  for (const item of normalized.items) {
    if (item.demo || item.sourceId !== 'manual') excluded++
    else if (ids.has(item.id)) duplicates++
    else ids.add(item.id)
  }
  // Keep sanitized data, not the original untrusted object, between preview and commit.
  return {
    added: result.added,
    duplicates,
    excluded,
    invalid: record.state.items.length - normalized.items.length,
    value: { app: 'Today', version: 2, state: normalized },
  }
}
