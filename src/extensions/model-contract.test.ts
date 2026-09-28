import { expect, it } from 'vitest'
import { MockIntelligenceProvider } from '../intelligence/providers'
import { todayModelAlpha } from '../intelligence/registry'
import { intelligenceRequest } from '../intelligence/router'
import { modelContract } from './model-contract'

it('checks manifest, hash, runtime, capability and output boundary with a synthetic artifact', async () => {
  const artifact = new TextEncoder().encode('abc').buffer
  const manifest = {
    ...todayModelAlpha,
    variants: [
      {
        ...todayModelAlpha.variants[0],
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      },
    ],
  }
  const fixture = intelligenceRequest(
    'compareContextCandidates',
    { left: { id: 'a', title: 'A' }, right: { id: 'b', title: 'B' } },
    'PUBLIC',
    'synthetic',
    { minConfidence: 0 },
  )
  expect(
    (
      await modelContract(
        manifest,
        'mlx-q4-lora',
        artifact,
        new MockIntelligenceProvider(),
        fixture,
      )
    ).checks,
  ).toHaveLength(7)
  await expect(
    modelContract(
      manifest,
      'mlx-q4-lora',
      new TextEncoder().encode('wrong').buffer,
      new MockIntelligenceProvider(),
      fixture,
    ),
  ).rejects.toThrow('MODEL_ARTIFACT_CONTRACT')
})
