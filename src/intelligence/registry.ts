import { capabilities, type Capability, type ModelClass } from './types'

export interface ModelManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  architecture: string
  baseModel: string | null
  license: {
    baseModel: string
    dataset: string
    teacherTerms: string
    derivative: string
    redistribution: 'permitted' | 'prohibited' | 'unverified'
  }
  parameterCount: number | null
  contextWindow: number
  runtime: string[]
  capabilities: Capability[]
  languages: string[]
  variants: Array<{
    id: string
    quantization: 'FP16' | 'BF16' | 'Q8' | 'Q6' | 'Q5' | 'Q4' | 'OTHER'
    memoryMiB: number
    sha256: string | null
    artifact: string | null
  }>
  recommendedHardware: 'LOW' | 'STANDARD' | 'HIGH'
  source: string
  provenance: {
    datasetVersion: string | null
    trainingMethod: string | null
    trainingCodeVersion: string | null
    evaluationVersion: string | null
    conversionTools: string[]
    limitations: string[]
  }
}
const idPattern = /^[a-z0-9][a-z0-9._-]{1,79}$/
const safeArtifactPath = (path: string): boolean =>
  /^[a-zA-Z0-9._/-]+$/.test(path) &&
  !path.startsWith('/') &&
  path.split('/').every((segment) => segment !== '..' && segment !== '.' && segment.length > 0)
