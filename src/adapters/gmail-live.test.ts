import { describe, expect, it, vi } from 'vitest'
import { GmailAdapterShell, type GmailGateway } from './gmail-shell'
import { MockCalendarProvider } from './mock-providers'
import { NullAIProvider } from './ai-providers'
import { createProviderRegistry } from '../ports/providers'
import { createTodayApplication } from '../application/today'
import { scenarioData } from '../evaluation/scenarios'
import { addCorrection } from '../domain/context-engine'
import { normalizePersistedState } from '../storage'
import { recentDiagnostics } from '../application/diagnostics'

const at = '2026-09-25T00:00:00.000Z'
const makeGateway = (overrides: Partial<GmailGateway> = {}): GmailGateway => ({
  connectionState: async () => ({ state: 'CONNECTED', configured: true }),
  authorizationUrl: async () => 'https://accounts.google.com/example',
  revoke: async () => ({ revoked: true }),
  listMetadata: async () => ({
    messages: [
      {
        id: 'm1',
        threadId: 'thread1',
        subject: 'Regarding 9/30 Surveying Practice',
        snippet: 'Bring field notebook',
        sender: 'Teacher <t@example.edu>',
        receivedAt: at,
        labels: ['INBOX'],
      },
      {
        id: 'noise',
        threadId: 'noise-thread',
        subject: 'Weekly newsletter',
        snippet: 'Promotions',
        receivedAt: at,
        labels: ['CATEGORY_PROMOTIONS'],
      },
    ],
    nextCursor: '100',
    reset: true,
  }),
  getRelevantMessage: async (id) => ({
    id,
    threadId: 'thread1',
    subject: 'Regarding 9/30 Surveying Practice',
    body: 'Bring your field notebook and writing materials.',
    receivedAt: at,
  }),
  ...overrides,
})
const makeApp = (gateway: GmailGateway) =>
  createTodayApplication(
    createProviderRegistry({
      calendar: new MockCalendarProvider(scenarioData('NORMAL_DAY').calendar),
      mail: new GmailAdapterShell(gateway),
      ai: new NullAIProvider(),
    }),
    { now: () => new Date('2026-09-25T07:00:00+09:00') },
  )

