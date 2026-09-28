import { boundedJson } from './security.mjs'
import { createHash, randomBytes } from 'node:crypto'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const idPattern = /^[A-Za-z0-9_-]{1,120}$/
const historyPattern = /^\d{1,30}$/
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const json = async (response) => {
  try {
    return await boundedJson(response, 'invalid_provider_response', 4 * 1024 * 1024)
  } catch {
    throw new Error('invalid_provider_response')
  }
}
const keyFor = (sid) => `gmail:${sid}`

export function createGmailAuthorization(clientId, redirectUri) {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const url = new URL(AUTH_URL)
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(key, value)
  return { state, verifier, url: url.toString() }
}

export function createGmailService({
  clientId,
  clientSecret,
  redirectUri,
  store,
  fetchImpl = fetch,
  now = () => new Date(),
  sleep = delay,
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
    const body = await json(response)
    if (
      !response.ok ||
      typeof body.access_token !== 'string' ||
      typeof body.refresh_token !== 'string'
    )
      throw new Error('token_exchange_failed')
    if (
      !String(body.scope || '')
        .split(' ')
        .includes(GMAIL_SCOPE)
    )
      throw new Error('permission_denied')
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: now().getTime() + Math.max(60, Number(body.expires_in) || 3600) * 1000,
      expired: false,
    }
  }
  async function refresh(sid, record) {
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
    const body = await json(response)
    if (!response.ok || typeof body.access_token !== 'string') {
      if (body.error === 'invalid_grant' || response.status === 401) {
        await store.update(keyFor(sid), { ...record, expired: true })
        throw new Error('auth_expired')
      }
      throw new Error('provider_unavailable')
    }
    const next = {
      ...record,
      accessToken: body.access_token,
      refreshToken: body.refresh_token || record.refreshToken,
      expiresAt: now().getTime() + Math.max(60, Number(body.expires_in) || 3600) * 1000,
      expired: false,
    }
    await store.update(keyFor(sid), next)
    return next
  }
  async function api(sid, path, params = {}) {
    let record = await store.get(keyFor(sid))
    if (!record) throw new Error('not_connected')
    if (record.expired) throw new Error('auth_expired')
    if (record.expiresAt < now().getTime() + 60_000) record = await refresh(sid, record)
    const url = new URL(`${API}${path}`)
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== '')
        for (const part of Array.isArray(value) ? value : [value])
          url.searchParams.append(key, String(part))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response
      try {
        response = await request(url, {
          headers: { authorization: `Bearer ${record.accessToken}` },
        })
      } catch {
        throw new Error('network_unavailable')
      }
      if (response.status === 401 && attempt === 0) {
        record = await refresh(sid, record)
        continue
      }
      if (response.status === 401) {
        await store.update(keyFor(sid), { ...record, expired: true })
        throw new Error('auth_expired')
      }
      if (response.status === 403) {
        const body = await json(response)
        const reasons = Array.isArray(body?.error?.errors)
          ? body.error.errors.map((entry) => entry?.reason)
          : []
        if (
          reasons.some((reason) =>
            ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(reason),
          )
        ) {
          if (attempt < 2) {
            await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 300))
            continue
          }
          throw new Error('rate_limited')
        }
        throw new Error('permission_denied')
      }
      if (response.status === 404) throw new Error('gmail_not_found')
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 300))
        continue
      }
      if (response.status === 429) throw new Error('rate_limited')
      if (!response.ok) throw new Error('provider_unavailable')
      return json(response)
    }
    throw new Error('provider_unavailable')
  }
  const string = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
  function metadata(raw) {
    if (
      !raw ||
      !idPattern.test(raw.id) ||
      !idPattern.test(raw.threadId) ||
      !Array.isArray(raw.payload?.headers)
    )
      throw new Error('invalid_provider_response')
    const header = (name) =>
      string(
        raw.payload.headers.find((entry) => String(entry?.name).toLowerCase() === name)?.value,
        500,
      )
    const millis = Number(raw.internalDate)
    if (!Number.isFinite(millis) || millis <= 0) throw new Error('invalid_provider_response')
    return {
      id: raw.id,
      threadId: raw.threadId,
      subject: header('subject').slice(0, 200),
      sender: header('from').slice(0, 200),
      receivedAt: new Date(millis).toISOString(),
      snippet: string(raw.snippet, 300),
      labels: Array.isArray(raw.labelIds)
        ? raw.labelIds.filter((value) => typeof value === 'string').slice(0, 30)
        : [],
    }
  }
  function plainBody(payload, depth = 0) {
    if (!payload || depth > 4) return ''
    if (payload.mimeType === 'text/plain' && typeof payload.body?.data === 'string') {
      try {
        return Buffer.from(payload.body.data, 'base64url').toString('utf8').slice(0, 2400)
      } catch {
        return ''
      }
    }
    if (Array.isArray(payload.parts))
      for (const part of payload.parts.slice(0, 20)) {
        const body = plainBody(part, depth + 1)
        if (body) return body
      }
    return ''
  }
  async function getMetadata(sid, id) {
    if (!idPattern.test(id)) throw new Error('invalid_input')
    const raw = await api(sid, `/messages/${id}`, {
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
      fields: 'id,threadId,internalDate,snippet,labelIds,payload(headers)',
    })
    return metadata(raw)
  }
  async function getMessage(sid, id) {
    if (!idPattern.test(id)) throw new Error('invalid_input')
    const raw = await api(sid, `/messages/${id}`, { format: 'full' })
    return { ...metadata(raw), body: plainBody(raw.payload) }
  }
  async function initial(sid) {
    const profile = await api(sid, '/profile', { fields: 'historyId' })
    if (!historyPattern.test(String(profile.historyId)))
      throw new Error('invalid_provider_response')
    const ids = new Map()
    let pageToken = ''
    let truncated = false
    for (let page = 0; page < 2; page += 1) {
      const raw = await api(sid, '/messages', {
        q: 'newer_than:14d -in:spam -in:trash',
        maxResults: 50,
        pageToken: pageToken || undefined,
        fields: 'messages(id,threadId),nextPageToken',
      })
      if (raw.messages !== undefined && !Array.isArray(raw.messages))
        throw new Error('invalid_provider_response')
      for (const entry of raw.messages || []) {
        if (!idPattern.test(entry?.id)) throw new Error('invalid_provider_response')
        ids.set(entry.id, entry.id)
      }
      pageToken = string(raw.nextPageToken, 500)
      if (!pageToken) break
      if (page === 1) truncated = true
    }
    const messages = []
    for (const id of ids.values()) {
      try {
        messages.push(await getMetadata(sid, id))
      } catch (error) {
        if (error.message !== 'gmail_not_found') throw error
      }
    }
    return {
      messages,
      deletedIds: [],
      nextCursor: String(profile.historyId),
      reset: true,
      truncated,
      examined: messages.length,
    }
  }
  async function incremental(sid, cursor) {
    if (!historyPattern.test(cursor)) throw new Error('invalid_input')
    const changed = new Set()
    const deleted = new Set()
    let pageToken = ''
    let historyId = cursor
    for (let page = 0; page < 10; page += 1) {
      let raw
      try {
        raw = await api(sid, '/history', {
          startHistoryId: cursor,
          historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
          maxResults: 100,
          pageToken: pageToken || undefined,
          fields:
            'historyId,nextPageToken,history(messagesAdded(message(id)),messagesDeleted(message(id)),labelsAdded(message(id)),labelsRemoved(message(id)))',
        })
      } catch (error) {
        if (error.message === 'gmail_not_found') return initial(sid)
        throw error
      }
      if (
        (raw.history !== undefined && !Array.isArray(raw.history)) ||
        !historyPattern.test(String(raw.historyId))
      )
        throw new Error('invalid_provider_response')
      historyId = String(raw.historyId)
      for (const record of raw.history || []) {
        if (
          !record ||
          typeof record !== 'object' ||
          ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved'].some(
            (key) => record[key] !== undefined && !Array.isArray(record[key]),
          )
        )
          throw new Error('invalid_provider_response')
        for (const entry of [
          ...(record.messagesAdded || []),
          ...(record.labelsAdded || []),
          ...(record.labelsRemoved || []),
        ])
          if (idPattern.test(entry?.message?.id)) changed.add(entry.message.id)
        for (const entry of record.messagesDeleted || [])
          if (idPattern.test(entry?.message?.id)) deleted.add(entry.message.id)
      }
      pageToken = string(raw.nextPageToken, 500)
      if (!pageToken) break
      if (page === 9) throw new Error('sync_limited')
    }
    const messages = []
    if (changed.size > 200) throw new Error('sync_limited')
    for (const id of changed) {
      if (deleted.has(id)) continue
      try {
        messages.push(await getMetadata(sid, id))
      } catch (error) {
        if (error.message === 'gmail_not_found') deleted.add(id)
        else throw error
      }
    }
    return {
      messages,
      deletedIds: [...deleted],
      nextCursor: historyId,
      reset: false,
      truncated: false,
      examined: messages.length,
    }
  }
  async function disconnect(sid) {
    const record = await store.get(keyFor(sid))
    await store.update(keyFor(sid), null)
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
  return { exchange, initial, incremental, getMessage, disconnect }
}
