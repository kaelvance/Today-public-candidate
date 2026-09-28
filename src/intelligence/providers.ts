import { buildPrompt } from './prompts'
import type {
  Capability,
  IntelligenceProvider,
  IntelligenceRequest,
  ModelClass,
  ModelProvider,
  RawModelOutput,
} from './types'
import type { LocalModelRuntime } from './runtime'
import { LocalResourceGovernor } from './runtime'

export class NullIntelligenceProvider implements IntelligenceProvider {
  readonly id = 'intelligence.none'
  readonly locality = 'local'
  readonly modelClass = 'LOCAL_FAST'
  capabilities(): Capability[] {
    return []
  }
  async available(): Promise<boolean> {
    return false
  }
  async infer(): Promise<RawModelOutput> {
    throw new Error('MODEL_UNAVAILABLE')
  }
}
export class TodayLocalProvider implements IntelligenceProvider {
  readonly locality = 'local'
  readonly modelClass = 'LOCAL_FAST'
  constructor(
    readonly id: string,
    readonly modelId: string,
    readonly runtime: LocalModelRuntime,
    readonly governor: LocalResourceGovernor,
  ) {}
  capabilities(): Capability[] {
    return [
      'interpretInput',
      'extractFacts',
      'classifyItem',
      'compareContextCandidates',
      'resolveAmbiguity',
      'summarizeContext',
      'extractTemporalInformation',
    ]
  }
  async available(): Promise<boolean> {
    return (await this.runtime.status()).available
  }
  async infer<C extends Capability>(
    request: IntelligenceRequest<C>,
    signal: AbortSignal,
  ): Promise<RawModelOutput> {
    return this.governor.run(
      this.runtime,
      async () => {
        const status = await this.runtime.status()
        const modelId = status.modelId || this.modelId
        if (!status.modelLoaded) await this.runtime.load(modelId, signal)
        const text = await this.runtime.complete(
          {
            modelId,
            messages: buildPrompt(request),
            maxOutputChars: request.budget.maxOutputChars,
          },
          signal,
        )
        return { text, modelId, outputChars: text.length }
      },
      signal,
    )
  }
}
export class ConnectedModelProvider implements IntelligenceProvider {
  constructor(
    readonly id: string,
    readonly modelId: string,
    readonly modelClass: ModelClass,
    readonly transport: ModelProvider,
    readonly supported: readonly Capability[],
  ) {}
  get locality(): 'local' | 'remote' {
    return this.transport.locality
  }
  capabilities(): readonly Capability[] {
    return this.supported
  }
  async available(): Promise<boolean> {
    return this.transport.available ? this.transport.available() : true
  }
  async infer<C extends Capability>(
    request: IntelligenceRequest<C>,
    signal: AbortSignal,
  ): Promise<RawModelOutput> {
    const text = await this.transport.complete(
      {
        modelId: this.modelId,
        messages: buildPrompt(request),
        maxOutputChars: request.budget.maxOutputChars,
        privacy: request.privacy,
      },
      signal,
    )
    return { text, modelId: this.modelId, outputChars: text.length }
  }
}
export type MockMode =
  | 'normal'
  | 'low-confidence'
  | 'malformed-json'
  | 'schema-violation'
  | 'timeout'
  | 'unavailable'
  | 'context-overflow'
  | 'slow'
  | 'partial-capability'
  | 'runtime-crash'
export class MockIntelligenceProvider implements IntelligenceProvider {
  readonly id = 'intelligence.mock'
  readonly locality = 'local'
  readonly modelClass = 'LOCAL_FAST'
  constructor(
    readonly mode: MockMode = 'normal',
    readonly latencyMs = 0,
  ) {}
  capabilities(): Capability[] {
    return this.mode === 'partial-capability'
      ? ['classifyItem']
      : [
          'interpretInput',
          'extractFacts',
          'classifyItem',
          'compareContextCandidates',
          'resolveAmbiguity',
          'summarizeContext',
          'extractTemporalInformation',
        ]
  }
  async available(): Promise<boolean> {
    return this.mode !== 'unavailable'
  }
  async infer<C extends Capability>(
    request: IntelligenceRequest<C>,
    signal: AbortSignal,
  ): Promise<RawModelOutput> {
    if (this.mode === 'unavailable') throw new Error('MODEL_UNAVAILABLE')
    if (this.mode === 'runtime-crash') throw new Error('RUNTIME_CRASH')
    if (this.mode === 'context-overflow') throw new Error('CONTEXT_OVERFLOW')
    if (this.mode === 'timeout')
      await new Promise((resolve) => setTimeout(resolve, request.budget.latencyMs + 20))
    if (this.mode === 'slow' || this.latencyMs)
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs || 100))
    if (signal.aborted) throw new Error('CANCELLED')
    if (this.mode === 'malformed-json')
      return { text: '{broken', modelId: 'mock-v1', outputChars: 7 }
    if (this.mode === 'schema-violation')
      return {
        text: '{"schemaVersion":1,"capability":"wrong","confidence":1,"value":{},"sourceIds":[]}',
        modelId: 'mock-v1',
        outputChars: 83,
      }
    const input = request.input as unknown as Record<string, unknown>
    const items = [
      input.left,
      input.right,
      input.item,
      ...(Array.isArray(input.items) ? input.items : []),
    ].filter(
      (item): item is { id: string } =>
        !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string',
    )
    const sourceIds = items.map((item) => item.id)
    const values: Record<Capability, object> = {
      interpretInput: { title: String(input.text || ''), kind: 'task', date: null },
      extractFacts: { facts: [] },
      classifyItem: { classification: 'CONTEXTUAL' },
      compareContextCandidates: { relation: 'UNKNOWN', evidence: [], conflicts: [] },
      resolveAmbiguity: { selected: null, evidence: [] },
      summarizeContext: {
        summary: items
          .map((item) => ('title' in item ? String(item.title) : ''))
          .join(' / ')
          .slice(0, 500),
        sourceIds,
      },
      extractTemporalInformation: { expressions: [] },
    }
    const text = JSON.stringify({
      schemaVersion: 1,
      capability: request.capability,
      confidence: this.mode === 'low-confidence' ? 0.2 : 0.8,
      sourceIds,
      value: values[request.capability],
    })
    return { text, modelId: 'mock-v1', outputChars: text.length }
  }
}
