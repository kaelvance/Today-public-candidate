import type { LocalModelRuntime, RuntimeStatus } from './runtime'
import type { PromptMessage } from './types'

export class HttpLocalRuntime implements LocalModelRuntime {
  readonly id = 'local.mlx-http'
  readonly locality = 'local'
  constructor(readonly baseUrl = '/api/local-model') {}
  private async json(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(this.baseUrl + path, {
      credentials: 'same-origin',
      ...init,
      headers:
        init?.method === 'POST' ? { ...init.headers, 'x-today-request': '1' } : init?.headers,
    })
    const value = await response.json()
    if (!response.ok)
      throw new Error(typeof value.error === 'string' ? value.error : 'LOCAL_RUNTIME_ERROR')
    return value
  }
  async status(): Promise<RuntimeStatus> {
    const status = await this.json('/status')
    return {
      available: status.available === true,
      modelLoaded: status.modelLoaded === true,
      structuredOutput: status.structuredOutput === true,
      contextWindow: Number(status.contextWindow) || 0,
      quantization: typeof status.quantization === 'string' ? status.quantization : null,
      memoryEstimateMiB: Number(status.memoryEstimateMiB) || 0,
      device: String(status.device || 'unknown'),
      backend: String(status.backend || 'unknown'),
      modelId: typeof status.modelId === 'string' ? status.modelId : undefined,
      capabilities: Array.isArray(status.capabilities)
        ? (status.capabilities as RuntimeStatus['capabilities'])
        : [],
    }
  }
  async load(_modelId: string, signal: AbortSignal): Promise<void> {
    await this.json('/load', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  }
  async unload(): Promise<void> {
    await this.json('/unload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  }
  async complete(
    input: { modelId: string; messages: PromptMessage[]; maxOutputChars: number },
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.json('/complete', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (typeof response.text !== 'string') throw new Error('INVALID_MODEL_OUTPUT')
    return response.text
  }
}
