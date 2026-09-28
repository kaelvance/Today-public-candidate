import { validateManifest, verifyModelArtifact, type ModelManifest } from '../intelligence/registry'
import type { Capability, IntelligenceProvider, IntelligenceRequest } from '../intelligence/types'
import { intelligenceProviderContract } from './provider-contract'

/** Synthetic contributor check; it does not load a model or fetch weights. */
export async function modelContract<C extends Capability>(
  manifest: ModelManifest,
  variantId: string,
  artifact: ArrayBuffer,
  provider: IntelligenceProvider,
  fixture: IntelligenceRequest<C>,
): Promise<{ passed: boolean; checks: string[] }> {
  const safe = validateManifest(manifest)
  const variant = safe.variants.find((item) => item.id === variantId)
  if (
    !variant?.sha256 ||
    !variant.artifact ||
    !(await verifyModelArtifact(artifact, variant.sha256))
  )
    throw new Error('MODEL_ARTIFACT_CONTRACT')
  if (
    !safe.capabilities.includes(fixture.capability) ||
    !provider.capabilities().includes(fixture.capability)
  )
    throw new Error('MODEL_CAPABILITY_CONTRACT')
  if (provider.locality !== 'local' || !safe.runtime.some((id) => id.startsWith('local.')))
    throw new Error('MODEL_RUNTIME_CONTRACT')
  const providerResult = await intelligenceProviderContract(provider, fixture)
  return {
    passed: providerResult.passed,
    checks: [
      'manifest',
      'hash',
      'runtime',
      'capabilities',
      'structured-output',
      'malformed-output',
      'cancellation',
    ],
  }
}
