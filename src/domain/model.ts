import type { Confidence, Item, ItemKind } from '../types'

export type TemporalPrecision = 'exact' | 'day' | 'approximate' | 'inferred' | 'unknown'
export interface TemporalContext {
  startsAt?: string
  endsAt?: string
  dueAt?: string
  allDay?: boolean
  timezone?: string
  precision: TemporalPrecision
}
export type ExtractionMethod =
  | 'DIRECT'
  | 'DETERMINISTIC'
  | 'AI_EXTRACTED'
  | 'USER_CONFIRMED'
  | 'USER_CREATED'
export interface Provenance {
  providerId: string
  sourceLabel: string
  externalId: string
  conversationId?: string
  observedAt: string
  extractionMethod: ExtractionMethod
  confidence: Confidence
}
export interface Fact<T extends string = string> {
  field: string
  value: T
  provenance: Provenance
  confidence: Confidence
  observedAt: string
  effectiveAt?: string
}
export interface Entity {
  id: string
  type: 'event' | 'course' | 'project' | 'place' | 'person' | 'unknown'
  label: string
}
export interface CanonicalBase {
  id: string
  title: string
  summary: string
  temporal: TemporalContext
  provenance: Provenance[]
  facts: Fact[]
  entities: Entity[]
  sourceItem: Item
}
export type CanonicalItem =
  | (CanonicalBase & { kind: 'event'; temporal: TemporalContext & { startsAt: string } })
  | (CanonicalBase & { kind: 'task'; temporal: TemporalContext })
  | (CanonicalBase & { kind: 'email'; temporal: TemporalContext })
export type ContextType =
  | 'EVENT'
  | 'RESPONSIBILITY'
  | 'COMMUNICATION'
  | 'DEADLINE'
  | 'ACTIVITY'
  | 'UNKNOWN'
export type ContextLifecycle =
  | 'ACTIVE'
  | 'UPCOMING'
  | 'NEEDS_ATTENTION'
  | 'RESOLVED'
  | 'ARCHIVED'
  | 'DISMISSED'
export interface Conflict {
  id: string
  field: 'TIME' | 'DATE' | 'LOCATION' | 'STATUS' | 'DEADLINE' | 'PARTICIPANT' | 'INSTRUCTION'
  candidates: Fact[]
  severity: 'low' | 'medium' | 'high'
  confidence: Confidence
  resolutionState: 'UNRESOLVED' | 'AUTO_RESOLVED_SAFE' | 'USER_RESOLVED' | 'STALE'
  chosen?: Fact
}
export interface ConflictResolution {
  conflictId: string
  providerId: string
  externalId: string
  value: string
  updatedAt: string
}
export interface Relation {
  leftId: string
  rightId: string
  similarity: number
  confidence: Confidence
  evidence: string[]
  method: 'deterministic' | 'user'
}
export interface Context {
  id: string
  type: ContextType
  canonicalTitle: string
  itemRefs: string[]
  entityRefs: string[]
  temporal: TemporalContext
  facts: Fact[]
  conflicts: Conflict[]
  relations: Relation[]
  requirements: string[]
  confidence: Confidence
  lifecycle: ContextLifecycle
  createdAt: string
  updatedAt: string
}
export interface ContextCorrection {
  leftId: string
  rightId: string
  decision: 'link' | 'separate'
  updatedAt: string
}
export interface ContextDiagnostics {
  items: number
  candidatePairs: number
  comparedPairs: number
  contexts: number
  conflicts: number
  durationMs: number
}
export interface ContextGraph {
  items: CanonicalItem[]
  contexts: Context[]
  relations: Relation[]
  diagnostics: ContextDiagnostics
}

export function provenanceFor(item: Item): Provenance {
  return {
    providerId: item.sourceId,
    sourceLabel: item.source,
    externalId: item.externalId || item.id,
    conversationId: item.conversationId,
    observedAt: item.observedAt || item.sourceUpdatedAt,
    extractionMethod:
      item.extractionMethod || (item.sourceId === 'manual' ? 'USER_CREATED' : 'DIRECT'),
    confidence: item.confidence,
  }
}

