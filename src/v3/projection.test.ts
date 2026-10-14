import { describe, expect, it } from 'vitest'
import { makeManualItem, demoItems } from '../data'
import type { PersistedState } from '../types'
import { projectWorkspace, selectableOverviewItems } from './projection'
import type { CalendarUi } from '../ConnectedServices'

const ui: CalendarUi = { configured: false, connection: 'disconnected', phase: 'idle' }
const initialState = (): PersistedState => ({
  version: 3,
  items: [],
  queuedActions: [],
  theme: 'light',
  showSamples: false,
})
describe('explicit readonly projection', () => {
  it('normalizes explicit offsets without changing source instants or mutating Core', () => {
    const task = makeManualItem({
      kind: 'task',
      title: '架空offset',
      sourceText: 'fixture',
      confidence: 'high',
    })
    task.sourceUpdatedAt = '2026-10-14T09:00:00+09:00'
    task.deadline = '2026-10-15T10:00:00+09:00'
    const state = { ...initialState(), items: [task] },
      before = JSON.stringify(state)
    const projected = projectWorkspace(state, [task.id], {
      configured: false,
      connection: 'disconnected',
      phase: 'idle',
    })
    expect(projected.tasks[0].sourceTime).toBe('2026-10-14T00:00:00.000Z')
    expect(projected.tasks[0].dueAt).toBe('2026-10-15T01:00:00.000Z')
    expect(JSON.stringify(state)).toBe(before)
  })
  it('rejects bare floating dates and impossible civil dates rather than inventing an instant', () => {
    const task = makeManualItem({
      kind: 'task',
      title: '架空date',
      sourceText: 'fixture',
      confidence: 'high',
    })
    const state = { ...initialState(), items: [task] }
    for (const date of ['2026-10-14', '2026-02-30T10:00:00Z', '2026-10-14T25:00:00Z']) {
      task.deadline = date
      expect(() =>
        projectWorkspace(state, [task.id], {
          configured: false,
          connection: 'disconnected',
          phase: 'idle',
        }),
      ).toThrow(/日時/)
    }
  })
  it('never includes samples, email, descriptions, original input or unselected tasks', () => {
    const a = makeManualItem({
      kind: 'task',
      title: '架空タスク',
      sourceText: 'fixture original input',
      confidence: 'high',
    })
    a.description = 'fixture private description'
    const b = { ...a, id: 'other', title: '未選択' }
    const state = { ...initialState(), items: [a, b, ...demoItems()] }
    const before = JSON.stringify(state)
    const selected = projectWorkspace(state, [a.id], ui, new Date('2026-10-10T00:00:00Z'))
    expect(selected.tasks.map((t) => t.id)).toEqual([a.id])
    expect(JSON.stringify(selected)).not.toMatch(/fixture original|fixture private|未選択/)
    expect(JSON.stringify(state)).toBe(before)
    expect(selectableOverviewItems(state.items)).toHaveLength(2)
  })
  it('rejects disappearing records, duplicate selections and ambiguous all-day dates', () => {
    const state = initialState()
    expect(() => projectWorkspace(state, ['missing'], ui)).toThrow()
    const task = makeManualItem({
      kind: 'task',
      title: '架空',
      sourceText: '架空',
      confidence: 'high',
    })
    state.items = [task]
    expect(() => projectWorkspace(state, [task.id, task.id], ui)).toThrow()
    const allDay = {
      ...task,
      kind: 'event' as const,
      allDay: true,
      startAt: '2026-10-10T00:00:00Z',
    }
    state.items = [allDay]
    expect(() => projectWorkspace(state, [allDay.id], ui)).toThrow(/終日/)
  })
  it('retains provider retrieval time and marks partial calendar snapshots', () => {
    const state = { ...initialState(), calendarSyncedAt: '2026-10-10T00:00:00Z' }
    const selected = projectWorkspace(state, [], {
      configured: true,
      connection: 'connected',
      phase: 'synced',
      error: '取得は一部',
    })
    expect(selected.calendar).toEqual({ state: 'partial', retrievedAt: state.calendarSyncedAt })
  })
})
