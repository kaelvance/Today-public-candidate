import { describe, expect, it } from 'vitest'
import { makeManualItem } from './data'
import { parseCapture } from './capture'
import { mergeBackup } from './backup'
import { normalizePersistedState, saveState } from './storage'

describe('untrusted backup records', () => {
  it('rejects a save without an acquired writer session', async () => {
    await expect(saveState(normalizePersistedState(null))).rejects.toThrow(
      'storage_writer_required',
    )
  })
  it('imports an ID only once even when the input file repeats it', () => {
    const item = makeManualItem(parseCapture('fictional repeated record'))
    const result = mergeBackup(normalizePersistedState(null), {
      app: 'Today',
      version: 2,
      state: { items: [item, item] },
    })
    expect(result.added).toBe(1)
    expect(result.state.items.map((entry) => entry.id)).toEqual([item.id])
  })
})
