import type { GmailGateway, GmailMessage, GmailMetadataPage } from './gmail-shell'

async function request<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: method === 'POST' ? { 'x-today-request': '1' } : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const error = new Error(
      typeof body.error === 'string' ? body.error : 'provider_unavailable',
    ) as Error & { status: number }
    error.status = response.status
    throw error
  }
  return body as T
}

export class BrowserGmailGateway implements GmailGateway {
  async connectionState() {
    const status = await request<{
      configured: boolean
      connection: 'connected' | 'disconnected' | 'expired'
    }>('/api/gmail/status')
    return {
      configured: status.configured,
      state: !status.configured
        ? ('UNCONFIGURED' as const)
        : status.connection === 'connected'
          ? ('CONNECTED' as const)
          : status.connection === 'expired'
            ? ('AUTH_EXPIRED' as const)
            : ('DISCONNECTED' as const),
    }
  }
  async authorizationUrl() {
    return (await request<{ url: string }>('/api/gmail/connect', 'POST')).url
  }
  async revoke() {
    return request<{ revoked: boolean }>('/api/gmail/disconnect', 'POST')
  }
  async listMetadata(cursor?: string): Promise<GmailMetadataPage> {
    return request(`/api/gmail/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
  }
  async getRelevantMessage(id: string): Promise<GmailMessage> {
    return request(`/api/gmail/message?id=${encodeURIComponent(id)}`)
  }
}
