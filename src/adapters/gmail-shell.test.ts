import { describe, expect, it, vi } from 'vitest'
import { GmailAdapterShell, type GmailGateway } from './gmail-shell'
import type { ConnectionState } from '../ports/providers'

const connected: ConnectionState = { state: 'CONNECTED', configured: true }
const gateway = (overrides: Partial<GmailGateway> = {}): GmailGateway => ({
  connectionState: async () => connected,
  authorizationUrl: async () => 'https://example.test/authorize',
  revoke: async () => ({ revoked: true }),
  listMetadata: async () => ({
    messages: [
      { id: 'irrelevant', subject: 'Newsletter', snippet: 'Weekly recap' },
      {
        id: 'meeting',
        subject: 'Meeting moved',
        snippet: '09:30',
        receivedAt: '2026-09-25T00:00:00Z',
      },
    ],
    nextCursor: 'opaque-history-2',
  }),
  getRelevantMessage: async (id) => ({
    id,
    subject: 'Meeting moved',
    body: 'Meeting moved to 09:30.',
    receivedAt: '2026-09-25T00:00:00Z',
  }),
  ...overrides,
})

describe('Gmail adapter seam', () => {
  it('is visibly unconfigured without a gateway', async () => {
    const adapter = new GmailAdapterShell()
    expect(await adapter.connectionState()).toMatchObject({
      state: 'UNCONFIGURED',
      configured: false,
    })
    await expect(adapter.fetchChanges()).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' })
  })
  it('fetches metadata first and content only for a relevant message, returning canonical items', async () => {
    const getRelevantMessage = vi.fn(gateway().getRelevantMessage)
    const adapter = new GmailAdapterShell(gateway({ getRelevantMessage }))
    const page = await adapter.fetchChanges({
      opaque: 'opaque-history-1',
      updatedAt: '2026-09-24T00:00:00Z',
    })
    expect(getRelevantMessage).toHaveBeenCalledExactlyOnceWith('meeting')
    expect(page.cursor?.opaque).toBe('opaque-history-2')
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'mail.gmail:meeting',
      sourceId: 'mail.gmail',
      kind: 'email',
    })
    expect(JSON.stringify(page.items)).not.toContain('Newsletter')
  })
  it.each([
    [401, 'AUTH_EXPIRED'],
    [403, 'PERMISSION_DENIED'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const adapter = new GmailAdapterShell(
      gateway({
        listMetadata: async () => {
          throw { status }
        },
      }),
    )
    await expect(adapter.fetchChanges()).rejects.toMatchObject({ code })
  })
})
