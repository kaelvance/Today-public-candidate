import { describe, expect, it, vi } from 'vitest'
import { addCorrection, buildContextGraph, generateCandidates } from './context-engine'
import { toCanonical } from './model'
import { createScenarioApplication, scenarioData, scenarioItem } from '../evaluation/scenarios'
import { createProviderRegistry } from '../ports/providers'
import { MockCalendarProvider, MockMailProvider } from '../adapters/mock-providers'
import { NullAIProvider, MockAIProvider } from '../adapters/ai-providers'
import { createTodayApplication } from '../application/today'
import { normalizePersistedState } from '../storage'

const now = new Date('2026-09-25T07:00:00+09:00')

describe('context engine golden scenarios', () => {
  it('groups surveying schedule, instruction mail and preparation task without losing source items', async () => {
    const { app, data } = createScenarioApplication('NORMAL_DAY')
    const calendar = await app.refreshCalendar(data.local)
    const mail = await app.refreshMail(calendar.items)
    const graph = buildContextGraph(mail.items, [], now)
    expect(graph.contexts).toHaveLength(1)
    expect(graph.contexts[0].itemRefs).toHaveLength(3)
    expect(graph.contexts[0].canonicalTitle).toBe('Surveying Practice')
    expect(graph.contexts[0].requirements).toEqual(['field notebook', 'writing materials'])
    const projection = app.buildToday(mail.items, graph.contexts, now)
    expect(projection.items).toHaveLength(1)
    expect(projection.sourceItems).toHaveLength(3)
    expect(projection.compressionRatio).toBe(3)
    expect(projection.items[0].contextId).toBe(graph.contexts[0].id)
  })
  it('does not merge class and assignment on one generic keyword', () => {
    const data = scenarioData('AMBIGUOUS_CONTEXT')
    expect(buildContextGraph([...data.calendar, ...data.mail], [], now).contexts).toHaveLength(0)
  })
  it('retains both time claims when a mail reports a changed meeting', () => {
    const data = scenarioData('CONFLICT_DAY')
    const graph = buildContextGraph([...data.calendar, ...data.mail], [], now)
    expect(graph.contexts).toHaveLength(1)
    expect(graph.contexts[0].conflicts).toHaveLength(1)
    expect(
      graph.contexts[0].conflicts[0].candidates.map((fact) => fact.provenance.providerId).sort(),
    ).toEqual(['calendar.mock', 'mail.mock'])
    const conflict = graph.contexts[0].conflicts[0]
    const mailClaim = conflict.candidates.find(
      (fact) => fact.provenance.providerId === 'mail.mock',
    )!
    const resolved = buildContextGraph([...data.calendar, ...data.mail], [], now, {}, [
      {
        conflictId: conflict.id,
        providerId: mailClaim.provenance.providerId,
        externalId: mailClaim.provenance.externalId,
        value: mailClaim.value,
        updatedAt: now.toISOString(),
      },
    ])
    expect(resolved.contexts[0].conflicts[0].resolutionState).toBe('USER_RESOLVED')
    expect(new Date(resolved.contexts[0].temporal.startsAt!).getHours()).toBe(9)
    expect(resolved.contexts[0].conflicts[0].candidates).toHaveLength(2)
  })
  it('keeps similar titles from the same provider and distant dates separate', () => {
    const one = scenarioItem('one', 'event', 'Project Review', 'calendar.mock', {
      startAt: '2026-09-30T13:00:00+09:00',
    })
    const two = scenarioItem('two', 'event', 'Project Review', 'calendar.mock', {
      startAt: '2026-10-10T13:00:00+09:00',
    })
    expect(buildContextGraph([one, two], [], now).contexts).toHaveLength(0)
  })
  it('uses shared conversation identity as evidence only when titles are related', () => {
    const one = scenarioItem('mail-one', 'email', 'Surveying Practice instructions', 'mail.gmail', {
      conversationId: 'thread-a',
    })
    const two = scenarioItem('mail-two', 'email', 'Surveying Practice changed', 'mail.gmail', {
      conversationId: 'thread-a',
    })
    const unrelated = scenarioItem('mail-three', 'email', 'Dentist appointment', 'mail.gmail', {
      conversationId: 'thread-a',
    })
    const graph = buildContextGraph([one, two, unrelated], [], now)
    expect(graph.contexts).toHaveLength(1)
    expect(graph.contexts[0].itemRefs).toEqual(['mail-one', 'mail-two'])
  })
  it('respects persisted separation and forced link corrections', () => {
    const data = scenarioData('NORMAL_DAY')
    const items = [...data.calendar, ...data.mail, ...data.local]
    const separated = addCorrection([], 'cal-survey', 'mail-survey', 'separate', now.toISOString())
    const graph = buildContextGraph(items, separated, now)
    expect(
      graph.contexts.every(
        (context) =>
          !(context.itemRefs.includes('cal-survey') && context.itemRefs.includes('mail-survey')),
      ),
    ).toBe(true)
    const linked = addCorrection(separated, 'cal-survey', 'mail-survey', 'link', now.toISOString())
    expect(buildContextGraph(items, linked, now).contexts[0].itemRefs).toHaveLength(3)
  })
  it('is idempotent and bounds candidate pairs for unrelated history', () => {
    const data = scenarioData('NORMAL_DAY')
    const items = [...data.calendar, ...data.mail, ...data.local]
    expect(buildContextGraph(items, [], now).contexts).toEqual(
      buildContextGraph(items, [], now).contexts,
    )
    const history = Array.from({ length: 150 }, (_, n) =>
      scenarioItem(`item-${n}`, 'task', `Distinct task ${n}`, 'manual'),
    )
    const candidates = generateCandidates(history.map((item) => toCanonical(item, now)))
    expect(candidates.length).toBeLessThan(150 * 40)
  })
})

