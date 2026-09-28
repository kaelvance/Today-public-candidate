import type {
  CalendarProvider,
  ConnectionState,
  MailProvider,
  ProviderCapabilities,
  ProviderPage,
  SyncCursor,
} from '../ports/providers'
import { ProviderFailure } from '../ports/providers'
import type { Item } from '../types'

const readOnly: ProviderCapabilities = { read: true, incrementalSync: true, write: false }
export class MockCalendarProvider implements CalendarProvider {
  readonly id = 'calendar.mock'
  constructor(
    private readonly items: Item[],
    private readonly failure?: 'offline' | 'expired' | 'rate-limit' | 'invalid',
  ) {}
  capabilities() {
    return readOnly
  }
  async connectionState(): Promise<ConnectionState> {
    return {
      state:
        this.failure === 'expired'
          ? 'AUTH_EXPIRED'
          : this.failure === 'offline'
            ? 'OFFLINE'
            : 'CONNECTED',
      configured: true,
    }
  }
  async connect() {
    return { url: 'mock://calendar/connected' }
  }
  async disconnect() {
    return { revoked: true }
  }
  async fetchEvents(): Promise<ProviderPage> {
    if (this.failure)
      throw new ProviderFailure(
        this.failure === 'expired'
          ? 'AUTH_EXPIRED'
          : this.failure === 'rate-limit'
            ? 'RATE_LIMITED'
            : this.failure === 'invalid'
              ? 'INVALID_RESPONSE'
              : 'NETWORK_UNAVAILABLE',
      )
    return { items: this.items.map((item) => ({ ...item })), fetchedAt: '2026-09-25T00:00:00.000Z' }
  }
}
export class MockMailProvider implements MailProvider {
  readonly id = 'mail.mock'
  constructor(
    private readonly items: Item[],
    private readonly failure?: 'offline' | 'expired' | 'rate-limit' | 'invalid',
  ) {}
  capabilities() {
    return readOnly
  }
  async connectionState(): Promise<ConnectionState> {
    return {
      state:
        this.failure === 'expired'
          ? 'AUTH_EXPIRED'
          : this.failure === 'offline'
            ? 'OFFLINE'
            : 'CONNECTED',
      configured: true,
    }
  }
  async connect() {
    return { url: 'mock://mail/connected' }
  }
  async disconnect() {
    return { revoked: true }
  }
  async fetchChanges(cursor?: SyncCursor): Promise<ProviderPage> {
    if (this.failure)
      throw new ProviderFailure(
        this.failure === 'expired'
          ? 'AUTH_EXPIRED'
          : this.failure === 'rate-limit'
            ? 'RATE_LIMITED'
            : this.failure === 'invalid'
              ? 'INVALID_RESPONSE'
              : 'NETWORK_UNAVAILABLE',
      )
    return {
      items: this.items.map((item) => ({ ...item })),
      fetchedAt: '2026-09-25T00:00:00.000Z',
      cursor: {
        opaque: String(Number(cursor?.opaque || 0) + 1),
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
    }
  }
  async fetchMessage(id: string) {
    return this.items.find((item) => item.id === id) || null
  }
}
