import { describe, expect, it } from 'vitest'
import { normalizePersistedState } from './storage'
import { makeManualItem } from './data'
import { parseCapture } from './capture'
import { mergeBackup, previewBackup } from './backup'
import { makeSafeDiagnostics } from './application/diagnostics'

describe('backup preview and safe diagnostics', () => {
  it('previews duplicates, invalid and non-manual records without mutating current state', () => {
    const item = makeManualItem(parseCapture('fictional reminder'))
    const current = normalizePersistedState({ items: [item] })
    const value = {
      app: 'Today',
      version: 2,
      state: {
        version: 2,
        items: [
          item,
          { ...item, id: 'new' },
          { ...item, id: 'new' },
          {},
          { ...item, id: 'remote', sourceId: 'google-calendar' },
        ],
      },
    }
    const before = JSON.stringify(current)
    const preview = previewBackup(current, value)
    expect(preview).toMatchObject({ added: 1, duplicates: 2, invalid: 1, excluded: 1 })
    expect(JSON.stringify(current)).toBe(before)
    // A record added while the preview was open is not duplicated at commit.
    expect(
      mergeBackup({ ...current, items: [...current.items, { ...item, id: 'new' }] }, preview.value)
        .added,
    ).toBe(0)
  })
  it.each([null, [], {}, { items: [], version: 99 }])(
    'rejects malformed or future backup state: %j',
    (state) => {
      expect(() =>
        previewBackup(normalizePersistedState(null), { app: 'Today', version: 2, state }),
      ).toThrow('invalid_backup')
    },
  )
  it('exports only allowlisted status, even if a caller carries sensitive extra fields', () => {
    const value = {
      version: '2.0.3',
      storage: 'AVAILABLE' as const,
      load: 'READY' as const,
      online: false,
      mode: 'web' as const,
      serviceWorker: true,
      title: 'PRIVATE_TITLE',
      token: 'PRIVATE_TOKEN',
      endpoint: 'https://private.invalid',
    }
    expect(JSON.parse(makeSafeDiagnostics(value))).toEqual({
      app: 'Today',
      version: '2.0.3',
      storage: 'AVAILABLE',
      load: 'READY',
      online: false,
      mode: 'web',
      serviceWorker: true,
    })
  })
})