describe('provider replacement and failure isolation', () => {
  it('runs the same pipeline after replacing mail and AI providers', async () => {
    const data = scenarioData('NORMAL_DAY')
    const calendar = new MockCalendarProvider(data.calendar)
    const mail = new MockMailProvider(data.mail)
    const one = createTodayApplication(
      createProviderRegistry({ calendar, mail, ai: new NullAIProvider() }),
      { now: () => now },
    )
    const two = createTodayApplication(
      createProviderRegistry({
        calendar,
        mail: new MockMailProvider(data.mail),
        ai: new MockAIProvider(),
      }),
      { now: () => now },
    )
    for (const app of [one, two]) {
      const calendarPage = await app.refreshCalendar(data.local)
      const mailPage = await app.refreshMail(calendarPage.items)
      expect(app.reconcile(mailPage.items).contexts).toHaveLength(1)
    }
    await expect(
      one.interpretCapture(
        'unknown',
        { localTime: now.toISOString(), timeZone: 'Asia/Tokyo' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' })
  })
  it('isolates mail 401/429/offline/malformed failures from local and calendar items', async () => {
    const data = scenarioData('NORMAL_DAY')
    for (const failure of ['expired', 'rate-limit', 'offline', 'invalid'] as const) {
      const app = createTodayApplication(
        createProviderRegistry({
          calendar: new MockCalendarProvider(data.calendar),
          mail: new MockMailProvider(data.mail, failure),
          ai: new NullAIProvider(),
        }),
        { now: () => now },
      )
      const current = (await app.refreshCalendar(data.local)).items
      await expect(app.refreshMail(current)).rejects.toBeDefined()
      expect(current).toHaveLength(2)
      expect(current.some((item) => item.sourceId === 'manual')).toBe(true)
    }
  })
  it('migrates V1.2 source items, settings and calendar cache to version 3', () => {
    const data = scenarioData('NORMAL_DAY')
    const old = {
      version: 2,
      items: [...data.local, ...data.calendar],
      queuedActions: [],
      theme: 'dark',
      showSamples: false,
      calendarSyncedAt: now.toISOString(),
      aiEnabled: true,
    }
    const migrated = normalizePersistedState(old)
    expect(migrated.version).toBe(3)
    expect(migrated.items.map((item) => item.id)).toEqual(['task-notebook', 'cal-survey'])
    expect(migrated.calendarSyncedAt).toBe(now.toISOString())
    expect(migrated.theme).toBe('dark')
    expect(migrated.aiEnabled).toBe(true)
    expect(migrated.contextCorrections).toEqual([])
  })
  it('keeps deterministic contexts when AI returns invalid, times out, or is unavailable', async () => {
    const data = scenarioData('NORMAL_DAY')
    const source = [...data.calendar, ...data.mail, ...data.local]
    for (const mode of ['malformed', 'timeout', 'unavailable', 'low-confidence'] as const) {
      const ai = new MockAIProvider(mode, 1)
      try {
        await ai.interpretCapture('ambiguous text')
      } catch {
        /* Fallback is the deterministic graph. */
      }
      expect(buildContextGraph(source, [], now).contexts[0].itemRefs).toHaveLength(3)
    }
  })
  it('backs off a repeatedly failing provider without affecting calendar or local items', async () => {
    const data = scenarioData('NORMAL_DAY')
    const mail = new MockMailProvider(data.mail, 'offline')
    const fetchChanges = vi.spyOn(mail, 'fetchChanges')
    const app = createTodayApplication(
      createProviderRegistry({
        calendar: new MockCalendarProvider(data.calendar),
        mail,
        ai: new NullAIProvider(),
      }),
      { now: () => now },
    )
    const current = (await app.refreshCalendar(data.local)).items
    for (let attempt = 0; attempt < 4; attempt += 1)
      await expect(app.refreshMail(current)).rejects.toBeDefined()
    expect(fetchChanges).toHaveBeenCalledTimes(3)
    expect(current).toHaveLength(2)
  })
})
