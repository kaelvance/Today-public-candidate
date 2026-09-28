import type {
  ConnectionState,
  MailProvider,
  ProviderCapabilities,
  ProviderPage,
  SyncCursor,
} from '../ports/providers'
import { ProviderFailure } from '../ports/providers'
import type { Item } from '../types'

/** Sanitized gateway shapes terminate here; no Gmail API object reaches the domain. */
export interface GmailMetadata {
  id: string
  threadId?: string
  subject?: string
  sender?: string
  snippet?: string
  receivedAt?: string
  labels?: string[]
}
export interface GmailMessage extends GmailMetadata {
  body?: string
}
export interface GmailMetadataPage {
  messages: GmailMetadata[]
  nextCursor?: string
  deletedIds?: string[]
  reset?: boolean
  truncated?: boolean
  examined?: number
}
export interface GmailGateway {
  connectionState(): Promise<ConnectionState>
  authorizationUrl(): Promise<string>
  revoke(): Promise<{ revoked: boolean }>
  listMetadata(cursor?: string): Promise<GmailMetadataPage>
  getRelevantMessage(id: string): Promise<GmailMessage>
}
export function classifyMail(
  value: GmailMetadata,
): 'ACTIONABLE' | 'CONTEXTUAL' | 'INFORMATIONAL' | 'IGNORE' {
  const subject = value.subject || ''
  const snippet = value.snippet || ''
  const labels = value.labels || []
  const action = /deadline|due|submit|reply|confirm|bring|準備|提出|締切|確認|返信|持ち物/i
  const context =
    /meeting|schedule|appointment|class|lesson|practice|reschedul|変更|集合|実習|授業|予定|会議|予約|講義/i
  const age = value.receivedAt ? Date.now() - new Date(value.receivedAt).getTime() : Infinity
  let score =
    (action.test(subject) || context.test(subject) ? 2 : 0) +
    (action.test(snippet) || context.test(snippet) ? 1 : 0)
  if (labels.includes('IMPORTANT') || labels.includes('STARRED')) score += 1
  if (/@(?:.*\.)?(?:edu|ac\.jp)\b/i.test(value.sender || '')) score += 1
  if (Number.isFinite(age) && age < 7 * 86_400_000) score += 0.5
  if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('SPAM') || labels.includes('TRASH'))
    score -= 3
  if (score < 2) return 'IGNORE'
  if (action.test(`${subject} ${snippet}`)) return 'ACTIONABLE'
  if (context.test(`${subject} ${snippet}`)) return 'CONTEXTUAL'
  return 'INFORMATIONAL'
}
const code = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0
  return message === 'not_connected'
    ? 'AUTH_REQUIRED'
    : message === 'auth_expired' || status === 401
      ? 'AUTH_EXPIRED'
      : message === 'permission_denied' || status === 403
        ? 'PERMISSION_DENIED'
        : message === 'rate_limited' || status === 429
          ? 'RATE_LIMITED'
          : message === 'invalid_provider_response'
            ? 'INVALID_RESPONSE'
            : message === 'sync_limited'
              ? 'SYNC_CURSOR_INVALID'
              : message === 'not_configured'
                ? 'CONFIGURATION_MISSING'
                : message === 'network_unavailable'
                  ? 'NETWORK_UNAVAILABLE'
                  : status >= 500
                    ? 'PROVIDER_UNAVAILABLE'
                    : 'NETWORK_UNAVAILABLE'
}
export function normalizeGmailMessage(
  value: GmailMessage,
  observedAt = new Date().toISOString(),
): Item {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.subject !== 'string' ||
    !value.subject.trim()
  )
    throw new ProviderFailure('INVALID_RESPONSE')
  const received =
    typeof value.receivedAt === 'string' && Number.isFinite(new Date(value.receivedAt).getTime())
      ? new Date(value.receivedAt).toISOString()
      : observedAt
  return {
    id: `mail.gmail:${value.id.slice(0, 120)}`,
    externalId: value.id.slice(0, 120),
    conversationId: value.threadId?.slice(0, 120),
    observedAt,
    extractionMethod: 'DIRECT',
    mailClassification: classifyMail(value),
    kind: 'email',
    title: value.subject.trim().slice(0, 200),
    description:
      typeof value.body === 'string'
        ? value.body.slice(0, 2000)
        : (value.snippet || '').slice(0, 500),
    source: 'Gmail',
    sourceId: 'mail.gmail',
    createdAt: received,
    importance: 2,
    pinned: false,
    requiresAction: classifyMail(value) === 'ACTIONABLE',
    confidence: 'medium',
    status: 'active',
    syncStatus: 'synced',
    lastUpdated: observedAt,
    sourceUpdatedAt: received,
    demo: false,
    actions: [
      {
        id: 'view',
        label: '詳細を見る',
        type: 'view',
        riskLevel: 0,
        requiresConfirmation: false,
        plugin: 'mail.gmail',
      },
    ],
  }
}
export class GmailAdapterShell implements MailProvider {
  readonly id = 'mail.gmail'
  constructor(private readonly gateway?: GmailGateway) {}
  capabilities(): ProviderCapabilities {
    return { read: !!this.gateway, incrementalSync: true, write: false }
  }
  async connectionState(): Promise<ConnectionState> {
    if (!this.gateway)
      return { state: 'UNCONFIGURED', configured: false, failure: 'CONFIGURATION_MISSING' }
    try {
      return await this.gateway.connectionState()
    } catch (error) {
      throw new ProviderFailure(code(error))
    }
  }
  async connect(): Promise<{ url: string }> {
    if (!this.gateway) throw new ProviderFailure('CONFIGURATION_MISSING')
    try {
      return { url: await this.gateway.authorizationUrl() }
    } catch (error) {
      throw new ProviderFailure(code(error))
    }
  }
  async disconnect(): Promise<{ revoked: boolean }> {
    if (!this.gateway) return { revoked: false }
    try {
      return await this.gateway.revoke()
    } catch (error) {
      throw new ProviderFailure(code(error))
    }
  }
  async fetchChanges(cursor?: SyncCursor): Promise<ProviderPage> {
    if (!this.gateway) throw new ProviderFailure('CONFIGURATION_MISSING')
    try {
      const page = await this.gateway.listMetadata(cursor?.opaque)
      if (!Array.isArray(page.messages)) throw new ProviderFailure('INVALID_RESPONSE')
      if (
        page.messages.some(
          (entry) =>
            !entry ||
            typeof entry.id !== 'string' ||
            !entry.id ||
            typeof entry.subject !== 'string',
        ) ||
        (page.deletedIds !== undefined &&
          (!Array.isArray(page.deletedIds) || page.deletedIds.some((id) => typeof id !== 'string')))
      )
        throw new ProviderFailure('INVALID_RESPONSE')
      if (
        page.nextCursor !== undefined &&
        (typeof page.nextCursor !== 'string' || page.nextCursor.length > 500)
      )
        throw new ProviderFailure('INVALID_RESPONSE')
      const candidates = page.messages.filter((entry) => classifyMail(entry) !== 'IGNORE')
      const unique = [...new Map(candidates.map((entry) => [entry.id, entry])).values()]
      const selected = page.reset ? unique.slice(0, 20) : unique
      const messages = await Promise.all(
        selected.map((entry) => this.gateway!.getRelevantMessage(entry.id)),
      )
      const fetchedAt = new Date().toISOString()
      return {
        items: messages.map((message) => normalizeGmailMessage(message, fetchedAt)),
        fetchedAt,
        cursor: page.nextCursor ? { opaque: page.nextCursor, updatedAt: fetchedAt } : cursor,
        deletedExternalIds: [
          ...new Set([
            ...(page.deletedIds || []),
            ...page.messages
              .filter((entry) => classifyMail(entry) === 'IGNORE')
              .map((entry) => entry.id),
          ]),
        ],
        reset: page.reset === true,
        truncated: page.truncated || (page.reset === true && unique.length > 20),
        examined: page.examined ?? page.messages.length,
        accepted: messages.length,
      }
    } catch (error) {
      if (error instanceof ProviderFailure) throw error
      throw new ProviderFailure(code(error))
    }
  }
  async fetchMessage(id: string): Promise<Item | null> {
    if (!this.gateway) throw new ProviderFailure('CONFIGURATION_MISSING')
    try {
      return normalizeGmailMessage(await this.gateway.getRelevantMessage(id))
    } catch (error) {
      if (error instanceof ProviderFailure) throw error
      throw new ProviderFailure(code(error))
    }
  }
}
