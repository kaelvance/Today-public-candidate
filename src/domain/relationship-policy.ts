import type { EvidenceItem, RelationLabel } from '../intelligence/types'

export interface RelationshipDecision {
  relation: RelationLabel
  positiveEvidence: string[]
  negativeEvidence: string[]
  evidenceVersion: 'today-evidence/1.1'
  evidenceStrength: Array<{
    id: string
    strength: 'HARD_POSITIVE' | 'SOFT_POSITIVE' | 'SOFT_NEGATIVE' | 'HARD_VETO'
  }>
  calibratedConfidence: number
  reason: string
}

export const EVIDENCE_VERSION = 'today-evidence/1.1' as const
export const relationshipEvidenceIds = {
  SAME_EXTERNAL_EVENT_ID: 'HARD_POSITIVE',
  SAME_CONVERSATION: 'SOFT_POSITIVE',
  SHARED_TITLE: 'SOFT_POSITIVE',
  SHARED_NORMALIZED_TITLE: 'SOFT_POSITIVE',
  TEMPORAL_PROXIMITY: 'SOFT_POSITIVE',
  EXPLICIT_REFERENCE: 'SOFT_POSITIVE',
  TASK_DEPENDS_ON_EVENT: 'SOFT_POSITIVE',
  DIFFERENT_EVENT_ID: 'HARD_VETO',
  DATE_CONFLICT: 'HARD_VETO',
  EXPLICIT_DIFFERENT_EVENT: 'HARD_VETO',
  ADVERTISEMENT: 'HARD_VETO',
  CANCELLED_EVENT: 'SOFT_NEGATIVE',
  NO_IDENTITY_EVIDENCE: 'SOFT_NEGATIVE',
} as const

