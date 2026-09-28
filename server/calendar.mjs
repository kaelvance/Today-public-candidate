import { boundedJson } from './security.mjs'
import { createHash, randomBytes } from 'node:crypto'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export function calendarWindow(now = new Date()) {
  return {
    timeMin: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    timeMax: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
  }
}

export function createAuthorization(clientId, redirectUri) {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const url = new URL(OAUTH_URL)
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(key, value)
  return { state, verifier, url: url.toString() }
}

async function jsonResponse(response) {
  try {
    return await boundedJson(response, 'invalid_provider_response', 4 * 1024 * 1024)
  } catch {
    throw new Error('invalid_provider_response')
  }
}

export function createCalendarService({
  clientId,
  clientSecret,
  redirectUri,
  store,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const request = (url, options = {}) =>
    fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) })
  const form = (values) => new URLSearchParams(values)

  async function exchange(code, verifier) {
    const response = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
      }),
    })
    const token = await jsonResponse(response)
    if (
      !response.ok ||
      typeof token.access_token !== 'string' ||
      typeof token.refresh_token !== 'string' ||
      !String(token.scope).split(' ').includes(CALENDAR_SCOPE)
    )
      throw new Error('token_exchange_failed')
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: now().getTime() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
      expired: false,
    }
  }

  async function refresh(sessionId, record) {
    let response
    try {
      response = await request(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: record.refreshToken,
          grant_type: 'refresh_token',
        }),
      })
    } catch {
      throw new Error('provider_unavailable')
    }
    const token = await jsonResponse(response)
    if (!response.ok || typeof token.access_token !== 'string') {
      if (token.error === 'invalid_grant' || response.status === 401) {
        await store.update(sessionId, { expired: true })
        throw new Error('auth_expired')
      }
      throw new Error('provider_unavailable')
    }
    const next = {
      ...record,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || record.refreshToken,
      expiresAt: now().getTime() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    }
    await store.update(sessionId, next)
    return next
  }

  async function events(sessionId) {
    let record = await store.get(sessionId)
    if (!record) throw new Error('not_connected')
    if (record.expired) throw new Error('auth_expired')
    if (record.expiresAt < now().getTime() + 60_000) record = await refresh(sessionId, record)
    const window = calendarWindow(now())
    const collected = new Map()
    let pageToken = ''
    for (let page = 0; page < 3; page += 1) {
      const url = new URL(EVENTS_URL)
      for (const [key, value] of Object.entries({
        ...window,
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
        maxResults: '250',
        fields: 'nextPageToken,items(id,status,summary,start,end,created,updated)',
        ...(pageToken ? { pageToken } : {}),
      }))
        url.searchParams.set(key, value)
      let response
      try {
        response = await request(url, {
          headers: { authorization: `Bearer ${record.accessToken}` },
        })
      } catch {
        throw new Error('provider_unavailable')
      }
      if (response.status === 401 && page === 0) {
        record = await refresh(sessionId, record)
        try {
          response = await request(url, {
            headers: { authorization: `Bearer ${record.accessToken}` },
          })
        } catch {
          throw new Error('provider_unavailable')
        }
      }
      if (response.status === 401) {
        await store.update(sessionId, { expired: true })
        throw new Error('auth_expired')
      }
      if (!response.ok) throw new Error('provider_unavailable')
      const body = await jsonResponse(response)
      if (!Array.isArray(body.items)) throw new Error('invalid_provider_response')
      for (const item of body.items) {
        if (!item || typeof item.id !== 'string' || item.status === 'cancelled') continue
        collected.set(item.id, {
          id: item.id,
          status: item.status,
          summary: item.summary,
          start: item.start,
          end: item.end,
          created: item.created,
          updated: item.updated,
        })
      }
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : ''
      if (!pageToken) break
    }
    return {
      events: [...collected.values()],
      fetchedAt: now().toISOString(),
      truncated: !!pageToken,
    }
  }

  async function disconnect(sessionId) {
    const record = await store.get(sessionId)
    await store.update(sessionId, null)
    if (!record?.refreshToken) return { revoked: true }
    try {
      const response = await request(REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ token: record.refreshToken }),
      })
      return { revoked: response.ok }
    } catch {
      return { revoked: false }
    }
  }

  return { exchange, events, disconnect }
}
