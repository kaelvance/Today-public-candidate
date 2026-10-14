import { describe, expect, it } from 'vitest'
import { makeBackup } from '../backup'
import type { Item, PersistedState } from '../types'
import { inspectFixtureV2Backup } from './fixture-migration'

const stamp = '2026-10-11T00:00:00.000Z'
const now = new Date(stamp)
function item(id: string, changes: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'task',
    title: '架空の移行検証',
    description: '合成データのみ',
    source: '手動',
    sourceId: 'manual',
    createdAt: stamp,
    importance: 2,
    pinned: true,
    snoozedUntil: '2026-10-12T00:00:00.000Z',
    requiresAction: true,
    confidence: 'high',
    status: 'active',
    syncStatus: 'synced',
    lastUpdated: stamp,
    sourceUpdatedAt: stamp,
    demo: false,
    actions: [
      {
        id: 'view',
        label: '詳細を見る',
        type: 'view',
        plugin: 'manual',
        riskLevel: 0,
        requiresConfirmation: false,
      },
    ],
    ...changes,
  }
}
function backup(items = [item('fixture-task')]) {
  const state: PersistedState = {
    version: 3,
    items,
    theme: 'dark',
    showSamples: false,
    queuedActions: [],
  }
  const exported = JSON.parse(makeBackup(state))
  exported.exportedAt = stamp // deterministic synthetic clock; format is the actual V2 exporter
  return exported
}
const inspect = (value: unknown) =>
  inspectFixtureV2Backup({ fixtureOnly: true, backupJSON: JSON.stringify(value), now })
describe('fictional V2 backup dry-run migration', () => {
  it('preserves IDs/status/pin/snooze/dates/description without writing, retains exact source bytes', () => {
    const value = backup([
      item('fixture-active'),
      item('fixture-done', { status: 'done' }),
      item('fixture-dismissed', { status: 'dismissed' }),
      item('fixture-event', {
        kind: 'event',
        startAt: '2026-10-12T09:00:00+09:00',
        endAt: '2026-10-12T10:00:00+09:00',
        allDay: false,
      }),
    ])
    const text = JSON.stringify(value, null, 2),
      before = JSON.stringify(value)
    const result = inspectFixtureV2Backup({ fixtureOnly: true, backupJSON: text, now })
    expect(result.status).toBe('DRY_RUN_COMPATIBLE')
    expect(result.sourceArchive).toBe(text)
    expect(JSON.stringify(value)).toBe(before)
    for (const raw of value.state.items)
      expect(result.candidateState?.items.find((v) => v.id === raw.id)).toMatchObject(raw)
    expect(result.candidateState?.theme).toBe('dark')
    expect(result.gatewayDomainRevision).toBeNull()
  })
  it('all-day UTC instants block migration rather than guess a floating date', () => {
    const result = inspect(
      backup([item('fixture-all-day', { kind: 'event', allDay: true, startAt: stamp })]),
    )
    expect(result.findings).toContainEqual({
      code: 'ALL_DAY_FLOATING_DATE_UNRECOVERABLE',
      itemId: 'fixture-all-day',
    })
    expect(result.candidateState).toBeNull()
  })
  it('duplicate IDs and missing source times block; normalizer cannot invent a timestamp', () => {
    const duplicate = backup()
    duplicate.state.items.push(duplicate.state.items[0])
    expect(inspect(duplicate).findings.some((f) => f.code === 'DUPLICATE_ID')).toBe(true)
    const value = backup()
    delete value.state.items[0].sourceUpdatedAt
    const result = inspect(value)
    expect(result.findings.some((f) => f.code === 'MISSING_OR_INVALID_SOURCE_TIME')).toBe(true)
    expect(result.candidateState).toBeNull()
  })
  it('reports field loss, truncation and action payload removal rather than silently sanitizing migration', () => {
    const value = backup()
    value.state.items[0].title = 'a'.repeat(201)
    value.state.items[0].unknownField = 'fixture-extra'
    value.state.items[0].actions[0].payload = { url: 'https://example.invalid/' }
    const result = inspect(value)
    expect(result.findings).toContainEqual({
      code: 'LOSSY_NORMALIZATION',
      itemId: 'fixture-task',
      fields: ['title', 'actions', 'unknownField'],
    })
    expect(result.candidateState).toBeNull()
  })
  it('source provider records, pending operations and extra state are blocked for separate reconciliation', () => {
    const value = backup()
    value.state.items[0].sourceId = 'google-calendar'
    value.state.queuedActions = [{ id: 'fixture-pending' }]
    value.state.contexts = [{ id: 'fixture-context' }]
    const codes = inspect(value).findings.map((f) => f.code)
    expect(codes).toContain('NON_MANUAL_EXPORT_RECORD')
    expect(codes).toContain('PENDING_OPERATIONS_REQUIRE_RECONCILIATION')
    expect(codes).toContain('STATE_FIELDS_NOT_IN_MANUAL_EXPORT')
  })
  it('rejects malformed, excess, unsupported or non-fixture input before reading storage', () => {
    expect(() => inspectFixtureV2Backup({ fixtureOnly: false, backupJSON: '{}', now })).toThrow(
      'fixture_opt_in_required',
    )
    expect(() => inspectFixtureV2Backup({ fixtureOnly: true, backupJSON: '[]', now })).toThrow(
      'invalid_backup',
    )
    expect(() => inspectFixtureV2Backup({ fixtureOnly: true, backupJSON: '{', now })).toThrow(
      'invalid_backup_json',
    )
    expect(() =>
      inspectFixtureV2Backup({ fixtureOnly: true, backupJSON: ' '.repeat(2_097_153), now }),
    ).toThrow('invalid_fixture_input')
    const value = backup()
    value.state.items[0].id = 'real-unapproved-record'
    expect(() => inspect(value)).toThrow('fictional_item_ids_required')
    value.version = 999
    expect(() => inspect(value)).toThrow('invalid_backup')
  })
  it('future source/export time, reversed event range and unsupported revisions require review', () => {
    const value = backup([
      item('fixture-time', {
        kind: 'event',
        startAt: '2026-10-12T10:00:00.000Z',
        endAt: stamp,
        sourceUpdatedAt: '2026-10-13T00:00:00.000Z',
      }),
    ])
    value.exportedAt = '2026-10-14T00:00:00.000Z'
    value.state.items[0].revision = 5
    const codes = inspect(value).findings.map((f) => f.code)
    for (const code of [
      'FUTURE_EXPORT_TIME',
      'FUTURE_SOURCE_TIME',
      'INVALID_EVENT_RANGE',
      'UNSUPPORTED_ITEM_REVISION',
    ])
      expect(codes).toContain(code)
    expect(inspect(value).candidateState).toBeNull()
  })
})