describe('live-shaped Gmail adapter through Today', () => {
  it('selects useful metadata, fetches only its body, and merges it with Calendar and a local task', async () => {
    const getRelevantMessage = vi.fn(makeGateway().getRelevantMessage)
    const app = makeApp(makeGateway({ getRelevantMessage }))
    const base = normalizePersistedState({
      version: 3,
      items: [...scenarioData('NORMAL_DAY').calendar, ...scenarioData('NORMAL_DAY').local],
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    })
    const page = await app.fetchMailPage()
    expect(getRelevantMessage).toHaveBeenCalledExactlyOnceWith('m1')
    const next = app.applyMailPage(base, page)
    expect(next.syncCursors?.['mail.gmail']?.opaque).toBe('100')
    expect(next.contexts).toHaveLength(1)
    expect(next.contexts?.[0].itemRefs).toHaveLength(3)
    expect(
      next.contexts?.[0].facts.find((fact) => fact.field === 'REQUIREMENT')?.provenance,
    ).toMatchObject({
      providerId: 'mail.gmail',
      externalId: 'm1',
      conversationId: 'thread1',
      extractionMethod: 'DETERMINISTIC',
    })
    expect(app.buildToday(next.items, next.contexts || []).items).toHaveLength(1)
    expect(
      recentDiagnostics()
        .filter((event) => event.event === 'provider.sync.committed')
        .at(-1),
    ).toMatchObject({
      provider: 'mail.gmail',
      examined: 2,
      accepted: 1,
      contextsCreated: 1,
      itemsShown: 1,
    })
    expect(app.applyMailPage(next, page)).toEqual(next)
  })

  it('preserves a time conflict and user correction across incremental refresh', async () => {
    const calendar = scenarioData('CONFLICT_DAY').calendar
    const gateway = makeGateway({
      listMetadata: async () => ({
        messages: [
          {
            id: 'moved',
            threadId: 'thread2',
            subject: 'Meeting moved to 09:30 on 9/30',
            snippet: 'Changed meeting time',
            receivedAt: at,
          },
        ],
        nextCursor: '101',
      }),
      getRelevantMessage: async () => ({
        id: 'moved',
        threadId: 'thread2',
        subject: 'Meeting moved to 09:30 on 9/30',
        body: 'Meeting moved to 09:30.',
        receivedAt: at,
      }),
    })
    const app = makeApp(gateway)
    const base = normalizePersistedState({
      version: 3,
      items: calendar,
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    })
    const page = await app.fetchMailPage()
    const first = app.applyMailPage(base, page)
    expect(first.contexts?.[0].conflicts).toHaveLength(1)
    const claim = first.contexts![0].conflicts[0].candidates.find(
      (fact) => fact.provenance.providerId === 'mail.gmail',
    )!
    const resolved = {
      ...first,
      conflictResolutions: [
        {
          conflictId: first.contexts![0].conflicts[0].id,
          providerId: claim.provenance.providerId,
          externalId: claim.provenance.externalId,
          value: claim.value,
          updatedAt: at,
        },
      ],
    }
    expect(
      app.applyMailPage(resolved, {
        ...page,
        reset: false,
        items: [],
        cursor: { opaque: '102', updatedAt: at },
      }).contexts?.[0].conflicts[0].resolutionState,
    ).toBe('USER_RESOLVED')
    const separate = {
      ...first,
      contextCorrections: addCorrection([], 'cal-meeting', 'mail.gmail:moved', 'separate', at),
    }
    expect(app.applyMailPage(separate, { ...page, reset: false, items: [] }).contexts).toHaveLength(
      0,
    )
  })

  it('removes only deleted Gmail messages, retaining local and Calendar data', async () => {
    const app = makeApp(makeGateway())
    const base = normalizePersistedState({
      version: 3,
      items: [...scenarioData('NORMAL_DAY').calendar, ...scenarioData('NORMAL_DAY').local],
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    })
    const first = app.applyMailPage(base, await app.fetchMailPage())
    const removed = app.applyMailPage(first, {
      items: [],
      deletedExternalIds: ['m1'],
      cursor: { opaque: '101', updatedAt: at },
      fetchedAt: at,
    })
    expect(removed.items.some((item) => item.sourceId === 'mail.gmail')).toBe(false)
    expect(removed.items.filter((item) => item.sourceId !== 'mail.gmail')).toEqual(base.items)
  })

  it('does not commit changes or a cursor when full-message retrieval fails', async () => {
    const app = makeApp(
      makeGateway({
        getRelevantMessage: async () => {
          throw { status: 500 }
        },
      }),
    )
    const base = normalizePersistedState({
      version: 3,
      items: scenarioData('NORMAL_DAY').local,
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    })
    await expect(app.fetchMailPage()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(base.syncCursors).toEqual({})
    expect(base.items).toHaveLength(1)
  })

  it('removes a previously useful message when its changed labels make it ignorable', async () => {
    const app = makeApp(makeGateway())
    const base = normalizePersistedState({
      version: 3,
      items: scenarioData('NORMAL_DAY').local,
      queuedActions: [],
      theme: 'system',
      showSamples: false,
    })
    const first = app.applyMailPage(base, await app.fetchMailPage())
    const changed = makeApp(
      makeGateway({
        listMetadata: async () => ({
          messages: [
            {
              id: 'm1',
              threadId: 'thread1',
              subject: 'Regarding 9/30 Surveying Practice',
              snippet: '',
              receivedAt: at,
              labels: ['CATEGORY_PROMOTIONS'],
            },
          ],
          nextCursor: '101',
          reset: false,
        }),
      }),
    )
    const second = changed.applyMailPage(
      first,
      await changed.fetchMailPage(first.syncCursors?.['mail.gmail']),
    )
    expect(second.items.some((item) => item.id === 'mail.gmail:m1')).toBe(false)
    expect(second.items.some((item) => item.sourceId === 'manual')).toBe(true)
  })
})
