import { remoteAIProvider } from '../ai'
import type { CaptureInterpretation } from '../ai'
import type {
  ConnectionState,
  IntelligenceProvider,
  ProviderCapabilities,
} from '../ports/providers'
import { ProviderFailure } from '../ports/providers'

const noCapability: ProviderCapabilities = {
  read: false,
  incrementalSync: false,
  write: false,
  structuredOutput: false,
  classification: false,
  semanticComparison: false,
  summarization: false,
}
export class NullAIProvider implements IntelligenceProvider {
  readonly id = 'ai.none'
  capabilities() {
    return noCapability
  }
  async connectionState(): Promise<ConnectionState> {
    return { state: 'UNCONFIGURED', configured: false }
  }
  async interpretCapture(): Promise<CaptureInterpretation> {
    throw new ProviderFailure('CONFIGURATION_MISSING')
  }
}
export class OpenAIAdapter implements IntelligenceProvider {
  readonly id = 'ai.openai'
  capabilities(): ProviderCapabilities {
    return { ...noCapability, structuredOutput: true, classification: true }
  }
  async connectionState(): Promise<ConnectionState> {
    return { state: 'CONNECTED', configured: true }
  }
  interpretCapture(
    input: string,
    context: { localTime: string; timeZone: string },
    signal: AbortSignal,
  ) {
    return remoteAIProvider.interpretCapture(input, context, signal)
  }
}
export class MockAIProvider implements IntelligenceProvider {
  readonly id = 'ai.mock'
  constructor(
    private readonly mode:
      | 'normal'
      | 'timeout'
      | 'malformed'
      | 'unavailable'
      | 'low-confidence' = 'normal',
    private readonly latencyMs = 0,
  ) {}
  capabilities(): ProviderCapabilities {
    return { ...noCapability, structuredOutput: true, classification: true }
  }
  async connectionState(): Promise<ConnectionState> {
    return { state: this.mode === 'unavailable' ? 'ERROR' : 'CONNECTED', configured: true }
  }
  async interpretCapture(input: string): Promise<CaptureInterpretation> {
    if (this.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    if (this.mode === 'timeout') throw new ProviderFailure('NETWORK_UNAVAILABLE')
    if (this.mode === 'unavailable') throw new ProviderFailure('PROVIDER_UNAVAILABLE')
    if (this.mode === 'malformed') throw new ProviderFailure('INVALID_RESPONSE')
    return {
      intent: 'task',
      title: input.trim(),
      date: null,
      importance: 2,
      confidence: this.mode === 'low-confidence' ? 'low' : 'high',
    }
  }
}
