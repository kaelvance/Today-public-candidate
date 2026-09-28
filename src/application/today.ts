import { buildContextGraph } from '../domain/context-engine'
import type {
  ConflictResolution,
  Context,
  ContextCorrection,
  ContextDiagnostics,
} from '../domain/model'
import type {
  Clock,
  ConnectionState,
  ProviderPage,
  ProviderRegistry,
  SyncCursor,
} from '../ports/providers'
import { ProviderFailure } from '../ports/providers'
import { orchestrateItems, type TodayModel } from '../orchestration'
import { plugins } from '../plugins'
import { localPriorityProvider } from '../priority'
import type { Item, PersistedState } from '../types'
import type { CaptureInterpretation } from '../ai'
import { projectToday } from './projection'
import { recordDiagnostic } from './diagnostics'
import { proposeContextRelation } from '../intelligence/context-service'
import type { IntelligenceRouter } from '../intelligence/router'
import type { RouteResult } from '../intelligence/types'

export interface TodayApplication {
  calendarStatus(): Promise<ConnectionState>
  mailStatus(): Promise<ConnectionState>
  connectMail(): Promise<{ url: string }>
  disconnectMail(): Promise<{ revoked: boolean }>
  fetchMailPage(cursor?: SyncCursor): Promise<ProviderPage>
  applyMailPage(current: PersistedState, page: ProviderPage): PersistedState
  connectCalendar(): Promise<{ url: string }>
  disconnectCalendar(): Promise<{ revoked: boolean }>
  refreshCalendar(
    current: Item[],
  ): Promise<{ items: Item[]; fetchedAt: string; truncated: boolean }>
  mergeCalendar(current: Item[], fresh: Item[]): Item[]
  refreshMail(current: Item[], cursor?: SyncCursor): Promise<{ items: Item[]; cursor?: SyncCursor }>
  aiAvailable(): Promise<boolean>
  interpretCapture(
    input: string,
    context: { localTime: string; timeZone: string },
    signal: AbortSignal,
  ): Promise<CaptureInterpretation>
  proposeRelation(
    left: Item,
    right: Item,
    corrections: ContextCorrection[],
    signal: AbortSignal,
  ): Promise<RouteResult<'compareContextCandidates'>>
  reconcile(
    items: Item[],
    corrections?: ContextCorrection[],
    resolutions?: ConflictResolution[],
  ): { contexts: Context[]; diagnostics: ContextDiagnostics }
  buildToday(
    items: Item[],
    contexts: Context[],
    now?: Date,
  ): TodayModel & { contexts: Context[]; sourceItems: Item[]; compressionRatio: number }
}

