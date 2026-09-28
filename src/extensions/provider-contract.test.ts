import { expect, it } from 'vitest'
import { ConnectedModelProvider, MockIntelligenceProvider } from '../intelligence/providers'
import { intelligenceRequest } from '../intelligence/router'
import { describeIntelligenceProvider, intelligenceProviderContract } from './provider-contract'

it('gives third-party authors a reusable descriptor and routing contract', async () => {
  const provider = new MockIntelligenceProvider()
  const request = intelligenceRequest(
    'compareContextCandidates',
    { left: { id: 'a', title: '図書返却' }, right: { id: 'b', title: '別件' } },
    'PUBLIC',
    'synthetic',
    { minConfidence: 0 },
  )
  expect(describeIntelligenceProvider(provider).type).toBe('local')
  expect((await intelligenceProviderContract(provider, request)).checks).toHaveLength(9)
})
it('rejects an undeclared capability', async () => {
  const provider = new MockIntelligenceProvider('partial-capability')
  const request = intelligenceRequest(
    'compareContextCandidates',
    { left: { id: 'a', title: 'A' }, right: { id: 'b', title: 'B' } },
    'PUBLIC',
    'synthetic',
  )
  await expect(intelligenceProviderContract(provider, request)).rejects.toThrow(
    'CAPABILITY_NOT_DECLARED',
  )
})
it('runs the same contract for a remote Provider without sending private data', async () => {
  const transport = {
    id: 'contract-remote',
    locality: 'remote' as const,
    complete: async () =>
      JSON.stringify({
        schemaVersion: 1,
        capability: 'compareContextCandidates',
        confidence: 0.8,
        sourceIds: ['a', 'b'],
        value: { relation: 'UNKNOWN', evidence: [], conflicts: [] },
      }),
  }
  const provider = new ConnectedModelProvider(
    'provider.remote-test',
    'test-model',
    'EXTERNAL_REASONING',
    transport,
    ['compareContextCandidates'],
  )
  const request = intelligenceRequest(
    'compareContextCandidates',
    { left: { id: 'a', title: '図書' }, right: { id: 'b', title: '歯科' } },
    'PUBLIC',
    'synthetic',
    { minConfidence: 0 },
  )
  expect((await intelligenceProviderContract(provider, request)).passed).toBe(true)
})