export function authorityScore(fact: Fact): number {
  const method = {
    USER_CONFIRMED: 100,
    USER_CREATED: 80,
    DIRECT: 70,
    DETERMINISTIC: 50,
    AI_EXTRACTED: 20,
  }[fact.provenance.extractionMethod]
  const confidence = { high: 3, medium: 2, low: 1 }[fact.confidence]
  return method + confidence
}

const dateOnly = (text: string, now: Date): string | undefined => {
  const match = text.match(
    /(?:\b|^)(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\b|$)|(?<!\d)(\d{1,2})月(\d{1,2})日/,
  )
  if (!match) return undefined
  const month = Number(match[1] || match[3])
  const day = Number(match[2] || match[4])
  const date = new Date(now.getFullYear(), month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day ? date.toISOString() : undefined
}

function extractedFacts(item: Item, provenance: Provenance): Fact[] {
  const facts: Fact[] = []
  const push = (
    field: string,
    value: string,
    method: ExtractionMethod = provenance.extractionMethod,
  ) =>
    facts.push({
      field,
      value,
      provenance: { ...provenance, extractionMethod: method },
      confidence: provenance.confidence,
      observedAt: provenance.observedAt,
    })
  if (item.startAt) push('TIME', new Date(item.startAt).toISOString())
  if (item.deadline) push('DEADLINE', new Date(item.deadline).toISOString())
  if (item.kind === 'email') {
    const body = `${item.title} ${item.description}`
    const changed = body.match(
      /(?:moved\s+to|changed\s+to|変更(?:後)?(?:は|:|：)?|集合(?:は|時刻)?)[^\d]{0,12}(\d{1,2}):?(\d{2})/i,
    )
    if (changed) push('TIME_CLAIM', `${changed[1].padStart(2, '0')}:${changed[2]}`, 'DETERMINISTIC')
    const bring = body.match(/\bbring\s+([^.!?\n]{3,180})/i)
    if (bring)
      for (const part of bring[1].split(/\s+and\s+|,/i)) {
        const value = part.trim().replace(/^(?:your|the|a)\s+/i, '')
        if (value) push('REQUIREMENT', value, 'DETERMINISTIC')
      }
    const japanese = body.match(/持ち物[：:]\s*([^。\n]{2,100})/)
    if (japanese)
      for (const part of japanese[1].split(/[、,]/))
        if (part.trim()) push('REQUIREMENT', part.trim(), 'DETERMINISTIC')
  }
  return facts
}

export function extractEntities(item: Item): Entity[] {
  const title = item.title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^regarding\s+/i, '')
    .replace(/^prepare\s+.+?\s+for\s+/i, '')
    .replace(
      /\b(?:moved|changed|rescheduled|instructions|on|at|due|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/gi,
      ' ',
    )
    .replace(/\b\d{1,2}[\/-]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title || title.length > 80) return []
  return [
    {
      id: `topic:${title.replace(/\s+/g, '-')}`,
      type: item.kind === 'event' ? 'event' : 'unknown',
      label: title,
    },
  ]
}

export function toCanonical(item: Item, now = new Date()): CanonicalItem {
  const provenance = provenanceFor(item)
  const temporal: TemporalContext = {
    startsAt: item.startAt,
    endsAt: item.endAt,
    dueAt: item.deadline,
    allDay: item.allDay,
    precision: item.allDay ? 'day' : item.startAt || item.deadline ? 'exact' : 'unknown',
  }
  if (!temporal.startsAt && !temporal.dueAt) {
    const hinted = dateOnly(`${item.title} ${item.description}`, now)
    if (hinted) {
      temporal.startsAt = hinted
      temporal.precision = 'inferred'
    }
  }
  const base: CanonicalBase = {
    id: item.id,
    title: item.title,
    summary: item.description,
    temporal,
    provenance: [provenance],
    facts: extractedFacts(item, provenance),
    entities: extractEntities(item),
    sourceItem: item,
  }
  if (item.kind === 'event' && item.startAt)
    return { ...base, kind: 'event', temporal: { ...temporal, startsAt: item.startAt } }
  return {
    ...base,
    kind: (item.kind === 'event' ? 'task' : item.kind) as Exclude<ItemKind, 'event'>,
  }
}
