import type {
  Capability,
  IntelligencePolicy,
  IntelligenceProvider,
  IntelligenceRequest,
} from './types'

export interface ContextBudgetReport {
  suppliedItems: number
  inputChars: number
  estimatedTokens: number
  omittedItems: number
  truncated: boolean
  sourceIds: string[]
}
const promptFields = new Set([
  'left',
  'right',
  'item',
  'items',
  'id',
  'title',
  'description',
  'sourceId',
  'date',
  'eventId',
  'conversationId',
  'text',
  'localTime',
  'timeZone',
  'question',
  'options',
])
const secretValue =
  /\b(?:Bearer\s+[A-Za-z0-9._~+/-]{8,}|sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*\S{4,})/gi
export function privacyAllowed(
  request: IntelligenceRequest,
  provider: IntelligenceProvider,
  policy: IntelligencePolicy,
): boolean {
  if (provider.locality === 'local') return true
  if (!policy.remoteEnabled) return false
  if (request.privacy === 'LOCAL_PRIVATE' && !policy.localPrivateRemoteConsent) return false
  if (request.privacy === 'CONNECTED_SERVICE_DATA' && !policy.connectedServiceRemoteConsent)
    return false
  if (request.privacy === 'SENSITIVE_CONTEXT' && !policy.sensitiveRemoteConsent) return false
  return true
}
export function minimizeRequest<C extends Capability>(
  request: IntelligenceRequest<C>,
): { request: IntelligenceRequest<C>; report: ContextBudgetReport } {
  const copy = structuredClone(request)
  const input = copy.input as unknown as Record<string, unknown>
  let omittedItems = 0
  let truncated = false
  const trim = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const result = value.slice(0, 600).replace(secretValue, '[REDACTED_SECRET]')
      truncated ||= result.length < value.length || result !== value.slice(0, 600)
      return result
    }
    if (Array.isArray(value)) return value.map(trim)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => promptFields.has(key))
          .map(([key, item]) => [key, trim(item)]),
      )
    return value
  }
  if (Array.isArray(input.items)) {
    omittedItems = Math.max(0, input.items.length - request.budget.maxContextItems)
    input.items = input.items.slice(0, request.budget.maxContextItems)
  }
  const minimized = trim(input) as typeof input
  const chars = JSON.stringify(minimized).length
  if (chars > request.budget.maxInputChars) throw new Error('INPUT_OVERFLOW')
  const items = [
    minimized.left,
    minimized.right,
    minimized.item,
    ...(Array.isArray(minimized.items) ? minimized.items : []),
  ]
  const sourceIds = items
    .filter(
      (item): item is { id: string } =>
        !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string',
    )
    .map((item) => item.id)
  return {
    request: { ...copy, input: minimized as IntelligenceRequest<C>['input'] },
    report: {
      suppliedItems: sourceIds.length,
      inputChars: chars,
      estimatedTokens: Math.ceil(chars / 3),
      omittedItems,
      truncated: truncated || omittedItems > 0,
      sourceIds,
    },
  }
}
