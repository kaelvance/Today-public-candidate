import type { ModelProvider, PromptMessage, PrivacyClass } from './types'

/** Ollama remains behind Today's same-origin server and Router policy. */
export class HttpOllamaTransport implements ModelProvider {
  readonly id = 'local.ollama'
  readonly locality = 'local' as const
  constructor(readonly baseUrl = '/api/ollama-model') {}
  async available(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, { credentials: 'same-origin' })
      return response.ok && (await response.json()).available === true
    } catch {
      return false
    }
  }
  async complete(
    input: {
      modelId: string
      messages: PromptMessage[]
      maxOutputChars: number
      privacy?: PrivacyClass
    },
    signal: AbortSignal,
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/complete`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-today-request': '1' },
      body: JSON.stringify(input),
      signal,
    })
    if (!response.ok)
      throw new Error((await response.json().catch(() => ({}))).error || 'ollama_unavailable')
    const result = (await response.json()) as { text?: string }
    if (typeof result.text !== 'string') throw new Error('ollama_invalid_response')
    return result.text
  }
}
