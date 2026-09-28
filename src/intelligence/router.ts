import { minimizeRequest, privacyAllowed, type ContextBudgetReport } from './privacy'
import { canonicalizePairSourceIds, validateOutput } from './schemas'
import { evaluateRelationship } from '../domain/relationship-policy'
import type {
  Capability,
  IntelligencePolicy,
  IntelligenceProvider,
  IntelligenceRequest,
  RouteResult,
} from './types'

export interface IntelligenceDiagnostic {
  traceId: string
  capability: Capability
  providerId: string
  modelId?: string
  latencyMs: number
  success: boolean
  reason?: string
  inputChars: number
  outputChars: number
  confidence?: number
  policyConfidence?: number
  fallback: boolean
  context: ContextBudgetReport
  rawRelation?: string
  policyRelation?: string
  positiveEvidence?: string[]
  negativeEvidence?: string[]
  sourceIdsRepaired?: boolean
}
export class IntelligenceRouter {
  private readonly generations = new Map<string, string>()
  private active = 0
  readonly diagnostics: IntelligenceDiagnostic[] = []
  constructor(
    readonly providers: readonly IntelligenceProvider[],
    readonly policy: IntelligencePolicy,
    readonly isCurrent: (fingerprint: string) => boolean = () => true,
  ) {}
  invalidate(traceId: string): void {
    this.generations.delete(traceId)
  }
  async route<C extends Capability>(
    request: IntelligenceRequest<C>,
    signal: AbortSignal,
    deterministic?: () => RouteResult<C> | null,
  ): Promise<RouteResult<C>> {
    const decided = deterministic?.()
    if (decided && decided.status !== 'unknown') return decided
    if (this.policy.mode === 'DISABLED') return { status: 'deterministic', reason: 'AI_DISABLED' }
    if (this.active >= this.policy.maxConcurrent)
      return { status: 'rejected', reason: 'CONCURRENCY_BUDGET' }
    let minimized: ReturnType<typeof minimizeRequest<C>>
    try {
      minimized = minimizeRequest(request)
    } catch {
      return { status: 'rejected', reason: 'INPUT_OVERFLOW' }
    }
    this.active++
    const generation = crypto.randomUUID()
    try {
      this.generations.set(request.traceId, generation)
      const local = this.providers.filter((provider) => provider.locality === 'local')
      const remote = this.providers.filter((provider) => provider.locality === 'remote')
      const candidates = (
        this.policy.mode === 'LOCAL_ONLY'
          ? local
          : this.policy.mode === 'CUSTOM_ONLY'
            ? this.providers.filter((provider) => provider.modelClass === 'CUSTOM')
            : this.policy.mode === 'LOCAL_REMOTE_FALLBACK' || this.policy.mode === 'PREFER_LOCAL'
              ? [...local, ...remote]
              : this.policy.mode === 'REMOTE_LOCAL_FALLBACK'
                ? [...remote, ...local]
                : local
      ).slice(0, Math.max(0, request.budget.maxCalls))
      let reason = 'MODEL_UNAVAILABLE'
      for (const provider of candidates) {
        if (
          signal.aborted ||
          this.generations.get(request.traceId) !== generation ||
          !this.isCurrent(request.sourceFingerprint)
        )
          return { status: 'rejected', reason: 'STALE_RESULT' }
        if (
          !provider.capabilities().includes(request.capability) ||
          !privacyAllowed(request, provider, this.policy)
        )
          continue
        const started = performance.now()
        let outputChars = 0
        let modelId: string | undefined
        try {
          const providerController = new AbortController()
          let timer: ReturnType<typeof setTimeout> | undefined
          let onAbort: (() => void) | undefined
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error('TIMEOUT'))
              providerController.abort()
            }, request.budget.latencyMs)
            onAbort = () => {
              reject(new Error('CANCELLED'))
              providerController.abort()
            }
            signal.addEventListener('abort', onAbort, { once: true })
          })
          const operation = async () => {
            if (!(await provider.available())) throw new Error('MODEL_UNAVAILABLE')
            if (signal.aborted || providerController.signal.aborted) throw new Error('CANCELLED')
            return provider.infer(minimized.request, providerController.signal)
          }
          const result = await Promise.race([operation(), timeout]).finally(() => {
            if (timer) clearTimeout(timer)
            if (onAbort) signal.removeEventListener('abort', onAbort)
          })
          outputChars = result.outputChars
          modelId = result.modelId
          if (
            signal.aborted ||
            this.generations.get(request.traceId) !== generation ||
            !this.isCurrent(request.sourceFingerprint)
          )
            throw new Error('STALE_RESULT')
          let valid: ReturnType<typeof validateOutput<C>>
          let sourceIdsRepaired = false
          try {
            valid = validateOutput(minimized.request, result.text)
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !['UNKNOWN_SOURCE', 'EVIDENCE_REQUIRED'].includes(error.message)
            )
              throw error
            const canonicalized = canonicalizePairSourceIds(minimized.request, result.text)
            if (!canonicalized) throw error
            valid = validateOutput(minimized.request, canonicalized)
            sourceIdsRepaired = true
          }
          let decision: ReturnType<typeof evaluateRelationship> | undefined
          let rawRelation: string | undefined
          if (request.capability === 'compareContextCandidates') {
            const pair = minimized.request.input as {
              left: Parameters<typeof evaluateRelationship>[0]
              right: Parameters<typeof evaluateRelationship>[1]
            }
            const value = valid.value as { relation: Parameters<typeof evaluateRelationship>[2] }
            rawRelation = value.relation
            decision = evaluateRelationship(pair.left, pair.right, value.relation, valid.confidence)
            value.relation = decision.relation
          }
          const diagnostic: IntelligenceDiagnostic = {
            traceId: request.traceId,
            capability: request.capability,
            providerId: provider.id,
            modelId,
            latencyMs: Math.round(performance.now() - started),
            success: true,
            inputChars: minimized.report.inputChars,
            outputChars,
            confidence: valid.confidence,
            policyConfidence: decision?.calibratedConfidence,
            fallback: provider !== candidates[0],
            context: minimized.report,
            rawRelation,
            policyRelation: decision?.relation,
            positiveEvidence: decision?.positiveEvidence,
            negativeEvidence: decision?.negativeEvidence,
            sourceIdsRepaired,
            reason: decision?.reason,
          }
          this.pushDiagnostic(diagnostic)
          return {
            status: 'proposal',
            proposal: {
              capability: request.capability,
              value: valid.value,
              confidence: valid.confidence,
              evidenceClass: 'MODEL_INFERENCE',
              sourceIds: valid.sourceIds,
              traceId: request.traceId,
              sourceFingerprint: request.sourceFingerprint,
              providerId: provider.id,
              modelId: result.modelId,
            },
            route: provider.locality,
          }
        } catch (error) {
          reason = error instanceof Error ? error.message : 'PROVIDER_FAILURE'
          this.pushDiagnostic({
            traceId: request.traceId,
            capability: request.capability,
            providerId: provider.id,
            modelId,
            latencyMs: Math.round(performance.now() - started),
            success: false,
            reason,
            inputChars: minimized.report.inputChars,
            outputChars,
            fallback: provider !== candidates[0],
            context: minimized.report,
          })
          if (reason === 'STALE_RESULT' || reason === 'CANCELLED')
            return { status: 'rejected', reason }
        }
      }
      return { status: request.fallback === 'DETERMINISTIC' ? 'deterministic' : 'unknown', reason }
    } finally {
      this.active--
      if (this.generations.get(request.traceId) === generation)
        this.generations.delete(request.traceId)
    }
  }
  private pushDiagnostic(value: IntelligenceDiagnostic): void {
    this.diagnostics.push(value)
    if (this.diagnostics.length > 100) this.diagnostics.shift()
  }
}

export function intelligenceRequest<C extends Capability>(
  capability: C,
  input: IntelligenceRequest<C>['input'],
  privacy: IntelligenceRequest<C>['privacy'],
  sourceFingerprint: string,
  options: Partial<
    Pick<IntelligenceRequest<C>, 'budget' | 'minConfidence' | 'fallback' | 'traceId'>
  > = {},
): IntelligenceRequest<C> {
  return {
    capability,
    input,
    outputSchema: { capability, version: 1 },
    privacy,
    budget: options.budget || {
      latencyMs: 12_000,
      maxInputChars: 4000,
      maxOutputChars: 2000,
      maxContextItems: 6,
      maxCalls: 4,
    },
    minConfidence: options.minConfidence ?? 0.65,
    fallback: options.fallback || 'DETERMINISTIC',
    traceId: options.traceId || crypto.randomUUID(),
    sourceFingerprint,
  }
}
