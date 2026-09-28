import { scoreRelation } from '../domain/context-engine'
import { toCanonical } from '../domain/model'
import type { ContextCorrection } from '../domain/model'
import type { Item } from '../types'
import { intelligenceRequest, IntelligenceRouter } from './router'
import type { RouteResult } from './types'
import { evaluateRelationship } from '../domain/relationship-policy'

export function contextFingerprint(left: Item, right: Item): string {
  return [
    left.id,
    left.lastUpdated,
    left.title,
    left.description,
    right.id,
    right.lastUpdated,
    right.title,
    right.description,
  ].join('\u001f')
}
export async function proposeContextRelation(
  router: IntelligenceRouter,
  left: Item,
  right: Item,
  corrections: ContextCorrection[],
  signal: AbortSignal,
): Promise<RouteResult<'compareContextCandidates'>> {
  const correction = corrections.find(
    (value) =>
      [value.leftId, value.rightId].sort().join('|') === [left.id, right.id].sort().join('|'),
  )
  if (correction)
    return {
      status: 'deterministic',
      reason: correction.decision === 'link' ? 'USER_CONFIRMED_LINK' : 'USER_CONFIRMED_SEPARATE',
    }
  const score = scoreRelation(toCanonical(left, new Date()), toCanonical(right, new Date()))
  const leftEvidence = {
    id: left.id,
    title: left.title,
    description: left.description,
    date: left.startAt || left.deadline,
    conversationId: left.conversationId,
  }
  const rightEvidence = {
    id: right.id,
    title: right.title,
    description: right.description,
    date: right.startAt || right.deadline,
    conversationId: right.conversationId,
  }
  const evidence = evaluateRelationship(leftEvidence, rightEvidence, 'SAME_CONTEXT')
  if (evidence.relation === 'UNRELATED' || evidence.relation === 'CONFLICTING')
    return { status: 'deterministic', reason: `CONTEXT_${evidence.relation}` }
  if (score && score.similarity >= 0.53 && evidence.relation === 'SAME_CONTEXT')
    return { status: 'deterministic', reason: 'CONTEXT_ENGINE_CONFIDENT' }
  if (
    !evidence.positiveEvidence.some((value) =>
      [
        'strong_title_similarity',
        'partial_title_similarity',
        'same_event_identifier',
        'same_conversation',
      ].includes(value),
    )
  )
    return { status: 'unknown', reason: 'NO_CANDIDATE_EVIDENCE' }
  const privacy = [left, right].some((item) => item.sourceId !== 'manual' && !item.demo)
    ? 'CONNECTED_SERVICE_DATA'
    : 'LOCAL_PRIVATE'
  const input = {
    left: { ...leftEvidence, sourceId: left.sourceId },
    right: { ...rightEvidence, sourceId: right.sourceId },
  }
  return router.route(
    intelligenceRequest(
      'compareContextCandidates',
      input,
      privacy,
      contextFingerprint(left, right),
    ),
    signal,
  )
}
