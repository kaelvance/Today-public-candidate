import { describe, expect, it } from 'vitest'
import { buildContextGraph } from '../domain/context-engine'
import { ingestSourcePlugin, sourcePluginContract } from './source-plugin'
import { readingClubPlugin, readingClubSample } from './reading-club-plugin'

describe('public read-only source Plugin contract', () => {
  it('runs the reference Plugin through normalization and Today Context', async () => {
    expect(
      (await sourcePluginContract(readingClubPlugin, readingClubSample())).checks,
    ).toHaveLength(7)
    const ingested = await ingestSourcePlugin(readingClubPlugin, ['LOCAL_SAMPLE'])
    expect(ingested.state).toBe('CONNECTED')
    expect(ingested.items[0].sourceId).toBe('sample.reading-club')
    const graph = buildContextGraph(ingested.items)
    expect(graph.items).toHaveLength(1)
    expect(graph.diagnostics.items).toBe(1)
  })
  it('denies undeclared permission and isolates a failing Plugin', async () => {
    expect((await ingestSourcePlugin(readingClubPlugin, [])).failure).toBe('PERMISSION_REQUIRED')
    const broken = {
      ...readingClubPlugin,
      normalize: () => {
        throw new Error('bad_external_record')
      },
    }
    const result = await ingestSourcePlugin(broken, ['LOCAL_SAMPLE'])
    expect(result.state).toBe('DEGRADED')
    expect(result.items).toEqual([])
  })
  it('deduplicates by external identity and rejects write actions', async () => {
    const original = readingClubSample()
    const duplicate = {
      ...original,
      updatedAt: new Date(Date.parse(original.updatedAt) + 1000).toISOString(),
    }
    const plugin = { ...readingClubPlugin, fetchInitial: async () => [original, duplicate] }
    const accepted = await ingestSourcePlugin(plugin, ['LOCAL_SAMPLE'])
    expect(accepted.examined).toBe(2)
    expect(accepted.accepted).toBe(1)
    const malicious = {
      ...readingClubPlugin,
      normalize: (raw: typeof original, now: Date) => ({
        ...readingClubPlugin.normalize(raw, now),
        actions: [
          {
            id: 'send',
            label: 'send',
            type: 'open' as const,
            riskLevel: 3 as const,
            requiresConfirmation: false,
            plugin: readingClubPlugin.manifest.id,
          },
        ],
      }),
    }
    expect((await ingestSourcePlugin(malicious, ['LOCAL_SAMPLE'])).failure).toBe(
      'PLUGIN_NORMALIZATION_INVALID',
    )
  })
})
