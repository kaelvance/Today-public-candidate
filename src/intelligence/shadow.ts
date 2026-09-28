import type { RelationLabel } from './types'

export type ShadowOutcome =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'manual_correction'
  | 'unknown_resolved'
export type ShadowFeedback = 'CORRECT' | 'WRONG' | 'SHOULD_LINK' | 'SHOULD_NOT_LINK' | 'UNSURE'
export interface ShadowTrace {
  id: string
  leftId: string
  rightId: string
  proposed: RelationLabel
  providerId: string
  outcome: ShadowOutcome
  feedback?: ShadowFeedback
  modelId?: string
  policyVersion?: string
  confidence?: number
  evidenceCategories?: string[]
  at: string
}
const KEY = 'today-private-shadow-v1'

/** Local-only, opt-in observations. Source text and model output are never persisted. */
export class ShadowLog {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> &
      Partial<Pick<Storage, 'removeItem'>>,
  ) {}
  read(): ShadowTrace[] {
    try {
      const value = JSON.parse(this.storage.getItem(KEY) || '[]') as unknown
      return Array.isArray(value)
        ? (value
            .filter(
              (row) =>
                row &&
                typeof row.id === 'string' &&
                typeof row.leftId === 'string' &&
                typeof row.rightId === 'string' &&
                typeof row.proposed === 'string' &&
                typeof row.outcome === 'string',
            )
            .slice(-1000) as ShadowTrace[])
        : []
    } catch {
      return []
    }
  }
  propose(
    leftId: string,
    rightId: string,
    proposed: RelationLabel,
    providerId: string,
    metadata: Pick<
      ShadowTrace,
      'modelId' | 'policyVersion' | 'confidence' | 'evidenceCategories'
    > = {},
  ): ShadowTrace {
    const trace = {
      id: crypto.randomUUID(),
      leftId,
      rightId,
      proposed,
      providerId,
      outcome: 'pending' as const,
      ...metadata,
      at: new Date().toISOString(),
    }
    this.storage.setItem(KEY, JSON.stringify([...this.read(), trace].slice(-1000)))
    return trace
  }
  resolve(id: string, outcome: Exclude<ShadowOutcome, 'pending'>): void {
    this.storage.setItem(
      KEY,
      JSON.stringify(this.read().map((trace) => (trace.id === id ? { ...trace, outcome } : trace))),
    )
  }
  feedback(id: string, label: ShadowFeedback): void {
    const outcomes: Record<ShadowFeedback, ShadowOutcome> = {
      CORRECT: 'accepted',
      WRONG: 'rejected',
      SHOULD_LINK: 'manual_correction',
      SHOULD_NOT_LINK: 'manual_correction',
      UNSURE: 'pending',
    }
    this.storage.setItem(
      KEY,
      JSON.stringify(
        this.read().map((trace) =>
          trace.id === id ? { ...trace, feedback: label, outcome: outcomes[label] } : trace,
        ),
      ),
    )
  }
  clear(): void {
    if (this.storage.removeItem) this.storage.removeItem(KEY)
    else this.storage.setItem(KEY, '[]')
  }
  metrics(): {
    observed: number
    labelled: number
    accepted: number
    rejected: number
    corrections: number
    abstentions: number
    falseMerges: number
    missedRelations: number
  } {
    const rows = this.read()
    return {
      observed: rows.length,
      labelled: rows.filter((row) => row.feedback).length,
      accepted: rows.filter((row) => row.feedback === 'CORRECT').length,
      rejected: rows.filter((row) => row.feedback === 'WRONG').length,
      corrections: rows.filter(
        (row) => row.feedback === 'SHOULD_LINK' || row.feedback === 'SHOULD_NOT_LINK',
      ).length,
      abstentions: rows.filter(
        (row) => row.proposed === 'UNKNOWN' || row.proposed === 'POSSIBLY_RELATED',
      ).length,
      falseMerges: rows.filter(
        (row) =>
          row.feedback === 'SHOULD_NOT_LINK' && ['SAME_CONTEXT', 'RELATED'].includes(row.proposed),
      ).length,
      missedRelations: rows.filter(
        (row) =>
          row.feedback === 'SHOULD_LINK' && !['SAME_CONTEXT', 'RELATED'].includes(row.proposed),
      ).length,
    }
  }
  counts(): Record<ShadowOutcome, number> {
    const rows = this.read()
    return Object.fromEntries(
      (
        [
          'pending',
          'accepted',
          'rejected',
          'manual_correction',
          'unknown_resolved',
        ] as ShadowOutcome[]
      ).map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length]),
    ) as Record<ShadowOutcome, number>
  }
}