export function createTodayApplication(
  registry: ProviderRegistry,
  clock: Clock = { now: () => new Date() },
  intelligence?: IntelligenceRouter,
): TodayApplication {
  const failures = new Map<string, { count: number; retryAt: number }>()
  const guarded = async <T>(id: string, operation: () => Promise<T>): Promise<T> => {
    const previous = failures.get(id)
    if (previous && clock.now().getTime() < previous.retryAt)
      throw new ProviderFailure('PROVIDER_UNAVAILABLE')
    try {
      const result = await operation()
      failures.delete(id)
      return result
    } catch (error) {
      const count = Math.min(8, (previous?.count || 0) + 1)
      failures.set(id, {
        count,
        retryAt: count >= 3 ? clock.now().getTime() + Math.min(60_000, 1000 * 2 ** (count - 3)) : 0,
      })
      throw error
    }
  }
  const mergeProvider = (current: Item[], fresh: Item[], sourceId: string) => {
    const old = new Map(
      current.filter((item) => item.sourceId === sourceId).map((item) => [item.id, item]),
    )
    const unique = new Map(fresh.map((item) => [item.id, item]))
    return [
      ...current.filter((item) => item.sourceId !== sourceId),
      ...[...unique.values()].map((item) => {
        const previous = old.get(item.id)
        return previous
          ? {
              ...item,
              importance: previous.importance,
              pinned: previous.pinned,
              snoozedUntil: previous.snoozedUntil,
              status: previous.status,
            }
          : item
      }),
    ]
  }
  const mergeMailPage = (current: Item[], page: ProviderPage, sourceId: string) => {
    const deleted = new Set(page.deletedExternalIds || [])
    const old = new Map(
      current.filter((item) => item.sourceId === sourceId).map((item) => [item.id, item]),
    )
    const base = current.filter(
      (item) => item.sourceId !== sourceId || (!page.reset && !deleted.has(item.externalId || '')),
    )
    const merged = new Map(base.map((item) => [item.id, item]))
    for (const item of page.items) {
      const previous = old.get(item.id)
      const next = previous
        ? {
            ...item,
            importance: previous.importance,
            pinned: previous.pinned,
            snoozedUntil: previous.snoozedUntil,
            status: previous.status,
          }
        : item
      const stable =
        previous &&
        previous.title === next.title &&
        previous.description === next.description &&
        previous.mailClassification === next.mailClassification &&
        previous.conversationId === next.conversationId &&
        previous.requiresAction === next.requiresAction
      merged.set(item.id, stable ? previous : next)
    }
    return [...merged.values()]
  }
  return {
    calendarStatus: () => registry.calendar().connectionState(),
    mailStatus: () => registry.mail().connectionState(),
    connectMail: () => registry.mail().connect(),
    disconnectMail: () => registry.mail().disconnect(),
    connectCalendar: () => registry.calendar().connect(),
    disconnectCalendar: () => registry.calendar().disconnect(),
    async refreshCalendar(current) {
      const started = performance.now()
      let page
      try {
        page = await guarded(registry.calendar().id, () => registry.calendar().fetchEvents())
      } catch (error) {
        recordDiagnostic({
          event: 'provider.refresh.failed',
          at: clock.now().toISOString(),
          provider: registry.calendar().id,
          failure: error instanceof ProviderFailure ? error.code : 'UNKNOWN',
        })
        throw error
      }
      recordDiagnostic({
        event: 'provider.refresh.completed',
        at: clock.now().toISOString(),
        provider: registry.calendar().id,
        items: page.items.length,
        durationMs: Number((performance.now() - started).toFixed(2)),
      })
      return {
        items: mergeProvider(
          current,
          page.items,
          page.items[0]?.sourceId ||
            (registry.calendar().id === 'calendar.google'
              ? 'google-calendar'
              : registry.calendar().id),
        ),
        fetchedAt: page.fetchedAt,
        truncated: !!page.truncated,
      }
    },
    mergeCalendar: (current, fresh) =>
      mergeProvider(
        current,
        fresh,
        fresh[0]?.sourceId ||
          (registry.calendar().id === 'calendar.google'
            ? 'google-calendar'
            : registry.calendar().id),
      ),
    async fetchMailPage(cursor) {
      const started = performance.now()
      let page
      try {
        page = await guarded(registry.mail().id, () => registry.mail().fetchChanges(cursor))
      } catch (error) {
        recordDiagnostic({
          event: 'provider.refresh.failed',
          at: clock.now().toISOString(),
          provider: registry.mail().id,
          failure: error instanceof ProviderFailure ? error.code : 'UNKNOWN',
        })
        throw error
      }
      recordDiagnostic({
        event: 'provider.refresh.completed',
        at: clock.now().toISOString(),
        provider: registry.mail().id,
        items: page.items.length,
        examined: page.examined,
        accepted: page.accepted,
        durationMs: Number((performance.now() - started).toFixed(2)),
      })
      return page
    },
    applyMailPage(current, page) {
      const items = mergeMailPage(current.items, page, registry.mail().id)
      const contexts = buildContextGraph(
        items,
        current.contextCorrections || [],
        clock.now(),
        {},
        current.conflictResolutions || [],
      ).contexts
      const previous = current.contexts || []
      const contextsCreated = contexts.filter(
        (context) =>
          !previous.some((old) => old.itemRefs.some((id) => context.itemRefs.includes(id))),
      ).length
      const contextsEnriched = contexts.filter((context) =>
        previous.some(
          (old) =>
            old.itemRefs.some((id) => context.itemRefs.includes(id)) &&
            context.itemRefs.some((id) => !old.itemRefs.includes(id)),
        ),
      ).length
      recordDiagnostic({
        event: 'provider.sync.committed',
        at: clock.now().toISOString(),
        provider: registry.mail().id,
        examined: page.examined,
        accepted: page.accepted,
        contexts: contexts.length,
        contextsCreated,
        contextsEnriched,
        itemsShown: projectToday(items, contexts).items.length,
      })
      return {
        ...current,
        items,
        contexts,
        mailSyncedAt: page.fetchedAt,
        syncCursors: {
          ...current.syncCursors,
          ...(page.cursor ? { [registry.mail().id]: page.cursor } : {}),
        },
        providerStates: { ...current.providerStates, [registry.mail().id]: 'CONNECTED' },
      }
    },
    async refreshMail(current, cursor) {
      const page = await this.fetchMailPage(cursor)
      return { items: mergeMailPage(current, page, registry.mail().id), cursor: page.cursor }
    },
    async aiAvailable() {
      try {
        const state = await registry.ai().connectionState()
        return (
          state.configured &&
          registry.ai().capabilities().structuredOutput === true &&
          state.state === 'CONNECTED'
        )
      } catch {
        return false
      }
    },
    async interpretCapture(input, context, signal) {
      if (!registry.ai().capabilities().structuredOutput)
        throw new ProviderFailure('CONFIGURATION_MISSING')
      try {
        const result = await registry.ai().interpretCapture(input, context, signal)
        recordDiagnostic({
          event: 'ai.interpret.completed',
          at: clock.now().toISOString(),
          provider: registry.ai().id,
        })
        return result
      } catch (error) {
        recordDiagnostic({
          event: 'ai.interpret.failed',
          at: clock.now().toISOString(),
          provider: registry.ai().id,
          failure: error instanceof ProviderFailure ? error.code : 'UNKNOWN',
        })
        throw error
      }
    },
    proposeRelation(left, right, corrections, signal) {
      return intelligence
        ? proposeContextRelation(intelligence, left, right, corrections, signal)
        : Promise.resolve({ status: 'deterministic', reason: 'NO_INTELLIGENCE_ROUTER' })
    },
    reconcile(items, corrections = [], resolutions = []) {
      const started = performance.now()
      const graph = buildContextGraph(items, corrections, clock.now(), {}, resolutions)
      const diagnostics = {
        ...graph.diagnostics,
        durationMs: Number((performance.now() - started).toFixed(2)),
      }
      recordDiagnostic({
        event: 'context.reconcile.completed',
        at: clock.now().toISOString(),
        items: diagnostics.items,
        candidates: diagnostics.candidatePairs,
        contexts: diagnostics.contexts,
        conflicts: diagnostics.conflicts,
        durationMs: diagnostics.durationMs,
      })
      return { contexts: graph.contexts, diagnostics }
    },
    buildToday(items, contexts, now = clock.now()) {
      const projection = projectToday(items, contexts)
      const model = orchestrateItems(projection.items, plugins, localPriorityProvider, now)
      return {
        ...model,
        contexts,
        sourceItems: items,
        compressionRatio: projection.compressionRatio,
      }
    },
  }
}
