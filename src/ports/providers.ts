import type { CaptureInterpretation } from '../ai'
import type { Item } from '../types'

export type ProviderState =
  | 'UNCONFIGURED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'AUTH_EXPIRED'
  | 'OFFLINE'
  | 'ERROR'
export type FailureCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'SYNC_CURSOR_INVALID'
  | 'CONFIGURATION_MISSING'
  | 'UNKNOWN'
export class ProviderFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message = code,
  ) {
    super(message)
  }
}
export interface ProviderCapabilities {
  read: boolean
  incrementalSync: boolean
  write: boolean
  structuredOutput?: boolean
  classification?: boolean
  semanticComparison?: boolean
  summarization?: boolean
}
export interface ConnectionState {
  state: ProviderState
  configured: boolean
  failure?: FailureCode
}
export interface SyncCursor {
  opaque: string
  updatedAt: string
}
export interface ProviderPage {
  items: Item[]
  cursor?: SyncCursor
  fetchedAt: string
  truncated?: boolean
  deletedExternalIds?: string[]
  reset?: boolean
  examined?: number
  accepted?: number
}
export interface CalendarProvider {
  readonly id: string
  capabilities(): ProviderCapabilities
  connectionState(): Promise<ConnectionState>
  connect(): Promise<{ url: string }>
  disconnect(): Promise<{ revoked: boolean }>
  fetchEvents(range?: { from: string; to: string }, cursor?: SyncCursor): Promise<ProviderPage>
}
export interface MailProvider {
  readonly id: string
  capabilities(): ProviderCapabilities
  connectionState(): Promise<ConnectionState>
  connect(): Promise<{ url: string }>
  disconnect(): Promise<{ revoked: boolean }>
  fetchChanges(cursor?: SyncCursor): Promise<ProviderPage>
  fetchMessage(id: string): Promise<Item | null>
}
export interface IntelligenceProvider {
  readonly id: string
  capabilities(): ProviderCapabilities
  connectionState(): Promise<ConnectionState>
  interpretCapture(
    input: string,
    context: { localTime: string; timeZone: string },
    signal: AbortSignal,
  ): Promise<CaptureInterpretation>
  compareContextCandidates?(
    left: Item,
    right: Item,
    signal: AbortSignal,
  ): Promise<{ related: boolean; confidence: 'high' | 'medium' | 'low' }>
}
export interface Clock {
  now(): Date
}
export interface NetworkStatusProvider {
  online(): boolean
}
export interface StorageProvider<T> {
  load(): Promise<T>
  save(value: T): Promise<void>
}
export interface ProviderRegistry {
  calendar(): CalendarProvider
  mail(): MailProvider
  ai(): IntelligenceProvider
  capabilities(): Record<string, ProviderCapabilities>
  states(): Promise<Record<string, ConnectionState>>
}
export function createProviderRegistry(providers: {
  calendar: CalendarProvider
  mail: MailProvider
  ai: IntelligenceProvider
}): ProviderRegistry {
  return {
    calendar: () => providers.calendar,
    mail: () => providers.mail,
    ai: () => providers.ai,
    capabilities: () =>
      Object.fromEntries(
        Object.values(providers).map((provider) => [provider.id, provider.capabilities()]),
      ),
    states: async () =>
      Object.fromEntries(
        await Promise.all(
          Object.values(providers).map(async (provider) => [
            provider.id,
            await provider.connectionState(),
          ]),
        ),
      ),
  }
}
