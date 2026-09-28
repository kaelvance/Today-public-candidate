import { describe, expect, it, vi } from 'vitest'
import { parseCapture, shouldUseAI } from './capture'
import { makeBackup, mergeBackup } from './backup'
import { demoItems } from './data'
import { validateAIEnrichment, validateCaptureInterpretation } from './ai'
import { orchestrateItems, actionPolicy } from './orchestration'
import { localPriorityProvider } from './priority'
import { assertPluginAction, plugins, type Plugin } from './plugins'
import { normalizePersistedState } from './storage'
import { enqueueRemoteAction, replayQueue } from './sync'
import type { ItemAction, PersistedState } from './types'

// Capture interprets local calendar language; preserve this date in every test timezone.
const fixed = new Date(2026, 8, 25, 7, 0, 0)

describe('quick capture', () => {
  it('extracts a Japanese weekday deadline and keeps the original text', () => {
    const result = parseCapture('数学プリント金曜まで', fixed)
    expect(result.title).toBe('数学プリント')
    expect(result.kind).toBe('task')
    expect(result.date).toBeDefined()
    expect(new Date(result.date!).getDay()).toBe(5)
    expect(result.sourceText).toBe('数学プリント金曜まで')
  })
  it('keeps unrecognized input intact', () => {
    expect(parseCapture('Review the long source title', fixed).title).toBe(
      'Review the long source title',
    )
  })
  it('does not invent a deadline from an invalid date', () => {
    const result = parseCapture('提出 2026-02-30', fixed)
    expect(result.date).toBeUndefined()
    expect(result.title).toContain('2026-02-30')
  })
  it('recognizes a timed appointment', () => {
    const result = parseCapture('病院予約 明日 10:30', fixed)
    expect(result.kind).toBe('event')
    expect(new Date(result.date!).getHours()).toBe(10)
  })
  it('recognizes Japanese dates and times without inserted spaces', () => {
    const result = parseCapture('病院予約2026年9月26日10時半', fixed)
    expect(result.kind).toBe('event')
    expect(result.title).toBe('病院予約')
    expect(new Date(result.date!).getDate()).toBe(26)
    expect(new Date(result.date!).getHours()).toBe(10)
    expect(new Date(result.date!).getMinutes()).toBe(30)
  })
  it.each([
    ['明日数学プリント提出', '数学プリント提出', 'task', 26, 23],
    ['明日の17時までに数学プリント提出', '数学プリント提出', 'task', 26, 17],
    ['金曜日に体操服持っていく', '体操服持っていく', 'task', 25, 23],
    ['9月30日18時に歯医者', '歯医者', 'event', 30, 18],
    ['来週月曜にレポート確認', 'レポート確認', 'task', 28, 23],
    ['明日の朝メール確認', 'メール確認', 'task', 26, 9],
    ['今日の20時に宿題', '宿題', 'task', 25, 20],
    ['Buy notebook tomorrow', 'Buy notebook', 'task', 26, 23],
    ['Meeting Friday at 4pm', 'Meeting', 'event', 25, 16],
    ['金曜 16:00 meeting', 'meeting', 'event', 25, 16],
  ])('interprets %s', (input, title, kind, day, hour) => {
    const result = parseCapture(input, fixed)
    expect(result.title).toBe(title)
    expect(result.kind).toBe(kind)
    expect(new Date(result.date!).getDate()).toBe(day)
    expect(new Date(result.date!).getHours()).toBe(hour)
  })
  it('only calls external interpretation for unresolved temporal language', () => {
    expect(shouldUseAI('来週までにレポート', parseCapture('来週までにレポート', fixed))).toBe(true)
    expect(parseCapture('再来週に企画書提出', fixed).title).toBe('企画書提出')
    expect(shouldUseAI('Buy notebook', parseCapture('Buy notebook', fixed))).toBe(false)
    expect(
      shouldUseAI(
        '明日の17時までに数学プリント提出',
        parseCapture('明日の17時までに数学プリント提出', fixed),
      ),
    ).toBe(false)
  })
})

describe('priority and orchestration', () => {
  it('keeps ranking deterministic without an AI service', () => {
    const items = demoItems()
    items[0].deadline = new Date(fixed.getTime() + 60 * 60 * 1000).toISOString()
    items[1].startAt = new Date(fixed.getTime() + 24 * 60 * 60 * 1000).toISOString()
    const ranks = localPriorityProvider.rank(items, fixed)
    expect(ranks[0].itemId).toBe('demo-english')
    expect(ranks[0].reason).toContain('期限')
  })
  it('moves snoozed and past events to Later', () => {
    const items = demoItems()
    items[0].snoozedUntil = new Date(fixed.getTime() + 86_400_000).toISOString()
    items[1].startAt = new Date(fixed.getTime() - 3 * 3_600_000).toISOString()
    const result = localPriorityProvider.rank(items, fixed)
    expect(result.find((rank) => rank.itemId === 'demo-english')?.layer).toBe('later')
    expect(result.find((rank) => rank.itemId === 'demo-hospital')?.layer).toBe('later')
  })
  it('uses the deterministic fallback when an AI provider fails', () => {
    const model = orchestrateItems(demoItems(), plugins, {
      rank: () => {
        throw new Error('AI unavailable')
      },
    })
    expect(model.usedFallback).toBe(true)
    expect(model.priorities.length).toBe(4)
  })
  it('handles 100+ items without dropping equal titles from the manual source', () => {
    const template = demoItems()[0]
    const items = Array.from({ length: 150 }, (_, index) => ({
      ...template,
      id: `manual-${index}`,
      sourceId: 'manual',
      source: '自分で追加',
      demo: false,
      actions: template.actions.map((action) => ({ ...action, plugin: 'manual' })),
    }))
    const model = orchestrateItems(items, plugins)
    expect(model.items).toHaveLength(150)
    expect(model.priorities).toHaveLength(150)
  })
  it('keeps unavailable-plugin data visible but limits actions to reading', () => {
    const item = { ...demoItems()[0], id: 'unknown', sourceId: 'unavailable', demo: false }
    const model = orchestrateItems([item], plugins)
    expect(model.items[0].syncStatus).toBe('failed')
    expect(model.items[0].actions.every((action) => action.type === 'view')).toBe(true)
  })
})