export function validateManifest(value: ModelManifest): ModelManifest {
  if (
    value.schemaVersion !== 1 ||
    !idPattern.test(value.id) ||
    !value.name ||
    !value.version ||
    !value.architecture ||
    !Array.isArray(value.runtime) ||
    !value.runtime.length ||
    !value.runtime.every((id) => idPattern.test(id))
  )
    throw new Error('INVALID_MANIFEST')
  if (
    !Number.isInteger(value.contextWindow) ||
    value.contextWindow < 256 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.some((cap) => !capabilities.includes(cap))
  )
    throw new Error('INVALID_MANIFEST')
  if (
    !value.license ||
    !['permitted', 'prohibited', 'unverified'].includes(value.license.redistribution) ||
    !value.license.baseModel ||
    !value.license.dataset ||
    !value.license.teacherTerms ||
    !value.license.derivative
  )
    throw new Error('LICENSE_INCOMPLETE')
  if (
    !Array.isArray(value.variants) ||
    !value.variants.every(
      (v) =>
        idPattern.test(v.id) &&
        Number.isFinite(v.memoryMiB) &&
        v.memoryMiB > 0 &&
        (!v.sha256 || /^[a-f0-9]{64}$/i.test(v.sha256)) &&
        (!v.artifact || safeArtifactPath(v.artifact)),
    )
  )
    throw new Error('INVALID_VARIANT')
  if (
    !value.provenance ||
    !Array.isArray(value.provenance.limitations) ||
    !Array.isArray(value.provenance.conversionTools)
  )
    throw new Error('INVALID_PROVENANCE')
  return structuredClone(value)
}
export class ModelRegistry {
  private readonly models = new Map<string, ModelManifest>()
  private readonly classes = new Map<ModelClass, string>()
  register(manifest: ModelManifest): void {
    const safe = validateManifest(manifest)
    this.models.set(safe.id, safe)
  }
  get(id: string): ModelManifest | undefined {
    const model = this.models.get(id)
    return model && structuredClone(model)
  }
  list(): ModelManifest[] {
    return [...this.models.values()].map((model) => structuredClone(model))
  }
  mapClass(modelClass: ModelClass, id: string): void {
    if (!this.models.has(id)) throw new Error('UNKNOWN_MODEL')
    this.classes.set(modelClass, id)
  }
  forClass(modelClass: ModelClass): ModelManifest | undefined {
    const id = this.classes.get(modelClass)
    return id ? this.get(id) : undefined
  }
}
export const todayModelAlpha: ModelManifest = {
  schemaVersion: 1,
  id: 'today-model-alpha',
  name: 'Today Model Alpha (experimental; not default)',
  version: '0.1.0',
  architecture: 'Qwen3-1.7B Q4 plus MLX LoRA rank 8',
  baseModel: 'Qwen/Qwen3-1.7B-MLX-4bit@21457c6f51ed54a7c16e988c0844db973815c137',
  license: {
    baseModel: 'Apache-2.0',
    dataset: 'project-authored synthetic templates',
    teacherTerms: 'no teacher used',
    derivative: 'Apache-2.0 base conditions; project adapter license pending',
    redistribution: 'unverified',
  },
  parameterCount: 1720575000,
  contextWindow: 4096,
  runtime: ['local.mlx-http'],
  capabilities: [...capabilities],
  languages: ['ja', 'en'],
  variants: [
    {
      id: 'mlx-q4-lora',
      quantization: 'Q4',
      memoryMiB: 1800,
      sha256: '94205e37040ed1396f4b3a4af1b6c587900e396c4c397d9340923795e6128584',
      artifact: 'models/today-model/adapters/alpha-qwen3-q4/adapters.safetensors',
    },
  ],
  recommendedHardware: 'STANDARD',
  source: 'Qwen official Q4 base plus project-authored LoRA; base weights not bundled',
  provenance: {
    datasetVersion: 'today-dataset/1.0.0',
    trainingMethod: 'QLoRA 384 steps; validation-selected checkpoint 320',
    trainingCodeVersion: 'today-v1.6-qlora/1',
    evaluationVersion: 'today-benchmark/2.0.0',
    conversionTools: ['mlx-lm 0.31.3'],
    limitations: [
      'False merge rate 34% on held-out synthetic benchmark',
      'Japanese temporal accuracy 37.3%',
      'Not accepted as default',
    ],
  },
}
export const defaultModelRegistry = new ModelRegistry()
defaultModelRegistry.register(todayModelAlpha)
export const todayModelBeta: ModelManifest = {
  schemaVersion: 1,
  id: 'today-model-beta',
  name: 'Today Model Beta (experimental; not default)',
  version: '0.2.0',
  architecture: 'Qwen3-1.7B Q4 plus MLX LoRA rank 8',
  baseModel: 'Qwen/Qwen3-1.7B-MLX-4bit@21457c6f51ed54a7c16e988c0844db973815c137',
  license: {
    baseModel: 'Apache-2.0',
    dataset: 'project-authored synthetic templates',
    teacherTerms: 'no teacher used',
    derivative: 'Apache-2.0 base conditions; project adapter license pending',
    redistribution: 'unverified',
  },
  parameterCount: 1720575000,
  contextWindow: 4096,
  runtime: ['local.mlx-http'],
  capabilities: [...capabilities],
  languages: ['ja', 'en'],
  variants: [
    {
      id: 'mlx-q4-lora',
      quantization: 'Q4',
      memoryMiB: 1800,
      sha256: 'de3210a81ae2a58b83801d55d8c653d10f3f5f6f9b8da1b5efd4befc6dc6558c',
      artifact: 'models/today-model/adapters/beta-qwen3-q4/adapters.safetensors',
    },
  ],
  recommendedHardware: 'STANDARD',
  source: 'Qwen official Q4 base plus project-authored LoRA; base weights not bundled',
  provenance: {
    datasetVersion: 'today-dataset/2.0.0',
    trainingMethod: 'QLoRA 480 steps; validation-selected checkpoint 160',
    trainingCodeVersion: 'today-v1.7-qlora/1',
    evaluationVersion: 'today-benchmark/3.0.0',
    conversionTools: ['mlx-lm 0.31.3'],
    limitations: [
      'Independent quality gate pending',
      'Synthetic templates may not generalize',
      'Not accepted as default',
    ],
  },
}
defaultModelRegistry.register(todayModelBeta)
export const todayModelBetaRevision: ModelManifest = {
  ...todayModelBeta,
  id: 'today-model-beta2',
  name: 'Today Model Beta 0.2.1 (experimental; not default)',
  version: '0.2.1',
  variants: [
    {
      id: 'mlx-q4-lora',
      quantization: 'Q4',
      memoryMiB: 1800,
      sha256: '7be97e269d4109823ab7c37e75fd120e9dcb3328b21fe3d7bac2e6598eb82f9b',
      artifact: 'models/today-model/adapters/beta2-qwen3-q4/adapters.safetensors',
    },
  ],
  provenance: {
    ...todayModelBeta.provenance,
    datasetVersion: 'today-dataset/2.1.0',
    trainingMethod: 'QLoRA 480 steps; validation-selected checkpoint 400; diverse source IDs',
    limitations: [
      'Independent quality gate pending',
      'Synthetic templates may not generalize',
      'Not accepted as default',
    ],
  },
}
defaultModelRegistry.register(todayModelBetaRevision)
export const todayModelGamma: ModelManifest = {
  ...todayModelBetaRevision,
  id: 'today-model-gamma',
  name: 'Today Model Gamma (experimental; not default)',
  version: '0.3.0',
  variants: [
    {
      id: 'mlx-q4-lora',
      quantization: 'Q4',
      memoryMiB: 1800,
      sha256: 'bc535ec61836e2aa02da027a6cae82aa28a0e8eec5c47a4543804acf104e43dc',
      artifact: 'models/today-model/adapters/gamma-qwen3-q4/adapters.safetensors',
    },
  ],
  provenance: {
    ...todayModelBetaRevision.provenance,
    datasetVersion: 'today-dataset/3.0.0',
    trainingMethod: 'MLX LoRA 840 steps; 240-case validation selected checkpoint 420',
    trainingCodeVersion: 'today-v1.8-qlora/1',
    evaluationVersion: 'today-benchmark/4.0.0',
    limitations: [
      'Sealed V4 failed Fact 12/32 and Temporal 9/32; Context FMR 0/40, recall 40/40; adapter not included in V1.9',
      'Synthetic templates may not generalize',
      'Not accepted as default',
    ],
  },
}
defaultModelRegistry.register(todayModelGamma)

export async function verifyModelArtifact(
  data: ArrayBuffer,
  expectedSha256: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) return false
  const hash = await crypto.subtle.digest('SHA-256', data)
  return (
    [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('') ===
    expectedSha256.toLowerCase()
  )
}
