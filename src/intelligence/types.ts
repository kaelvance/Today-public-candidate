export const capabilities = [
  'interpretInput',
  'extractFacts',
  'classifyItem',
  'compareContextCandidates',
  'resolveAmbiguity',
  'summarizeContext',
  'extractTemporalInformation',
] as const
export type Capability = (typeof capabilities)[number]
export type PrivacyClass =
  | 'PUBLIC'
  | 'LOCAL_PRIVATE'
  | 'CONNECTED_SERVICE_DATA'
  | 'SENSITIVE_CONTEXT'
export type IntelligenceMode =
  | 'DISABLED'
  | 'LOCAL_ONLY'
  | 'PREFER_LOCAL'
  | 'LOCAL_REMOTE_FALLBACK'
  | 'REMOTE_LOCAL_FALLBACK'
  | 'CUSTOM_ONLY'
export type ModelClass = 'LOCAL_FAST' | 'LOCAL_BALANCED' | 'EXTERNAL_REASONING' | 'CUSTOM'
export type RelationLabel =
  | 'SAME_CONTEXT'
  | 'RELATED'
  | 'POSSIBLY_RELATED'
  | 'UNRELATED'
  | 'CONFLICTING'
  | 'UNKNOWN'
export type Classification = 'ACTIONABLE' | 'CONTEXTUAL' | 'INFORMATIONAL' | 'IGNORE'

export interface EvidenceItem {
  id: string
  title: string
  description?: string
  sourceId?: string
  date?: string
  eventId?: string
  conversationId?: string
}
export interface CapabilityInputs {
  interpretInput: { text: string; localTime: string; timeZone: string }
  extractFacts: { items: EvidenceItem[] }
  classifyItem: { item: EvidenceItem }
  compareContextCandidates: { left: EvidenceItem; right: EvidenceItem }
  resolveAmbiguity: { question: string; options: string[]; items: EvidenceItem[] }
  summarizeContext: { items: EvidenceItem[] }
  extractTemporalInformation: { text: string; localTime: string; timeZone: string }
}
export interface ProposalPayloads {
  interpretInput: { title: string; kind: 'task' | 'event'; date: string | null }
  extractFacts: {
    facts: Array<{
      field:
        | 'DATE'
        | 'TIME'
        | 'LOCATION'
        | 'PERSON'
        | 'ORGANIZATION'
        | 'DEADLINE'
        | 'REQUIREMENT'
        | 'INSTRUCTION'
        | 'STATUS'
        | 'EVENT_CHANGE'
      value: string
      sourceId: string
    }>
  }
  classifyItem: { classification: Classification }
  compareContextCandidates: { relation: RelationLabel; evidence: string[]; conflicts: string[] }
  resolveAmbiguity: { selected: string | null; evidence: string[] }
  summarizeContext: { summary: string; sourceIds: string[] }
  extractTemporalInformation: { expressions: Array<{ text: string; iso: string | null }> }
}
export interface IntelligenceRequest<C extends Capability = Capability> {
  capability: C
  input: CapabilityInputs[C]
  outputSchema: { capability: C; version: 1 }
  privacy: PrivacyClass
  budget: {
    latencyMs: number
    maxInputChars: number
    maxOutputChars: number
    maxContextItems: number
    maxCalls: number
  }
  minConfidence: number
  fallback: 'DETERMINISTIC' | 'UNKNOWN'
  traceId: string
  sourceFingerprint: string
}
export interface RawModelOutput {
  text: string
  modelId: string
  outputChars: number
}
export interface IntelligenceProvider {
  readonly id: string
  readonly locality: 'local' | 'remote'
  readonly modelClass: ModelClass
  capabilities(): readonly Capability[]
  available(): Promise<boolean>
  infer<C extends Capability>(
    request: IntelligenceRequest<C>,
    signal: AbortSignal,
  ): Promise<RawModelOutput>
}
export interface ModelProvider {
  readonly id: string
  readonly locality: 'local' | 'remote'
  available?(): Promise<boolean>
  complete(
    input: {
      modelId: string
      messages: PromptMessage[]
      maxOutputChars: number
      privacy?: PrivacyClass
    },
    signal: AbortSignal,
  ): Promise<string>
}
export interface PromptMessage {
  role: 'system' | 'user'
  content: string
}
export interface ValidatedProposal<C extends Capability = Capability> {
  capability: C
  value: ProposalPayloads[C]
  confidence: number
  evidenceClass: 'MODEL_INFERENCE'
  sourceIds: string[]
  traceId: string
  sourceFingerprint: string
  providerId: string
  modelId: string
}
export type RouteResult<C extends Capability> =
  | { status: 'proposal'; proposal: ValidatedProposal<C>; route: 'local' | 'remote' }
  | { status: 'deterministic' | 'unknown' | 'rejected'; reason: string }
export interface IntelligencePolicy {
  mode: IntelligenceMode
  remoteEnabled: boolean
  localPrivateRemoteConsent: boolean
  connectedServiceRemoteConsent: boolean
  sensitiveRemoteConsent: boolean
  maxConcurrent: number
  maxMemoryMiB: number
}
export const defaultPolicy: IntelligencePolicy = {
  mode: 'LOCAL_ONLY',
  remoteEnabled: false,
  localPrivateRemoteConsent: false,
  connectedServiceRemoteConsent: false,
  sensitiveRemoteConsent: false,
  maxConcurrent: 1,
  maxMemoryMiB: 2048,
}
