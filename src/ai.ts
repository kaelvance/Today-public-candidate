export interface AIEnrichment {
  classification: 'task' | 'event' | 'email' | 'unknown'
  priorityAdjustment: number
  confidence: number
  suggestedAction: string | null
}

export function validateAIEnrichment(value: unknown): AIEnrichment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (!['task', 'event', 'email', 'unknown'].includes(String(data.classification))) return null
  if (
    typeof data.priorityAdjustment !== 'number' ||
    !Number.isFinite(data.priorityAdjustment) ||
    Math.abs(data.priorityAdjustment) > 20
  )
    return null
  if (
    typeof data.confidence !== 'number' ||
    !Number.isFinite(data.confidence) ||
    data.confidence < 0 ||
    data.confidence > 1
  )
    return null
  if (
    data.suggestedAction !== null &&
    (typeof data.suggestedAction !== 'string' || data.suggestedAction.length > 80)
  )
    return null
  return data as unknown as AIEnrichment
}

export interface CaptureInterpretation {
  intent: 'task' | 'event'
  title: string
  date: string | null
  importance: 1 | 2 | 3
  confidence: 'high' | 'medium' | 'low'
}

export function validateCaptureInterpretation(value: unknown): CaptureInterpretation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (
    !['task', 'event'].includes(String(data.intent)) ||
    typeof data.title !== 'string' ||
    !data.title.trim() ||
    data.title.length > 200
  )
    return null
  if (
    ![1, 2, 3].includes(data.importance as number) ||
    !['high', 'medium', 'low'].includes(String(data.confidence))
  )
    return null
  if (
    data.date !== null &&
    (typeof data.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        data.date,
      ) ||
      !Number.isFinite(new Date(data.date).getTime()))
  )
    return null
  return {
    intent: data.intent as CaptureInterpretation['intent'],
    title: data.title.trim(),
    date: data.date,
    importance: data.importance as CaptureInterpretation['importance'],
    confidence: data.confidence as CaptureInterpretation['confidence'],
  }
}

export interface AIProvider {
  interpretCapture(
    input: string,
    context: { localTime: string; timeZone: string },
    signal: AbortSignal,
  ): Promise<CaptureInterpretation>
}

export const remoteAIProvider: AIProvider = {
  async interpretCapture(input, context, signal) {
    const response = await fetch('/api/ai/interpret', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'X-Today-Request': '1' },
      body: JSON.stringify({ input, ...context }),
      signal,
    })
    if (!response.ok) throw new Error('ai_unavailable')
    const value: unknown = await response.json()
    const result = validateCaptureInterpretation(value)
    if (!result) throw new Error('invalid_ai_response')
    return result
  },
}

export async function aiStatus(): Promise<boolean> {
  const response = await fetch('/api/ai/status', { credentials: 'same-origin' })
  if (!response.ok) return false
  const result: unknown = await response.json()
  return (
    !!result && typeof result === 'object' && 'configured' in result && result.configured === true
  )
}
