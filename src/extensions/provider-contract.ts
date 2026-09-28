import { IntelligenceRouter, intelligenceRequest } from '../intelligence/router'
import {
  capabilities,
  defaultPolicy,
  type Capability,
  type IntelligenceProvider,
  type IntelligenceRequest,
} from '../intelligence/types'

export const INTELLIGENCE_PROVIDER_API_VERSION = 1 as const
export interface IntelligenceProviderDescriptor {
  apiVersion: typeof INTELLIGENCE_PROVIDER_API_VERSION
  id: string
  type: 'local' | 'remote'
  capabilities: readonly Capability[]
  privacy: 'local-only' | 'requires-consent'
  networkRequired: boolean
  experimental: boolean
  stability: 'EXPERIMENTAL'
}

export function describeIntelligenceProvider(
  provider: IntelligenceProvider,
): IntelligenceProviderDescriptor {
  const supported = provider.capabilities()
  if (
    !/^[a-z][a-z0-9.-]{2,100}$/.test(provider.id) ||
    !['local', 'remote'].includes(provider.locality) ||
    supported.some((capability) => !capabilities.includes(capability)) ||
    new Set(supported).size !== supported.length
  )
    throw new Error('INVALID_PROVIDER_DESCRIPTOR')
  return {
    apiVersion: INTELLIGENCE_PROVIDER_API_VERSION,
    id: provider.id,
    type: provider.locality,
    capabilities: supported,
    privacy: provider.locality === 'local' ? 'local-only' : 'requires-consent',
    networkRequired: provider.locality === 'remote',
    experimental: true,
    stability: 'EXPERIMENTAL',
  }
}

/** Contributor kit: run with a synthetic fixture, never with personal source content. */
export async function intelligenceProviderContract<C extends Capability>(
  provider: IntelligenceProvider,
  fixture: IntelligenceRequest<C>,
): Promise<{ passed: boolean; checks: string[] }> {
  const descriptor = describeIntelligenceProvider(provider)
  if (!descriptor.capabilities.includes(fixture.capability))
    throw new Error('CAPABILITY_NOT_DECLARED')
  if (!(await provider.available())) throw new Error('PROVIDER_UNAVAILABLE')
  const router = new IntelligenceRouter([provider], {
    ...defaultPolicy,
    mode: provider.locality === 'local' ? 'LOCAL_ONLY' : 'REMOTE_LOCAL_FALLBACK',
    remoteEnabled: provider.locality === 'remote',
  })
  const request = intelligenceRequest(
    fixture.capability,
    fixture.input,
    'PUBLIC',
    'contract-fixture',
    {
      traceId: 'contract-fixture',
      minConfidence: 0,
      fallback: 'UNKNOWN',
      budget: { ...fixture.budget, latencyMs: Math.max(100, fixture.budget.latencyMs) },
    },
  )
  const result = await router.route(request, new AbortController().signal)
  if (result.status !== 'proposal') throw new Error(`PROVIDER_OUTPUT_CONTRACT:${result.reason}`)
  const blocked =
    provider.locality === 'remote'
      ? await router.route(
          { ...request, traceId: 'contract-private', privacy: 'LOCAL_PRIVATE' },
          new AbortController().signal,
        )
      : null
  if (blocked && blocked.status === 'proposal') throw new Error('PROVIDER_PRIVACY_CONTRACT')
  const stopped = new AbortController()
  stopped.abort()
  const cancelled = await router.route(
    { ...request, traceId: 'contract-cancelled' },
    stopped.signal,
  )
  if (cancelled.status !== 'rejected') throw new Error('PROVIDER_CANCEL_CONTRACT')
  const providerShell = {
    id: provider.id,
    locality: provider.locality,
    modelClass: provider.modelClass,
    capabilities: () => descriptor.capabilities,
  }
  const unavailable = new IntelligenceRouter(
    [{ ...providerShell, available: async () => false, infer: provider.infer.bind(provider) }],
    router.policy,
  )
  if (
    (
      await unavailable.route(
        { ...request, traceId: 'contract-unavailable' },
        new AbortController().signal,
      )
    ).status === 'proposal'
  )
    throw new Error('PROVIDER_UNAVAILABLE_FALLBACK_CONTRACT')
  const malformed = new IntelligenceRouter(
    [
      {
        ...providerShell,
        available: async () => true,
        infer: async () => ({ text: '{}', modelId: 'contract-malformed', outputChars: 2 }),
      },
    ],
    router.policy,
  )
  if (
    (
      await malformed.route(
        { ...request, traceId: 'contract-malformed' },
        new AbortController().signal,
      )
    ).status === 'proposal'
  )
    throw new Error('PROVIDER_SCHEMA_FALLBACK_CONTRACT')
  const deterministic = await router.route(
    { ...request, traceId: 'contract-deterministic' },
    new AbortController().signal,
    () => ({ status: 'deterministic', reason: 'CONTRACT_SOURCE_FACT' }),
  )
  if (deterministic.status !== 'deterministic') throw new Error('PROVIDER_DETERMINISTIC_CONTRACT')
  return {
    passed: true,
    checks: [
      'descriptor',
      'capability',
      'availability',
      'schema',
      'privacy',
      'cancellation',
      'unavailable-fallback',
      'malformed-fallback',
      'deterministic-authority',
    ],
  }
}
