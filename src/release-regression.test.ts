import { describe, expect, it } from 'vitest'
import { IntelligenceRouter, intelligenceRequest } from './intelligence/router'
import { defaultPolicy, type IntelligenceProvider } from './intelligence/types'
import { normalizePersistedState } from './storage'
import { validateCaptureInterpretation } from './ai'
import { ingestSourcePlugin } from './extensions/source-plugin'
import { readingClubPlugin } from './extensions/reading-club-plugin'

describe('release boundary regression', () => {
  const input = () =>
    intelligenceRequest(
      'classifyItem',
      { item: { id: 'fixture', title: 'fictional', sourceId: 'manual' } },
      'PUBLIC',
      'fixture',
      {
        budget: {
          latencyMs: 20,
          maxInputChars: 1000,
          maxOutputChars: 1000,
          maxContextItems: 2,
          maxCalls: 1,
        },
      },
    )
  const make = (available: () => Promise<boolean>): IntelligenceProvider => ({
    id: 'fixture.local',
    locality: 'local',
    modelClass: 'LOCAL_FAST',
    capabilities: () => ['classifyItem'],
    available,
    infer: async () => {
      throw new Error('must-not-run')
    },
  })

  it('bounds availability checks and releases concurrency after timeout', async () => {
    const router = new IntelligenceRouter([make(() => new Promise(() => {}))], defaultPolicy)
    const first = await router.route(input(), new AbortController().signal)
    expect(first).toEqual({ status: 'deterministic', reason: 'TIMEOUT' })
    expect(await router.route(input(), new AbortController().signal)).toEqual(first)
  })
  it('cancels while availability is pending and prevents later inference', async () => {
    let resolve!: (available: boolean) => void
    const provider = make(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const router = new IntelligenceRouter([provider], defaultPolicy)
    const controller = new AbortController()
    const operation = router.route(input(), controller.signal)
    controller.abort()
    expect(await operation).toEqual({ status: 'rejected', reason: 'CANCELLED' })
    resolve(true)
    await Promise.resolve()
    expect(router.diagnostics).toHaveLength(1)
  })
  it('does not accept prototype keys from persisted provider maps', () => {
    const parsed = JSON.parse(
      '{"providerStates":{"__proto__":"CONNECTED","safe":"OFFLINE"},"syncCursors":{"__proto__":{"opaque":"x","updatedAt":"2026-01-01"}}}',
    )
    const state = normalizePersistedState(parsed)
    expect(Object.keys(state.providerStates!)).toEqual(['safe'])
    expect(Object.keys(state.syncCursors!)).toEqual([])
    expect(({} as Record<string, unknown>).opaque).toBeUndefined()
  })
  it('normalizes malformed old state without silently enabling remote AI', () => {
    const state = normalizePersistedState({
      version: 1,
      items: [
        null,
        {},
        { kind: 'task', id: 'x', title: 'fictional', sourceId: 'manual', importance: '3' },
      ],
      queuedActions: [null],
      intelligenceMode: 'INVALID',
    })
    expect(state.version).toBe(3)
    expect(state.items).toHaveLength(1)
    expect(state.items[0].importance).toBe(2)
    expect(state.aiEnabled).toBe(false)
    expect(state.remotePrivateConsent).toBe(false)
  })
  it('rejects coerced importance in remote model output', () => {
    expect(
      validateCaptureInterpretation({
        intent: 'task',
        title: 'fictional',
        date: null,
        importance: '3',
        confidence: 'high',
      }),
    ).toBeNull()
  })
  it.each([NaN, -1, undefined, '0'])('rejects malformed Plugin action risk %s', async (risk) => {
    const plugin = {
      ...readingClubPlugin,
      normalize: (...args: Parameters<typeof readingClubPlugin.normalize>) => {
        const item = readingClubPlugin.normalize(...args)
        return { ...item, actions: [{ ...item.actions[0], riskLevel: risk }] } as typeof item
      },
    }
    expect((await ingestSourcePlugin(plugin, ['LOCAL_SAMPLE'])).failure).toBe(
      'PLUGIN_NORMALIZATION_INVALID',
    )
  })
})
