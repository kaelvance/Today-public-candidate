import type { ModelProvider, PromptMessage, PrivacyClass } from './types'

/** Same-origin proxy keeps the credential out of the browser and initial bundle. */
export class HttpRemoteTransport implements ModelProvider {
  readonly id = 'remote.generic-http'
  readonly locality = 'remote'
  constructor(readonly baseUrl = '/api/remote-model') {}
  async available(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, { credentials: 'same-origin' })
      return response.ok && ((await response.json()) as { available?: boolean }).available === true
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
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error('INVALID_RESPONSE')
    }
    if (!response.ok) {
      const error =
        payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : 'PROVIDER_UNAVAILABLE'
      throw new Error(error.toUpperCase())
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('text' in payload) ||
      typeof payload.text !== 'string'
    )
      throw new Error('INVALID_RESPONSE')
    return payload.text
  }
}
