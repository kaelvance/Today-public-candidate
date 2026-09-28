import type {
  MailProvider,
  ConnectionState,
  ProviderCapabilities,
  ProviderPage,
  SyncCursor,
} from '../ports/providers'
import type { Item } from '../types'

/** Gmail's adapter and browser transport are loaded after the cached Today view mounts. */
export class LazyGmailProvider implements MailProvider {
  readonly id = 'mail.gmail'
  private loaded?: Promise<MailProvider>
  private provider(): Promise<MailProvider> {
    this.loaded ||= Promise.all([import('./gmail-shell'), import('./gmail-gateway')]).then(
      ([adapter, gateway]) => new adapter.GmailAdapterShell(new gateway.BrowserGmailGateway()),
    )
    return this.loaded
  }
  capabilities(): ProviderCapabilities {
    return { read: true, incrementalSync: true, write: false }
  }
  async connectionState(): Promise<ConnectionState> {
    return (await this.provider()).connectionState()
  }
  async connect(): Promise<{ url: string }> {
    return (await this.provider()).connect()
  }
  async disconnect(): Promise<{ revoked: boolean }> {
    return (await this.provider()).disconnect()
  }
  async fetchChanges(cursor?: SyncCursor): Promise<ProviderPage> {
    return (await this.provider()).fetchChanges(cursor)
  }
  async fetchMessage(id: string): Promise<Item | null> {
    return (await this.provider()).fetchMessage(id)
  }
}