describe('boundaries and storage', () => {
  it('rejects malformed AI output and excessive priority adjustments', () => {
    expect(
      validateAIEnrichment({
        classification: 'task',
        priorityAdjustment: 5,
        confidence: 0.8,
        suggestedAction: null,
      }),
    ).not.toBeNull()
    expect(
      validateAIEnrichment({
        classification: 'task',
        priorityAdjustment: 999,
        confidence: 0.8,
        suggestedAction: null,
      }),
    ).toBeNull()
    expect(validateAIEnrichment('send everything')).toBeNull()
    expect(
      validateCaptureInterpretation({
        intent: 'task',
        title: 'Report',
        date: '2026-09-28T23:59:00+09:00',
        importance: 2,
        confidence: 'medium',
      }),
    ).not.toBeNull()
    expect(
      validateCaptureInterpretation({
        intent: 'task',
        title: 'Report',
        date: 'next week',
        importance: 2,
        confidence: 'medium',
      }),
    ).toBeNull()
  })
  it('validates stored data and migrates the previous snapshot', () => {
    const legacy = {
      items: [demoItems()[0], { kind: 'task', title: '<img>', id: '' }],
      queuedActions: [],
      theme: 'dark',
    }
    const state = normalizePersistedState(legacy)
    expect(state.version).toBe(3)
    expect(state.items).toHaveLength(1)
    expect(state.showSamples).toBe(true)
    expect(state.theme).toBe('dark')
  })
  it('round-trips a local backup without duplicating existing items', () => {
    const manual = {
      ...demoItems()[0],
      id: 'user-1',
      sourceId: 'manual',
      source: '自分で追加',
      demo: false,
    }
    const state: PersistedState = {
      version: 3,
      items: [manual],
      queuedActions: [],
      theme: 'dark',
      showSamples: false,
    }
    const backup = JSON.parse(makeBackup(state)) as unknown
    const empty: PersistedState = {
      version: 3,
      items: [],
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    }
    expect(mergeBackup(empty, backup).added).toBe(1)
    expect(mergeBackup(state, backup).added).toBe(0)
    expect(() => mergeBackup(state, { app: 'Other', version: 2, state })).toThrow('invalid_backup')
  })
  it('excludes read-only calendar cache from manual backups', () => {
    const template = demoItems()[0]
    const manual = { ...template, id: 'manual-1', sourceId: 'manual', demo: false }
    const calendar = {
      ...template,
      id: 'google-calendar:1',
      sourceId: 'google-calendar',
      demo: false,
    }
    const state: PersistedState = {
      version: 3,
      items: [manual, calendar],
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    }
    const backup = JSON.parse(makeBackup(state)) as { state: { items: Array<{ id: string }> } }
    expect(backup.state.items.map((item) => item.id)).toEqual(['manual-1'])
  })
  it('blocks undeclared plugin communication and RISK_4', () => {
    const item = demoItems()[3]
    const send: ItemAction = {
      id: 'send',
      label: 'Send',
      type: 'compose',
      plugin: item.sourceId,
      riskLevel: 3,
      requiresConfirmation: true,
    }
    expect(() => assertPluginAction(plugins[item.sourceId], send)).toThrow('permission_denied')
    expect(actionPolicy(item, { ...send, riskLevel: 4 })).toBe('blocked')
  })
  it('keeps failed remote actions queued and reuses the idempotency key', async () => {
    const item = demoItems()[0]
    const write: ItemAction = {
      id: 'remote-write',
      label: 'Save',
      type: 'open',
      plugin: item.sourceId,
      riskLevel: 2,
      requiresConfirmation: true,
    }
    item.actions.push(write)
    const state: PersistedState = {
      version: 3,
      items: [item],
      queuedActions: [],
      theme: 'system',
      showSamples: true,
    }
    const queued = enqueueRemoteAction(state, item, write, 'fixed-key')
    const executeAction = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined)
    const plugin: Plugin = {
      ...plugins[item.sourceId],
      permissions: { read: true, write: true, communicate: false },
      executeAction,
    }
    const failed = await replayQueue(queued, { [item.sourceId]: plugin })
    expect(failed.failed).toBe(1)
    expect(failed.state.queuedActions[0].status).toBe('failed')
    const untouched = await replayQueue(failed.state, { [item.sourceId]: plugin })
    expect(untouched.failed).toBe(0)
    expect(executeAction).toHaveBeenCalledTimes(1)
    const retried = {
      ...failed.state,
      queuedActions: failed.state.queuedActions.map((action) => ({
        ...action,
        status: 'pending' as const,
      })),
    }
    const succeeded = await replayQueue(retried, { [item.sourceId]: plugin })
    expect(succeeded.completed).toBe(1)
    expect(succeeded.state.queuedActions).toHaveLength(0)
    expect(executeAction.mock.calls[0][2]).toBe('fixed-key')
    expect(executeAction.mock.calls[1][2]).toBe('fixed-key')
  })
})
