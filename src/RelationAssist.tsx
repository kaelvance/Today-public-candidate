import { useEffect, useRef, useState } from 'react'
import { activeApplication } from './application/composition'
import type { ContextCorrection } from './domain/model'
import type { IntelligenceMode, RelationLabel } from './intelligence/types'
import type { Item } from './types'
import { ShadowLog } from './intelligence/shadow'
import { EVIDENCE_VERSION } from './domain/relationship-policy'

const relationText: Record<RelationLabel, string> = {
  SAME_CONTEXT: '同じ出来事の候補',
  RELATED: '関連する出来事の候補',
  POSSIBLY_RELATED: '関連は未確定',
  UNRELATED: '別の出来事と判断',
  CONFLICTING: '内容に食い違いの可能性',
  UNKNOWN: '判断材料が不足',
}

/** Model results are displayed for review. Only the user's button applies a Context correction. */
export function RelationAssist({
  item,
  candidates,
  corrections,
  mode,
  shadowEnabled,
  onLink,
}: {
  item: Item
  candidates: Item[]
  corrections: ContextCorrection[]
  mode: IntelligenceMode
  shadowEnabled?: boolean
  onLink: (other: Item) => void
}) {
  const [result, setResult] = useState<{
    id: string
    label: string
    canLink: boolean
    relation?: RelationLabel
    traceId?: string
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [item.id])
  const ask = async (other: Item) => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusyId(other.id)
    setResult(null)
    try {
      const response = await activeApplication.proposeRelation(
        item,
        other,
        corrections,
        next.signal,
      )
      if (next.signal.aborted) return
      if (response.status === 'proposal') {
        const relation = response.proposal.value.relation
        let traceId: string | undefined
        if (shadowEnabled)
          try {
            traceId = new ShadowLog(localStorage).propose(
              item.id,
              other.id,
              relation,
              response.proposal.providerId,
              {
                modelId: response.proposal.modelId,
                policyVersion: EVIDENCE_VERSION,
                confidence: response.proposal.confidence,
                evidenceCategories: response.proposal.value.evidence.slice(0, 4),
              },
            ).id
          } catch {
            /* Shadow log is optional. */
          }
        setResult({
          id: other.id,
          label: `${relationText[relation]} · 実験的なAI提案`,
          canLink: relation === 'SAME_CONTEXT' || relation === 'RELATED',
          relation,
          traceId,
        })
      } else if (
        response.status === 'deterministic' &&
        response.reason === 'CONTEXT_ENGINE_CONFIDENT'
      ) {
        setResult({ id: other.id, label: '既存のContext判定で関連候補', canLink: true })
      } else if (response.status === 'deterministic' && response.reason === 'CONTEXT_UNRELATED') {
        setResult({ id: other.id, label: '日付や内容から別件と判断', canLink: false })
      } else if (response.status === 'deterministic' && response.reason === 'CONTEXT_CONFLICTING') {
        setResult({ id: other.id, label: '中止・延期などの食い違いを確認', canLink: false })
      } else
        setResult({
          id: other.id,
          label: '判定できませんでした。手動で関連付けできます。',
          canLink: false,
        })
    } catch {
      if (!next.signal.aborted)
        setResult({
          id: other.id,
          label: '判定できませんでした。手動で関連付けできます。',
          canLink: false,
        })
    } finally {
      if (!next.signal.aborted) setBusyId(null)
    }
  }
  return (
    <details className="archive-section">
      <summary>ほかの項目と関連付ける</summary>
      {candidates.map((other) => (
        <div className="context-member" key={other.id}>
          <button
            className="reset-button"
            onClick={() => {
              if (shadowEnabled && result?.id === other.id && result.traceId)
                try {
                  new ShadowLog(localStorage).feedback(result.traceId, 'SHOULD_LINK')
                } catch {
                  /* Optional */
                }
              onLink(other)
            }}
          >
            {other.title}
          </button>
          {mode !== 'DISABLED' && (
            <button
              className="button button-text"
              disabled={busyId !== null}
              onClick={() => void ask(other)}
            >
              {busyId === other.id ? '確認中…' : 'AIで確認'}
            </button>
          )}
          {result?.id === other.id && (
            <div role="status">
              <span>{result.label}</span>
              {result.canLink && (
                <button
                  className="button button-text"
                  onClick={() => {
                    if (result.traceId)
                      try {
                        new ShadowLog(localStorage).feedback(result.traceId, 'CORRECT')
                      } catch {
                        /* Optional */
                      }
                    onLink(other)
                  }}
                >
                  提案を見て関連付ける
                </button>
              )}
              {result.traceId && (
                <>
                  <button
                    className="button button-text"
                    onClick={() => {
                      try {
                        new ShadowLog(localStorage).feedback(
                          result.traceId!,
                          result.canLink ? 'SHOULD_NOT_LINK' : 'WRONG',
                        )
                      } catch {
                        /* Optional */
                      }
                      setResult(null)
                    }}
                  >
                    提案を却下
                  </button>
                  <button
                    className="button button-text"
                    onClick={() => {
                      try {
                        new ShadowLog(localStorage).feedback(result.traceId!, 'UNSURE')
                      } catch {
                        /* Optional */
                      }
                      setResult(null)
                    }}
                  >
                    保留
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </details>
  )
}
