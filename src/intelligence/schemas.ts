import type { Capability, IntelligenceRequest, ProposalPayloads } from './types'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown, limit = 500): value is string =>
  typeof value === 'string' && value.length <= limit
const strings = (value: unknown, limit = 20): value is string[] =>
  Array.isArray(value) && value.length <= limit && value.every((x) => bounded(x, 160))
const confidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const isDate = (value: unknown) =>
  value === null || (bounded(value, 40) && Number.isFinite(Date.parse(value)))

export function validateOutput<C extends Capability>(
  request: IntelligenceRequest<C>,
  raw: string,
): { value: ProposalPayloads[C]; confidence: number; sourceIds: string[] } {
  if (raw.length > request.budget.maxOutputChars) throw new Error('OUTPUT_OVERFLOW')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('MALFORMED_JSON')
  }
  if (
    !record(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.capability !== request.capability ||
    !confidence(parsed.confidence) ||
    !record(parsed.value) ||
    !strings(parsed.sourceIds)
  )
    throw new Error('SCHEMA_VIOLATION')
  const value = parsed.value
  const allowed: Record<Capability, string[]> = {
    interpretInput: ['title', 'kind', 'date'],
    extractFacts: ['facts'],
    classifyItem: ['classification'],
    compareContextCandidates: ['relation', 'evidence', 'conflicts'],
    resolveAmbiguity: ['selected', 'evidence'],
    summarizeContext: ['summary', 'sourceIds'],
    extractTemporalInformation: ['expressions'],
  }
  if (
    Object.keys(parsed).some(
      (key) => !['schemaVersion', 'capability', 'confidence', 'sourceIds', 'value'].includes(key),
    ) ||
    Object.keys(value).some((key) => !allowed[request.capability].includes(key))
  )
    throw new Error('SCHEMA_VIOLATION')
  const known = new Set<string>()
  const input = request.input as unknown as Record<string, unknown>
  for (const item of [
    input.left,
    input.right,
    input.item,
    ...(Array.isArray(input.items) ? input.items : []),
  ])
    if (record(item) && typeof item.id === 'string') known.add(item.id)
  if (parsed.sourceIds.some((id) => !known.has(id)) && known.size) throw new Error('UNKNOWN_SOURCE')
  switch (request.capability) {
    case 'interpretInput':
      if (
        !bounded(value.title, 200) ||
        !['task', 'event'].includes(String(value.kind)) ||
        !isDate(value.date)
      )
        throw new Error('SCHEMA_VIOLATION')
      break
    case 'extractFacts':
      if (
        !Array.isArray(value.facts) ||
        value.facts.length > 20 ||
        !value.facts.every(
          (f) =>
            record(f) &&
            Object.keys(f).every((key) => ['field', 'value', 'sourceId'].includes(key)) &&
            [
              'DATE',
              'TIME',
              'LOCATION',
              'PERSON',
              'ORGANIZATION',
              'DEADLINE',
              'REQUIREMENT',
              'INSTRUCTION',
              'STATUS',
              'EVENT_CHANGE',
            ].includes(String(f.field)) &&
            bounded(f.value, 240) &&
            known.has(String(f.sourceId)),
        )
      )
        throw new Error('SCHEMA_VIOLATION')
      break
    case 'classifyItem':
      if (
        !['ACTIONABLE', 'CONTEXTUAL', 'INFORMATIONAL', 'IGNORE'].includes(
          String(value.classification),
        )
      )
        throw new Error('SCHEMA_VIOLATION')
      break
    case 'compareContextCandidates':
      if (
        ![
          'SAME_CONTEXT',
          'RELATED',
          'POSSIBLY_RELATED',
          'UNRELATED',
          'CONFLICTING',
          'UNKNOWN',
        ].includes(String(value.relation)) ||
        !strings(value.evidence) ||
        !strings(value.conflicts)
      )
        throw new Error('SCHEMA_VIOLATION')
      break
    case 'resolveAmbiguity':
      if (
        (value.selected !== null &&
          (!bounded(value.selected, 160) ||
            !Array.isArray(input.options) ||
            !input.options.includes(value.selected))) ||
        !strings(value.evidence)
      )
        throw new Error('SCHEMA_VIOLATION')
      break
    case 'summarizeContext':
      if (
        !bounded(value.summary, 500) ||
        !strings(value.sourceIds) ||
        value.sourceIds.some((id: string) => !known.has(id))
      )
        throw new Error('SCHEMA_VIOLATION')
      break
    case 'extractTemporalInformation':
      if (
        !Array.isArray(value.expressions) ||
        value.expressions.length > 20 ||
        !value.expressions.every((e) => record(e) && bounded(e.text, 80) && isDate(e.iso))
      )
        throw new Error('SCHEMA_VIOLATION')
      break
  }
  if (
    ((request.capability === 'compareContextCandidates' &&
      ['SAME_CONTEXT', 'RELATED'].includes(String(value.relation))) ||
      request.capability === 'extractFacts') &&
    parsed.sourceIds.length === 0
  )
    throw new Error('EVIDENCE_REQUIRED')
  if (
    request.capability === 'compareContextCandidates' &&
    ['SAME_CONTEXT', 'RELATED'].includes(String(value.relation))
  ) {
    const pair = request.input as { left: { id: string }; right: { id: string } }
    if (!parsed.sourceIds.includes(pair.left.id) || !parsed.sourceIds.includes(pair.right.id))
      throw new Error('EVIDENCE_REQUIRED')
  }
  if (parsed.confidence < request.minConfidence) throw new Error('LOW_CONFIDENCE')
  return {
    value: value as ProposalPayloads[C],
    confidence: parsed.confidence,
    sourceIds: parsed.sourceIds,
  }
}

/** Pair provenance is an input fact. Repair only source IDs, never relation or evidence text. */
export function canonicalizePairSourceIds<C extends Capability>(
  request: IntelligenceRequest<C>,
  raw: string,
): string | null {
  if (request.capability !== 'compareContextCandidates') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (
    !record(parsed) ||
    !Array.isArray(parsed.sourceIds) ||
    !parsed.sourceIds.every((id) => typeof id === 'string')
  )
    return null
  const pair = request.input as { left: { id?: string }; right: { id?: string } }
  if (!pair.left?.id || !pair.right?.id) return null
  parsed.sourceIds = [pair.left.id, pair.right.id]
  const repaired = JSON.stringify(parsed)
  return repaired.length <= request.budget.maxOutputChars ? repaired : null
}
