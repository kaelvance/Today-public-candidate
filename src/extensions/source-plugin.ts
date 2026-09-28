import type { Item } from '../types'

export const SOURCE_PLUGIN_API_VERSION = 1 as const
export type SourceCapability = 'READ_ITEMS' | 'INCREMENTAL_SYNC' | 'FETCH_DETAIL'
export type SourcePermission = 'LOCAL_SAMPLE' | 'NETWORK_READ'
export interface SourcePluginManifest {
  apiVersion: typeof SOURCE_PLUGIN_API_VERSION
  id: string
  name: string
  version: string
  description: string
  license: string
  capabilities: SourceCapability[]
  permissions: SourcePermission[]
  stability: 'EXPERIMENTAL'
}
export interface SourcePlugin<Raw> {
  readonly manifest: SourcePluginManifest
  fetchInitial(signal: AbortSignal): Promise<Raw[]>
  fetchChanges?(cursor: string, signal: AbortSignal): Promise<{ records: Raw[]; cursor: string }>
  fetchDetail?(externalId: string, signal: AbortSignal): Promise<Raw | null>
  normalize(raw: Raw, now: Date): Item
  health(): Promise<'CONNECTED' | 'DEGRADED' | 'OFFLINE'>
}
export interface PluginIngestResult {
  state: 'CONNECTED' | 'DEGRADED' | 'ERROR'
  items: Item[]
  examined: number
  accepted: number
  failure?: string
}

export function validateSourcePluginManifest(
  value: unknown,
): asserts value is SourcePluginManifest {
  const data = value as SourcePluginManifest
  if (
    !data ||
    data.apiVersion !== SOURCE_PLUGIN_API_VERSION ||
    !/^[a-z][a-z0-9.-]{2,63}$/.test(data.id) ||
    !data.name?.trim() ||
    !/^\d+\.\d+\.\d+$/.test(data.version) ||
    !data.description?.trim() ||
    !data.license?.trim() ||
    data.stability !== 'EXPERIMENTAL' ||
    !Array.isArray(data.capabilities) ||
    !data.capabilities.includes('READ_ITEMS') ||
    data.capabilities.some(
      (capability) => !['READ_ITEMS', 'INCREMENTAL_SYNC', 'FETCH_DETAIL'].includes(capability),
    ) ||
    !Array.isArray(data.permissions) ||
    data.permissions.some((permission) => !['LOCAL_SAMPLE', 'NETWORK_READ'].includes(permission)) ||
    data.permissions.includes('LOCAL_SAMPLE') === data.permissions.includes('NETWORK_READ')
  )
    throw new Error('INVALID_PLUGIN_MANIFEST')
}

/** Converts only declared read-only source records. A faulty Plugin cannot mutate existing items. */
export async function ingestSourcePlugin<Raw>(
  plugin: SourcePlugin<Raw>,
  allowedPermissions: readonly SourcePermission[],
  signal = new AbortController().signal,
  now = new Date(),
): Promise<PluginIngestResult> {
  try {
    validateSourcePluginManifest(plugin.manifest)
    if (plugin.manifest.permissions.some((permission) => !allowedPermissions.includes(permission)))
      return { state: 'ERROR', items: [], examined: 0, accepted: 0, failure: 'PERMISSION_REQUIRED' }
    if (
      plugin.manifest.capabilities.includes('INCREMENTAL_SYNC') &&
      typeof plugin.fetchChanges !== 'function'
    )
      throw new Error('PLUGIN_CAPABILITY_MISSING')
    if (
      plugin.manifest.capabilities.includes('FETCH_DETAIL') &&
      typeof plugin.fetchDetail !== 'function'
    )
      throw new Error('PLUGIN_CAPABILITY_MISSING')
    if (signal.aborted) throw new Error('CANCELLED')
    const health = await plugin.health()
    if (!['CONNECTED', 'DEGRADED', 'OFFLINE'].includes(health))
      throw new Error('PLUGIN_HEALTH_INVALID')
    if (health === 'OFFLINE')
      return { state: 'DEGRADED', items: [], examined: 0, accepted: 0, failure: 'PLUGIN_OFFLINE' }
    const records = await plugin.fetchInitial(signal)
    if (!Array.isArray(records) || records.length > 200) throw new Error('PLUGIN_BATCH_INVALID')
    const byExternalId = new Map<string, Item>()
    for (const raw of records) {
      if (signal.aborted) throw new Error('CANCELLED')
      const item = plugin.normalize(raw, now)
      if (
        !item ||
        item.sourceId !== plugin.manifest.id ||
        typeof item.externalId !== 'string' ||
        !item.externalId ||
        typeof item.id !== 'string' ||
        !item.id.startsWith(`${plugin.manifest.id}:`) ||
        !['task', 'event', 'email'].includes(item.kind) ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 200 ||
        typeof item.description !== 'string' ||
        item.description.length > 5000 ||
        !Number.isFinite(Date.parse(item.sourceUpdatedAt)) ||
        !Array.isArray(item.actions) ||
        item.actions.some(
          (action) =>
            !action ||
            !Number.isInteger(action.riskLevel) ||
            action.riskLevel < 0 ||
            action.riskLevel > 1 ||
            !['view', 'open'].includes(action.type) ||
            action.plugin !== plugin.manifest.id,
        )
      )
        throw new Error('PLUGIN_NORMALIZATION_INVALID')
      const previous = byExternalId.get(item.externalId)
      if (!previous || item.sourceUpdatedAt > previous.sourceUpdatedAt)
        byExternalId.set(item.externalId, structuredClone(item))
    }
    return {
      state: 'CONNECTED',
      items: [...byExternalId.values()],
      examined: records.length,
      accepted: byExternalId.size,
    }
  } catch (error) {
    return {
      state: 'DEGRADED',
      items: [],
      examined: 0,
      accepted: 0,
      failure: error instanceof Error ? error.message : 'PLUGIN_FAILURE',
    }
  }
}

/** Run by third-party authors against their own Plugin before integration. */
export async function sourcePluginContract<Raw>(
  plugin: SourcePlugin<Raw>,
  sample: Raw,
): Promise<{ passed: boolean; checks: string[] }> {
  validateSourcePluginManifest(plugin.manifest)
  const item = plugin.normalize(sample, new Date('2027-01-01T00:00:00.000Z'))
  if (
    item.sourceId !== plugin.manifest.id ||
    typeof item.externalId !== 'string' ||
    !item.externalId ||
    typeof item.id !== 'string' ||
    !item.id.startsWith(`${plugin.manifest.id}:`)
  )
    throw new Error('PLUGIN_IDENTITY_CONTRACT')
  if (item.actions.some((action) => action.riskLevel > 1))
    throw new Error('PLUGIN_READ_ONLY_CONTRACT')
  if ((await plugin.health()) !== 'CONNECTED') throw new Error('PLUGIN_HEALTH_CONTRACT')
  const ingest = await ingestSourcePlugin(plugin, plugin.manifest.permissions)
  if (ingest.state !== 'CONNECTED' || ingest.accepted < 1)
    throw new Error(`PLUGIN_INGEST_CONTRACT:${ingest.failure || 'EMPTY'}`)
  const denied = await ingestSourcePlugin(plugin, [])
  if (denied.failure !== 'PERMISSION_REQUIRED') throw new Error('PLUGIN_PERMISSION_CONTRACT')
  return {
    passed: true,
    checks: [
      'manifest',
      'identity',
      'read-only',
      'normalization',
      'permission',
      'ingestion',
      'health',
    ],
  }
}
