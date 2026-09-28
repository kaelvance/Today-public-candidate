import { describe, expect, it } from 'vitest'
import { createServer as netServer } from 'node:net'
import { createGmailService, GMAIL_SCOPE } from './gmail.mjs'
import { createTodayServer } from './index.mjs'

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const port = () =>
  new Promise((resolve) => {
    const server = netServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
const store = () => {
  const records = new Map()
  return {
    records,
    get: async (id) => records.get(id) || null,
    update: async (id, value) => {
      if (value === null) records.delete(id)
      else records.set(id, value)
    },
  }
}
const message = (id, subject = 'Meeting changed') => ({
  id,
  threadId: 'thread-one',
  internalDate: '1789700000000',
  snippet: '09:30',
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'Subject', value: subject },
      { name: 'From', value: 'Teacher <t@example.edu>' },
    ],
    body: { data: Buffer.from('Meeting moved to 09:30').toString('base64url') },
  },
})
const service = (options = {}) =>
  createGmailService({
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'http://127.0.0.1/callback',
    ...options,
  })

describe('Gmail Gateway', () => {
  it('enforces state/session and only stores a read-only credential after valid callback', async () => {
    const number = await port()
    const tokens = store()
    const app = await createTodayServer({
      port: number,
      production: true,
      store: tokens,
      env: {
        GMAIL_CLIENT_ID: 'id',
        GMAIL_CLIENT_SECRET: 'secret',
        TODAY_TOKEN_STORE: 'unused',
        TODAY_TOKEN_KEY: Buffer.alloc(32, 4).toString('base64'),
      },
      fetchImpl: async (url) =>
        String(url).includes('/token')
          ? json({ access_token: 'a', refresh_token: 'r', scope: GMAIL_SCOPE, expires_in: 3600 })
          : json({}),
    })
    await app.listen()
    try {
      const base = `http://127.0.0.1:${number}`
      const first = await fetch(`${base}/api/gmail/status`)
      const sid = first.headers
        .getSetCookie()
        .find((value) => value.startsWith('today_sid='))
        .split(';')[0]
      const denied = await fetch(`${base}/api/gmail/connect`, {
        method: 'POST',
        headers: { cookie: sid, origin: 'https://evil.example', 'x-today-request': '1' },
      })
      expect(denied.status).toBe(403)
      const connect = await fetch(`${base}/api/gmail/connect`, {
        method: 'POST',
        headers: { cookie: sid, origin: base, 'x-today-request': '1' },
      })
      const { url } = await connect.json()
      const auth = new URL(url)
      expect(auth.searchParams.get('scope')).toBe(GMAIL_SCOPE)
      expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
      const state = auth.searchParams.get('state')
      const stateCookie = connect.headers
        .getSetCookie()
        .find((value) => value.startsWith('today_gmail_oauth_state='))
        .split(';')[0]
      expect(
        (
          await fetch(`${base}/api/gmail/callback?state=wrong&code=fake`, {
            headers: { cookie: `${sid}; ${stateCookie}` },
          })
        ).status,
      ).toBe(400)
      expect(tokens.records.size).toBe(0)
      const success = await fetch(`${base}/api/gmail/callback?state=${state}&code=fake`, {
        headers: { cookie: `${sid}; ${stateCookie}` },
        redirect: 'manual',
      })
      expect(success.status).toBe(302)
      expect([...tokens.records.keys()][0]).toMatch(/^gmail:/)
      expect(
        (await (await fetch(`${base}/api/gmail/status`, { headers: { cookie: sid } })).json())
          .connection,
      ).toBe('connected')
      const retry = await fetch(`${base}/api/gmail/connect`, {
        method: 'POST',
        headers: { cookie: sid, origin: base, 'x-today-request': '1' },
      })
      const deniedAuth = new URL((await retry.json()).url)
      const retryCookie = retry.headers
        .getSetCookie()
        .find((value) => value.startsWith('today_gmail_oauth_state='))
        .split(';')[0]
      const cancelled = await fetch(
        `${base}/api/gmail/callback?state=${deniedAuth.searchParams.get('state')}&error=access_denied`,
        { headers: { cookie: `${sid}; ${retryCookie}` }, redirect: 'manual' },
      )
      expect(cancelled.headers.get('location')).toBe('/?gmail=cancelled')
      expect(tokens.records.size).toBe(1)
    } finally {
      await app.close()
    }
  })

  it('lists only two recent pages, deduplicates metadata and retrieves full content on demand', async () => {
    const tokens = store()
    await tokens.update('gmail:s', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    })
    const calls = []
    const gmail = service({
      store: tokens,
      fetchImpl: async (url) => {
        const address = new URL(url)
        calls.push(address)
        if (address.pathname.endsWith('/profile')) return json({ historyId: '12345' })
        if (address.pathname.endsWith('/messages'))
          return address.searchParams.has('pageToken')
            ? json({ messages: [{ id: 'b', threadId: 'thread-one' }] })
            : json({
                messages: [
                  { id: 'a', threadId: 'thread-one' },
                  { id: 'a', threadId: 'thread-one' },
                ],
                nextPageToken: 'next',
              })
        return json(message(address.pathname.split('/').at(-1)))
      },
    })
    const page = await gmail.initial('s')
    expect(page).toMatchObject({ nextCursor: '12345', reset: true, examined: 2 })
    expect(page.messages.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(calls.filter((entry) => entry.pathname.endsWith('/messages')).length).toBe(2)
    expect(calls.some((entry) => entry.searchParams.get('format') === 'full')).toBe(false)
    expect((await gmail.getMessage('s', 'a')).body).toBe('Meeting moved to 09:30')
    expect(calls.at(-1).searchParams.get('format')).toBe('full')
  })

  it('reads paginated history, tombstones deleted messages and recovers expired history with a bounded initial sync', async () => {
    const tokens = store()
    await tokens.update('gmail:s', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    })
    const gmail = service({
      store: tokens,
      fetchImpl: async (url) => {
        const address = new URL(url)
        if (address.pathname.endsWith('/history'))
          return address.searchParams.has('pageToken')
            ? json({
                historyId: '103',
                history: [{ messagesDeleted: [{ message: { id: 'old' } }] }],
              })
            : json({
                historyId: '102',
                nextPageToken: 'two',
                history: [{ messagesAdded: [{ message: { id: 'new' } }] }],
              })
        return json(message('new'))
      },
    })
    expect(await gmail.incremental('s', '100')).toMatchObject({
      nextCursor: '103',
      deletedIds: ['old'],
      reset: false,
      examined: 1,
    })
    const recovered = service({
      store: tokens,
      fetchImpl: async (url) => {
        const address = new URL(url)
        if (address.pathname.endsWith('/history')) return json({}, 404)
        if (address.pathname.endsWith('/profile')) return json({ historyId: '900' })
        if (address.pathname.endsWith('/messages')) return json({ messages: [] })
        return json({})
      },
    })
    expect(await recovered.incremental('s', '1')).toMatchObject({
      reset: true,
      nextCursor: '900',
      messages: [],
    })
  })

  it('refreshes expired tokens, maps invalid grants, retries 429, and removes credentials on disconnect', async () => {
    const tokens = store()
    await tokens.update('gmail:s', { accessToken: 'old', refreshToken: 'refresh', expiresAt: 0 })
    let calls = 0
    let sleeps = 0
    const gmail = service({
      store: tokens,
      sleep: async () => {
        sleeps += 1
      },
      fetchImpl: async (url) => {
        const address = new URL(url)
        if (address.pathname.endsWith('/token'))
          return json({ access_token: 'new', expires_in: 3600 })
        if (address.pathname.endsWith('/profile')) {
          calls += 1
          return calls === 1 ? json({}, 429) : json({ historyId: '200' })
        }
        if (address.pathname.endsWith('/messages')) return json({ messages: [] })
        return json({})
      },
    })
    expect((await gmail.initial('s')).nextCursor).toBe('200')
    expect(sleeps).toBe(1)
    expect((await tokens.get('gmail:s')).accessToken).toBe('new')
    expect(await gmail.disconnect('s')).toEqual({ revoked: true })
    expect(await tokens.get('gmail:s')).toBeNull()
    await tokens.update('gmail:expired', { accessToken: 'old', refreshToken: 'bad', expiresAt: 0 })
    const expired = service({
      store: tokens,
      fetchImpl: async () => json({ error: 'invalid_grant' }, 400),
    })
    await expect(expired.initial('expired')).rejects.toThrow('auth_expired')
    expect((await tokens.get('gmail:expired')).expired).toBe(true)
  })

  it('treats 403 quota reasons as retryable rate limits and rejects malformed source responses', async () => {
    const tokens = store()
    await tokens.update('gmail:s', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    })
    let calls = 0
    let sleeps = 0
    const quota = service({
      store: tokens,
      sleep: async () => {
        sleeps += 1
      },
      fetchImpl: async (url) => {
        if (new URL(url).pathname.endsWith('/profile')) {
          calls += 1
          return calls < 3
            ? json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403)
            : json({ historyId: '300' })
        }
        return json({ messages: [] })
      },
    })
    expect((await quota.initial('s')).nextCursor).toBe('300')
    expect(sleeps).toBe(2)
    const malformed = service({
      store: tokens,
      fetchImpl: async (url) =>
        new URL(url).pathname.endsWith('/profile')
          ? json({ historyId: '400' })
          : json({ messages: 'bad-shape' }),
    })
    await expect(malformed.initial('s')).rejects.toThrow('invalid_provider_response')
  })

  it('fails a broken later page without a successful sync result and keeps credentials intact', async () => {
    const tokens = store()
    const credential = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 }
    await tokens.update('gmail:s', credential)
    const interrupted = service({
      store: tokens,
      sleep: async () => {},
      fetchImpl: async (url) => {
        const address = new URL(url)
        if (address.pathname.endsWith('/profile')) return json({ historyId: '500' })
        if (address.pathname.endsWith('/messages'))
          return address.searchParams.has('pageToken')
            ? json({}, 500)
            : json({ messages: [{ id: 'one', threadId: 'thread' }], nextPageToken: 'more' })
        return json(message('one'))
      },
    })
    await expect(interrupted.initial('s')).rejects.toThrow('provider_unavailable')
    expect(await tokens.get('gmail:s')).toEqual(credential)
    const forbidden = service({
      store: tokens,
      fetchImpl: async () => json({ error: { errors: [{ reason: 'domainPolicy' }] } }, 403),
    })
    await expect(forbidden.initial('s')).rejects.toThrow('permission_denied')
    const offline = service({
      store: tokens,
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    await expect(offline.initial('s')).rejects.toThrow('network_unavailable')
  })
})
