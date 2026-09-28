import type {
  CanonicalItem,
  Conflict,
  ConflictResolution,
  Context,
  ContextCorrection,
  ContextGraph,
  Fact,
  Relation,
} from './model'
import { authorityScore, toCanonical } from './model'
import type { Item } from '../types'
import { evaluateRelationship } from './relationship-policy'

export interface SimilarityWeights {
  title: number
  temporal: number
  sourceDiversity: number
  entity: number
}
export interface ContextEngineOptions {
  weights?: SimilarityWeights
  threshold?: number
  maxCandidatesPerItem?: number
}
export const DEFAULT_WEIGHTS: SimilarityWeights = {
  title: 0.65,
  temporal: 0.2,
  sourceDiversity: 0.1,
  entity: 0.05,
}
const stop = new Set([
  'the',
  'a',
  'an',
  'for',
  'to',
  'on',
  'at',
  'of',
  'and',
  'your',
  'regarding',
  'about',
  'instructions',
  'prepare',
  'preparing',
  'moved',
  'changed',
  'bring',
  'class',
])
const tokens = (text: string): string[] => {
  const cleaned = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d{1,4}[\/-]\d{1,2}(?:[\/-]\d{1,2})?/g, ' ')
  const english = cleaned.match(/[a-z]{2,}/g)?.filter((word) => !stop.has(word)) || []
  const japanese =
    cleaned.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) || []
  return [
    ...new Set([
      ...english,
      ...japanese.flatMap((value) =>
        value.length < 4
          ? [value]
          : Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)),
      ),
    ]),
  ]
}
const day = (iso?: string) => {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return ''
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const when = (item: CanonicalItem) => item.temporal.startsAt || item.temporal.dueAt
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const signature = (ids: string[]) => {
  let hash = 0xcbf29ce484222325n
  for (const character of ids.slice().sort().join('\u0000'))
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n)
  return `context:${hash.toString(16).padStart(16, '0')}`
}

export function generateCandidates(items: CanonicalItem[], cap = 40): Array<[number, number]> {
  const index = new Map<string, number[]>()
  const pairs = new Set<string>()
  for (let i = 0; i < items.length; i += 1) {
    const keys = [
      ...tokens(items[i].title).map((token) => `word:${token}`),
      ...(day(when(items[i])) ? [`day:${day(when(items[i]))}`] : []),
    ]
    const found = new Set<number>()
    for (const key of keys) for (const j of index.get(key) || []) if (found.size < cap) found.add(j)
    for (const j of found) pairs.add(`${j}:${i}`)
    for (const key of keys) {
      const values = index.get(key) || []
      values.push(i)
      if (values.length > cap) values.shift()
      index.set(key, values)
    }
  }
  return [...pairs].map((value) => value.split(':').map(Number) as [number, number])
}

export function scoreRelation(
  a: CanonicalItem,
  b: CanonicalItem,
  weights: SimilarityWeights = DEFAULT_WEIGHTS,
): Relation | null {
  const guard = evaluateRelationship(
    {
      id: a.id,
      title: a.title,
      description: a.summary,
      date: a.temporal.startsAt || a.temporal.dueAt,
      conversationId: a.sourceItem.conversationId,
    },
    {
      id: b.id,
      title: b.title,
      description: b.summary,
      date: b.temporal.startsAt || b.temporal.dueAt,
      conversationId: b.sourceItem.conversationId,
    },
    'SAME_CONTEXT',
  )
  if (
    guard.negativeEvidence.some((value) =>
      ['different_event_identifier', 'advertisement_vs_event', 'explicit_different_event'].includes(
        value,
      ),
    )
  )
    return null
  const left = new Set(tokens(a.title))
  const right = new Set(tokens(b.title))
  const shared = [...left].filter((value) => right.has(value))
  const unique = new Set([...left, ...right]).size
  const title = unique ? shared.length / unique : 0
  const aDay = day(when(a))
  const bDay = day(when(b))
  const sameDay = !!aDay && aDay === bDay
  const farApart =
    !!aDay &&
    !!bDay &&
    Math.abs(new Date(aDay).getTime() - new Date(bDay).getTime()) > 2 * 86_400_000
  const sameConversation =
    !!a.sourceItem.conversationId && a.sourceItem.conversationId === b.sourceItem.conversationId
  if (farApart || (a.sourceItem.sourceId === b.sourceItem.sourceId && !sameConversation))
    return null
  const explicitUpdate = /\b(?:moved|changed|rescheduled)\b|変更|移動/.test(
    `${a.title} ${a.summary} ${b.title} ${b.summary}`.toLowerCase(),
  )
  if (
    shared.length < 2 &&
    !(shared.length >= 1 && sameDay && explicitUpdate) &&
    !(sameConversation && shared.length >= 1)
  )
    return null
  const evidence = [
    ...shared.map((value) => `title:${value}`),
    ...(sameDay ? ['same-day'] : []),
    ...(a.sourceItem.sourceId !== b.sourceItem.sourceId ? ['independent-sources'] : []),
    ...(sameConversation ? ['same-conversation'] : []),
  ]
  const entityMatch = a.entities.some((entity) =>
    b.entities.some((other) => entity.id === other.id),
  )
  if (entityMatch) evidence.push('same-entity')
  const temporal = sameDay ? 1 : aDay && bDay ? 0 : 0.4
  const similarity = Math.min(
    1,
    weights.title * Math.min(1, title + shared.length * 0.18) +
      weights.temporal * temporal +
      weights.sourceDiversity * Number(a.sourceItem.sourceId !== b.sourceItem.sourceId) +
      weights.entity * Number(entityMatch) +
      (sameConversation ? 0.1 : 0),
  )
  const confidence =
    shared.length >= 2 && sameDay ? 'high' : shared.length >= 2 || sameDay ? 'medium' : 'low'
  return {
    leftId: a.id,
    rightId: b.id,
    similarity: Number(similarity.toFixed(3)),
    confidence,
    evidence,
    method: 'deterministic',
  }
}

