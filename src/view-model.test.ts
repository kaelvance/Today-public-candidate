import { describe, expect, it } from 'vitest'
import { demoItems } from './data'
import { normalizePersistedState } from './storage'
import { scheduledItems } from './view-model'
import type { Item } from './types'

const item = (id: string, date?: string, changes: Partial<Item> = {}): Item => ({
  ...demoItems()[0],
  id,
  demo: false,
  startAt: undefined,
  deadline: date,
  ...changes,
})
describe('V2 calendar projection', () => {
  it('orders instants across a year and timezone boundary without mutating source order', () => {
    const items = [
      item('later', '2027-01-01T01:00:00+09:00'),
      item('earlier', '2026-12-31T15:00:00Z'),
      item('same-instant', '2027-01-01T00:00:00+09:00'),
    ]
    expect(scheduledItems(items).map((i) => i.id)).toEqual(['earlier', 'same-instant', 'later'])
    expect(items.map((i) => i.id)).toEqual(['later', 'earlier', 'same-instant'])
  })
  it('excludes undated, completed and malformed extension data', () => {
    expect(
      scheduledItems([
        item('undated'),
        item('invalid', 'invalid'),
        item('complete', '2026-10-01T08:00:00Z', { status: 'done' }),
        item('active', '2026-10-01T09:00:00Z'),
      ]).map((i) => i.id),
    ).toEqual(['active'])
  })
  it('uses event start before deadline and retains local all-day dates', () => {
    expect(
      scheduledItems([
        item('event', '2026-10-03T00:00:00Z', { startAt: '2026-10-01T08:00:00Z', kind: 'event' }),
        item('all-day', undefined, { startAt: '2026-09-30', allDay: true, kind: 'event' }),
        item('task', '2026-10-01T09:00:00Z'),
      ]).map((i) => i.id),
    ).toEqual(['all-day', 'event', 'task'])
  })
  it('keeps V1 persisted data and removes its invalid dates before presentation', () => {
    const restored = normalizePersistedState({
      version: 3,
      items: [item('legacy', 'invalid', { startAt: '2026-10-01T09:00:00Z' })],
      theme: 'dark',
      queuedActions: [],
    })
    expect(restored.items[0].deadline).toBeUndefined()
    expect(restored.items[0].startAt).toBe('2026-10-01T09:00:00Z')
    expect(restored.theme).toBe('dark')
    expect(scheduledItems(restored.items).map((i) => i.id)).toEqual(['legacy'])
  })
})