const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
const words = (value: string) =>
  new Set(
    (
      normalized(value).match(
        /[a-z]{3,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu,
      ) || []
    ).flatMap((part) =>
      part.length < 4
        ? [part]
        : Array.from({ length: part.length - 1 }, (_, i) => part.slice(i, i + 2)),
    ),
  )
const date = (item: EvidenceItem): string | null => {
  if (item.date && Number.isFinite(Date.parse(item.date))) return item.date.slice(0, 10)
  const match = `${item.title} ${item.description || ''}`.match(
    /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/,
  )
  return match
    ? `${match[1] || '????'}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    : null
}
const eventId = (item: EvidenceItem): string | null =>
  item.eventId ||
  `${item.title} ${item.description || ''}`.match(
    /(?:予約番号|受付番号|event\s*id|booking\s*id)\s*[:：#]?\s*([a-z0-9-]{4,})/i,
  )?.[1] ||
  null
const changes =
  /中止|キャンセル|延期|変更|移動|取りやめ|cancel(?:led|ed)?|postponed|rescheduled|changed/i
const ads = /^(?:広告|PR|スポンサー)[:：]|advertisement/i
const separate = /別件|無関係|unrelated|different event/i

/** Independent, conservative evidence policy. Model prose and model confidence never establish identity. */
export function evaluateRelationship(
  left: EvidenceItem,
  right: EvidenceItem,
  proposed: RelationLabel,
  _confidence = 0,
): RelationshipDecision {
  void _confidence // Reported confidence cannot establish event identity.
  const positiveEvidence: string[] = []
  const negativeEvidence: string[] = []
  const a = words(left.title),
    b = words(right.title)
  const overlap = [...a].filter((token) => b.has(token)).length
  const similarity = a.size + b.size - overlap ? overlap / (a.size + b.size - overlap) : 0
  const leftDate = date(left),
    rightDate = date(right)
  const leftId = eventId(left),
    rightId = eventId(right)
  const sameConversation = !!left.conversationId && left.conversationId === right.conversationId
  const leftTitle = normalized(left.title),
    rightTitle = normalized(right.title)
  const leftDescription = normalized(left.description || ''),
    rightDescription = normalized(right.description || '')
  const explicitTaskReference =
    !!leftDate &&
    leftDate === rightDate &&
    ((rightTitle.includes(leftTitle) && /の前に|のために|までに|に持参/.test(right.title)) ||
      (leftTitle.includes(rightTitle) && /の前に|のために|までに|に持参/.test(left.title)) ||
      (rightDescription.includes(leftTitle) &&
        /参加に必要|の準備|のため|持参/.test(right.description || '')) ||
      (leftDescription.includes(rightTitle) &&
        /参加に必要|の準備|のため|持参/.test(left.description || '')))
  const sameDayConfirmation =
    !!leftDate &&
    leftDate === rightDate &&
    ((rightTitle.includes(leftTitle) && /参加確認|申込受付|受付完了|予約確認/.test(right.title)) ||
      (leftTitle.includes(rightTitle) && /参加確認|申込受付|受付完了|予約確認/.test(left.title)))
  if (similarity >= 0.55) positiveEvidence.push('strong_title_similarity')
  else if (similarity >= 0.2) positiveEvidence.push('partial_title_similarity')
  if (leftDate && rightDate && leftDate === rightDate) positiveEvidence.push('same_explicit_date')
  if (leftId && rightId && leftId === rightId) positiveEvidence.push('same_event_identifier')
  if (sameConversation) positiveEvidence.push('same_conversation')
  if (explicitTaskReference) positiveEvidence.push('explicit_task_reference')
  if (leftDate && rightDate && leftDate !== rightDate) negativeEvidence.push('date_conflict')
  if (leftId && rightId && leftId !== rightId) negativeEvidence.push('different_event_identifier')
  if (ads.test(left.title) !== ads.test(right.title))
    negativeEvidence.push('advertisement_vs_event')
  if (separate.test(left.title) || separate.test(right.title))
    negativeEvidence.push('explicit_different_event')
  if (
    changes.test(left.title) !== changes.test(right.title) &&
    (similarity >= 0.2 || sameConversation || (leftId && leftId === rightId))
  )
    negativeEvidence.push('status_change')
  if (similarity < 0.12 && !sameConversation && !(leftId && leftId === rightId))
    negativeEvidence.push('no_identity_evidence')

  const evidenceStrength: RelationshipDecision['evidenceStrength'] = [
    ...positiveEvidence.map((id) => ({
      id:
        id === 'same_event_identifier'
          ? 'SAME_EXTERNAL_EVENT_ID'
          : id === 'same_conversation'
            ? 'SAME_CONVERSATION'
            : id === 'strong_title_similarity'
              ? 'SHARED_NORMALIZED_TITLE'
              : id === 'same_explicit_date'
                ? 'TEMPORAL_PROXIMITY'
                : id === 'explicit_task_reference'
                  ? 'TASK_DEPENDS_ON_EVENT'
                  : 'SHARED_TITLE',
      strength:
        id === 'same_event_identifier' ? ('HARD_POSITIVE' as const) : ('SOFT_POSITIVE' as const),
    })),
    ...negativeEvidence.map((id) => ({
      id:
        id === 'different_event_identifier'
          ? 'DIFFERENT_EVENT_ID'
          : id === 'date_conflict'
            ? 'DATE_CONFLICT'
            : id === 'advertisement_vs_event'
              ? 'ADVERTISEMENT'
              : id === 'explicit_different_event'
                ? 'EXPLICIT_DIFFERENT_EVENT'
                : id === 'status_change'
                  ? 'CANCELLED_EVENT'
                  : 'NO_IDENTITY_EVIDENCE',
      strength: [
        'different_event_identifier',
        'date_conflict',
        'advertisement_vs_event',
        'explicit_different_event',
      ].includes(id)
        ? ('HARD_VETO' as const)
        : ('SOFT_NEGATIVE' as const),
    })),
  ]
  const decide = (relation: RelationLabel, reason: string): RelationshipDecision => ({
    relation,
    positiveEvidence,
    negativeEvidence,
    evidenceVersion: EVIDENCE_VERSION,
    evidenceStrength,
    calibratedConfidence:
      relation === 'SAME_CONTEXT'
        ? leftId && leftId === rightId
          ? 1
          : 0.85
        : relation === 'RELATED'
          ? 0.75
          : relation === 'CONFLICTING' || relation === 'UNRELATED'
            ? 0.9
            : 0.4,
    reason,
  })
  if (
    negativeEvidence.includes('different_event_identifier') ||
    negativeEvidence.includes('advertisement_vs_event') ||
    negativeEvidence.includes('explicit_different_event')
  )
    return decide('UNRELATED', 'DETERMINISTIC_VETO')
  if (
    negativeEvidence.includes('status_change') &&
    (similarity >= 0.2 || sameConversation || (leftId === rightId && !!leftId))
  )
    return decide('CONFLICTING', 'STATUS_CONFLICT')
  if (negativeEvidence.includes('date_conflict'))
    return decide(
      (leftId && leftId === rightId) || sameConversation ? 'CONFLICTING' : 'UNRELATED',
      'DATE_CONFLICT',
    )
  if (leftId && leftId === rightId) return decide('SAME_CONTEXT', 'AUTHORITATIVE_EVENT_ID')
  if (explicitTaskReference && proposed !== 'UNRELATED' && proposed !== 'CONFLICTING')
    return decide('RELATED', 'EXPLICIT_TASK_REFERENCE')
  if (sameDayConfirmation && (proposed === 'SAME_CONTEXT' || proposed === 'RELATED'))
    return decide('RELATED', 'SAME_DAY_CONFIRMATION')
  if (proposed === 'UNRELATED' || proposed === 'CONFLICTING' || proposed === 'UNKNOWN')
    return decide(proposed, 'MODEL_CONSERVATIVE')
  if (
    proposed === 'SAME_CONTEXT' &&
    ((leftId && leftId === rightId) ||
      (sameConversation && similarity >= 0.2) ||
      (similarity >= 0.55 && leftDate && rightDate && leftDate === rightDate))
  )
    return decide('SAME_CONTEXT', 'INDEPENDENT_IDENTITY_AND_TIME')
  if (
    proposed === 'RELATED' &&
    (sameConversation || (similarity >= 0.55 && leftDate && rightDate && leftDate === rightDate))
  )
    return decide('RELATED', 'INDEPENDENT_RELATION_EVIDENCE')
  if (similarity >= 0.2 || sameConversation)
    return decide('POSSIBLY_RELATED', 'INSUFFICIENT_IDENTITY_EVIDENCE')
  return decide('UNKNOWN', 'INSUFFICIENT_EVIDENCE')
}
