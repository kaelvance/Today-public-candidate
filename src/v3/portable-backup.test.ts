import { describe, it, expect } from 'vitest'
import { makePortableArchive, previewPortable } from './portable-backup'
import { canonicalPortable, validatePortable } from '../../shared/v3-portable.mjs'
import type { Item, PersistedState } from '../types'
const stamp = '2026-10-14T00:00:00.000Z'
const record = (id: string): Item => ({
  id,
  kind: 'task',
  title: '架空portable記録',
  description: '保持する架空の説明',
  source: '手動',
  sourceId: 'manual',
  createdAt: stamp,
  lastUpdated: stamp,
  sourceUpdatedAt: stamp,
  status: 'done',
  importance: 2,
  pinned: true,
  snoozedUntil: stamp,
  requiresAction: true,
  syncStatus: 'synced',
  confidence: 'high',
  demo: false,
  actions: [],
})
const source = (): PersistedState => ({
  version: 3,
  items: [record('fixture-a'), record('fixture-b')],
  queuedActions: [],
  theme: 'dark',
  showSamples: false,
})
describe('V3 portable archive', () => {
  it('preserves exact JSON record semantics and explicitly unknown source revision', () => {
    const s = source(),
      before = JSON.stringify(s),
      archive = makePortableArchive(s, new Date(stamp))
    expect(JSON.stringify(s)).toBe(before)
    expect(archive.records[0].record).toEqual(s.items[0])
    expect(archive.records[0].sourceRevision).toBeNull()
    expect(previewPortable(archive).coreRestoreReady).toBe(false)
  })
  it('all-day dates remain unknown rather than recovered from instants', () => {
    const s = source()
    s.items[0] = { ...s.items[0], kind: 'event', allDay: true, startAt: stamp }
    const p = previewPortable(makePortableArchive(s, new Date(stamp)))
    expect(p.unresolvedAllDay).toBe(1)
    expect(p.archive.records[0].record.startAt).toBe(stamp)
  })
  it('external/demo records and pending operations are excluded with counts', () => {
    const s = source()
    s.items.push(
      { ...record('fixture-external'), sourceId: 'google-calendar' },
      { ...record('fixture-demo'), demo: true },
    )
    s.queuedActions = [
      {
        id: 'fixture-q',
        idempotencyKey: 'q',
        itemId: 'fixture-a',
        actionId: 'complete',
        queuedAt: stamp,
        attempts: 0,
        status: 'pending',
      },
    ]
    const a = makePortableArchive(s, new Date(stamp))
    expect(a.excluded.items).toBe(2)
    expect(a.excluded.queuedActions).toBe(1)
    expect(a.records).toHaveLength(2)
  })
  it('duplicate, malformed, forged revision, unknown structured fields and prototype keys fail', () => {
    const a = makePortableArchive(source(), new Date(stamp))
    for (const modify of [
      (v: typeof a) => v.records.push(v.records[0]),
      (v: typeof a) => {
        v.records[0].sourceRevision = 1 as never
      },
      (v: typeof a) => {
        v.records[0].record.sourceId = 'google-calendar'
      },
      (v: typeof a) => {
        Object.assign(v.records[0].record, { accessToken: 'fixture-not-secret' })
      },
    ]) {
      const v = structuredClone(a)
      modify(v)
      expect(() => validatePortable(v)).toThrow()
    }
    const text = JSON.stringify(a).replace(
      '"description":',
      '"__proto__":{"token":"fixture"},"description":',
    )
    expect(() => validatePortable(JSON.parse(text))).toThrow()
  })
  it('canonical comparison ignores object key order, retains array order', () => {
    expect(canonicalPortable({ a: 1, b: 2 })).toBe(canonicalPortable({ b: 2, a: 1 }))
    expect(canonicalPortable([1, 2])).not.toBe(canonicalPortable([2, 1]))
  })
})