function conflicts(facts: Fact[], id: string, resolutions: ConflictResolution[]): Conflict[] {
  const starts = facts.filter((fact) => fact.field === 'TIME' || fact.field === 'TIME_CLAIM')
  const values = new Set(
    starts.map((fact) =>
      fact.field === 'TIME'
        ? `${String(new Date(fact.value).getHours()).padStart(2, '0')}:${String(new Date(fact.value).getMinutes()).padStart(2, '0')}`
        : fact.value,
    ),
  )
  if (values.size < 2 || starts.length < 2) return []
  const resolution = resolutions.find((value) => value.conflictId === `${id}:TIME`)
  const chosen =
    resolution &&
    starts.find(
      (fact) =>
        fact.provenance.providerId === resolution.providerId &&
        fact.provenance.externalId === resolution.externalId &&
        fact.value === resolution.value,
    )
  return [
    {
      id: `${id}:TIME`,
      field: 'TIME',
      candidates: starts.slice().sort((a, b) => authorityScore(b) - authorityScore(a)),
      severity: 'high',
      confidence: 'medium',
      resolutionState: chosen ? 'USER_RESOLVED' : 'UNRESOLVED',
      ...(chosen ? { chosen } : {}),
    },
  ]
}

export function buildContextGraph(
  sourceItems: Item[],
  corrections: ContextCorrection[] = [],
  now = new Date(),
  options: ContextEngineOptions = {},
  resolutions: ConflictResolution[] = [],
): ContextGraph {
  const items = sourceItems
    .filter((item) => item.status === 'active')
    .map((item) => toCanonical(item, now))
  const candidates = generateCandidates(items, options.maxCandidatesPerItem)
  const byId = new Map(items.map((item, index) => [item.id, index]))
  const correction = new Map(
    corrections.map((value) => [pairKey(value.leftId, value.rightId), value.decision]),
  )
  const parent = items.map((_, index) => index)
  const find = (n: number): number => {
    while (parent[n] !== n) n = parent[n]
    return n
  }
  const separated = (left: number, right: number) =>
    corrections.some(
      (value) =>
        value.decision === 'separate' &&
        byId.has(value.leftId) &&
        byId.has(value.rightId) &&
        ((find(byId.get(value.leftId)!) === left && find(byId.get(value.rightId)!) === right) ||
          (find(byId.get(value.leftId)!) === right && find(byId.get(value.rightId)!) === left)),
    )
  const relations: Relation[] = []
  const proposals = candidates
    .map(([i, j]) => {
      const decision = correction.get(pairKey(items[i].id, items[j].id))
      if (decision === 'separate') return null
      const relation = scoreRelation(items[i], items[j], options.weights)
      return decision === 'link'
        ? ({
            leftId: items[i].id,
            rightId: items[j].id,
            similarity: 1,
            confidence: 'high',
            evidence: ['user-confirmed'],
            method: 'user',
          } satisfies Relation)
        : relation
    })
    .filter((value): value is Relation => !!value)
  for (const value of corrections.filter((value) => value.decision === 'link'))
    if (
      byId.has(value.leftId) &&
      byId.has(value.rightId) &&
      !proposals.some((p) => pairKey(p.leftId, p.rightId) === pairKey(value.leftId, value.rightId))
    )
      proposals.push({
        leftId: value.leftId,
        rightId: value.rightId,
        similarity: 1,
        confidence: 'high',
        evidence: ['user-confirmed'],
        method: 'user',
      })
  proposals.sort(
    (a, b) =>
      Number(b.method === 'user') - Number(a.method === 'user') || b.similarity - a.similarity,
  )
  for (const relation of proposals) {
    if (relation.method !== 'user' && relation.similarity < (options.threshold ?? 0.53)) continue
    const left = find(byId.get(relation.leftId)!)
    const right = find(byId.get(relation.rightId)!)
    if (left === right || separated(left, right)) continue
    if (relation.method !== 'user') {
      const leftGroup = items.filter((_, index) => find(index) === left)
      const rightGroup = items.filter((_, index) => find(index) === right)
      const contradiction = leftGroup.some((a) =>
        rightGroup.some((b) => {
          const check = evaluateRelationship(
            {
              id: a.id,
              title: a.title,
              description: a.summary,
              date: a.temporal.startsAt || a.temporal.dueAt,
              conversationId: a.sourceItem.conversationId,
            },
            {
              id: b.id,
              title: b.title,
              description: b.summary,
              date: b.temporal.startsAt || b.temporal.dueAt,
              conversationId: b.sourceItem.conversationId,
            },
            'UNKNOWN',
          )
          return check.negativeEvidence.some((value) =>
            [
              'different_event_identifier',
              'advertisement_vs_event',
              'explicit_different_event',
            ].includes(value),
          )
        }),
      )
      if (contradiction) continue
    }
    parent[right] = left
    relations.push(relation)
  }
  const groups = new Map<number, CanonicalItem[]>()
  for (let i = 0; i < items.length; i += 1) {
    const key = find(i)
    groups.set(key, [...(groups.get(key) || []), items[i]])
  }
  const contexts: Context[] = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const ordered = group
        .slice()
        .sort(
          (a, b) =>
            Number(b.kind === 'event') - Number(a.kind === 'event') ||
            b.title.length - a.title.length ||
            a.id.localeCompare(b.id),
        )
      const leader = ordered[0]
      const id = signature(group.map((item) => item.id))
      const facts = group.flatMap((item) => item.facts)
      const requirements = [
        ...new Set(facts.filter((fact) => fact.field === 'REQUIREMENT').map((fact) => fact.value)),
      ]
      const related = relations.filter(
        (relation) =>
          group.some((item) => item.id === relation.leftId) &&
          group.some((item) => item.id === relation.rightId),
      )
      const detected = conflicts(facts, id, resolutions)
      const event = ordered.find((item) => item.kind === 'event')
      const temporal = { ...(event?.temporal || leader.temporal) }
      const selected = detected.find((conflict) => conflict.chosen)?.chosen
      if (selected && temporal.startsAt) {
        if (selected.field === 'TIME') temporal.startsAt = selected.value
        else if (selected.field === 'TIME_CLAIM') {
          const original = new Date(temporal.startsAt)
          const [hour, minute] = selected.value.split(':').map(Number)
          original.setHours(hour, minute, 0, 0)
          temporal.startsAt = original.toISOString()
        }
      }
      return {
        id,
        type: event
          ? 'EVENT'
          : group.some((item) => item.kind === 'task')
            ? 'RESPONSIBILITY'
            : 'COMMUNICATION',
        canonicalTitle: leader.title,
        itemRefs: group.map((item) => item.id).sort(),
        entityRefs: [...new Set(group.flatMap((item) => item.entities.map((entity) => entity.id)))],
        temporal,
        facts,
        conflicts: detected,
        relations: related,
        requirements,
        confidence: related.every((value) => value.confidence === 'high') ? 'high' : 'medium',
        lifecycle: detected.some((conflict) => conflict.resolutionState === 'UNRESOLVED')
          ? 'NEEDS_ATTENTION'
          : 'ACTIVE',
        createdAt: group.map((item) => item.sourceItem.createdAt).sort()[0],
        updatedAt: group
          .map((item) => item.sourceItem.lastUpdated)
          .sort()
          .at(-1)!,
      } satisfies Context
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    items,
    contexts,
    relations,
    diagnostics: {
      items: items.length,
      candidatePairs: candidates.length,
      comparedPairs: proposals.length,
      contexts: contexts.length,
      conflicts: contexts.reduce((sum, context) => sum + context.conflicts.length, 0),
      durationMs: 0,
    },
  }
}

export function addCorrection(
  corrections: ContextCorrection[],
  leftId: string,
  rightId: string,
  decision: ContextCorrection['decision'],
  at = new Date().toISOString(),
): ContextCorrection[] {
  const key = pairKey(leftId, rightId)
  return [
    ...corrections.filter((value) => pairKey(value.leftId, value.rightId) !== key),
    { leftId, rightId, decision, updatedAt: at },
  ]
}
