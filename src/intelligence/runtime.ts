import type { Capability, ModelProvider, PromptMessage } from './types'

export interface RuntimeStatus {
  available: boolean
  modelLoaded: boolean
  structuredOutput: boolean
  contextWindow: number
  quantization: string | null
  memoryEstimateMiB: number
  device: string
  backend: string
  modelId?: string
  capabilities: Capability[]
}
export interface ModelRuntime extends ModelProvider {
  status(): Promise<RuntimeStatus>
  load(modelId: string, signal: AbortSignal): Promise<void>
  unload(): Promise<void>
}
export interface LocalModelRuntime extends ModelRuntime {
  readonly locality: 'local'
}
export class UnavailableLocalRuntime implements LocalModelRuntime {
  readonly id = 'local.unavailable'
  readonly locality = 'local'
  async status(): Promise<RuntimeStatus> {
    return {
      available: false,
      modelLoaded: false,
      structuredOutput: false,
      contextWindow: 0,
      quantization: null,
      memoryEstimateMiB: 0,
      device: 'none',
      backend: 'none',
      capabilities: [],
    }
  }
  async load(): Promise<void> {
    throw new Error('RUNTIME_UNAVAILABLE')
  }
  async unload(): Promise<void> {}
  async complete(): Promise<string> {
    throw new Error('RUNTIME_UNAVAILABLE')
  }
}
export class LocalResourceGovernor {
  private active = 0
  private calls = 0
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  constructor(
    readonly maxConcurrent = 1,
    readonly maxMemoryMiB = 2048,
    readonly maxCalls = 8,
    readonly idleUnloadMs = 60_000,
  ) {}
  resetReconciliation(): void {
    this.calls = 0
  }
  async run<T>(
    runtime: LocalModelRuntime,
    task: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) throw new Error('CANCELLED')
    if (this.active >= this.maxConcurrent || this.calls >= this.maxCalls)
      throw new Error('RESOURCE_BUDGET')
    const status = await runtime.status()
    if (!status.available) throw new Error('RUNTIME_UNAVAILABLE')
    if (status.memoryEstimateMiB > this.maxMemoryMiB) throw new Error('MEMORY_BUDGET')
    this.active++
    this.calls++
    if (this.idleTimer) clearTimeout(this.idleTimer)
    try {
      return await task()
    } finally {
      this.active--
      if (this.active === 0)
        this.idleTimer = setTimeout(() => {
          void runtime.unload()
        }, this.idleUnloadMs)
    }
  }
  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
  }
}
export class MockLocalRuntime implements LocalModelRuntime {
  readonly id = 'local.mock'
  readonly locality = 'local'
  loaded = false
  constructor(
    readonly reply: (messages: PromptMessage[]) => string,
    readonly memoryEstimateMiB = 256,
  ) {}
  async status(): Promise<RuntimeStatus> {
    return {
      available: true,
      modelLoaded: this.loaded,
      structuredOutput: true,
      contextWindow: 4096,
      quantization: 'Q4',
      memoryEstimateMiB: this.memoryEstimateMiB,
      device: 'mock',
      backend: 'mock',
      capabilities: [
        'interpretInput',
        'extractFacts',
        'classifyItem',
        'compareContextCandidates',
        'resolveAmbiguity',
        'summarizeContext',
        'extractTemporalInformation',
      ],
    }
  }
  async load(_modelId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('CANCELLED')
    this.loaded = true
  }
  async unload(): Promise<void> {
    this.loaded = false
  }
  async complete(
    _input: { modelId: string; messages: PromptMessage[]; maxOutputChars: number },
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) throw new Error('CANCELLED')
    return this.reply(_input.messages)
  }
}
