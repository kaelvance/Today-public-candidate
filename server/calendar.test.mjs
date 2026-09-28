import { describe, expect, it } from 'vitest'
import { createServer as netServer } from 'node:net'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCalendarService, CALENDAR_SCOPE, calendarWindow } from './calendar.mjs'
import { createTodayServer } from './index.mjs'
import { EncryptedTokenStore } from './token-store.mjs'

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const temporaryPort = () =>
  new Promise((resolve) => {
    const server = netServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
const fakeStore = () => {
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

describe('Calendar server', () => {
  it('persists tokens encrypted and readable after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'today-token-test-'))
    const file = join(directory, 'tokens.enc')
    const key = Buffer.alloc(32, 9)
    try {
      const first = new EncryptedTokenStore(file, key)
      await first.update('session', { refreshToken: 'synthetic-private-token' })
      expect(await readFile(file, 'utf8')).not.toContain('synthetic-private-token')
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      const restarted = new EncryptedTokenStore(file, key)
      expect(await restarted.get('session')).toEqual({ refreshToken: 'synthetic-private-token' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires a matching OAuth state and browser session before storing credentials', async () => {
    const port = await temporaryPort()
    const store = fakeStore()
    const fetchImpl = async (url) =>
      String(url).includes('/token')
        ? json({
            access_token: 'fake-access',
            refresh_token: 'fake-refresh',
            expires_in: 3600,
            scope: CALENDAR_SCOPE,
          })
        : json({})
    const app = await createTodayServer({
      port,
      production: true,
      store,
      fetchImpl,
      env: {
        GOOGLE_CLIENT_ID: 'test-id',
        GOOGLE_CLIENT_SECRET: 'test-secret',
        TODAY_TOKEN_STORE: 'unused',
        TODAY_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
      },
    })
    await app.listen()
    try {
      const base = `http://127.0.0.1:${port}`
      const first = await fetch(`${base}/api/calendar/status`)
      const sid = first.headers
        .getSetCookie()
        .find((value) => value.startsWith('today_sid='))
        .split(';')[0]
      const denied = await fetch(`${base}/api/calendar/connect`, {
        method: 'POST',
        headers: { cookie: sid, origin: 'https://evil.example', 'x-today-request': '1' },
      })
      expect(denied.status).toBe(403)
      const connect = await fetch(`${base}/api/calendar/connect`, {
        method: 'POST',
        headers: { cookie: sid, origin: base, 'x-today-request': '1' },
      })
      const { url } = await connect.json()
      const authorization = new URL(url)
      expect(authorization.searchParams.get('scope')).toBe(CALENDAR_SCOPE)
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      const state = authorization.searchParams.get('state')
      const stateCookie = connect.headers
        .getSetCookie()
        .find((value) => value.startsWith('today_oauth_state='))
        .split(';')[0]
      const invalid = await fetch(`${base}/api/calendar/callback?state=wrong&code=fake`, {
        headers: { cookie: `${sid}; ${stateCookie}` },
      })
      expect(invalid.status).toBe(400)
      expect(store.records.size).toBe(0)
      const success = await fetch(`${base}/api/calendar/callback?state=${state}&code=fake`, {
        headers: { cookie: `${sid}; ${stateCookie}` },
        redirect: 'manual',
      })
      expect(success.status).toBe(302)
      expect(store.records.size).toBe(1)
      const status = await (
        await fetch(`${base}/api/calendar/status`, { headers: { cookie: sid } })
      ).json()
      expect(status.connection).toBe('connected')
    } finally {
      await app.close()
    }
  })

  it('uses a short rolling window, orders event requests, and deduplicates IDs', async () => {
    const store = fakeStore()
    await store.update('s', {
      accessToken: 'fake',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
    })
    const urls = []
    const service = createCalendarService({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1/callback',
      store,
      fetchImpl: async (url) => {
        urls.push(String(url))
        return urls.length === 1
          ? json({
              items: [{ id: 'one', summary: 'Old', start: { date: '2026-09-26' } }],
              nextPageToken: 'next',
            })
          : json({
              items: [
                { id: 'one', summary: 'New', start: { date: '2026-09-26' } },
                { id: 'cancelled', status: 'cancelled' },
              ],
            })
      },
    })
    const result = await service.events('s')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].summary).toBe('New')
    expect(urls[0]).toContain('singleEvents=true')
    expect(urls[0]).toContain('orderBy=startTime')
    const window = calendarWindow(new Date('2026-09-25T00:00:00.000Z'))
    expect(new Date(window.timeMax).getTime() - new Date(window.timeMin).getTime()).toBe(
      7 * 86_400_000 + 2 * 3_600_000,
    )
  })

  it('marks invalid refresh grants expired and leaves data available on API failure', async () => {
    const store = fakeStore()
    await store.update('expired', { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0 })
    const expiredService = createCalendarService({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1/callback',
      store,
      fetchImpl: async () => json({ error: 'invalid_grant' }, 400),
    })
    await expect(expiredService.events('expired')).rejects.toThrow('auth_expired')
    expect(await store.get('expired')).toEqual({ expired: true })
    await store.update('offline', {
      accessToken: 'valid',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
    })
    const offlineService = createCalendarService({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1/callback',
      store,
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    await expect(offlineService.events('offline')).rejects.toThrow('provider_unavailable')
    expect((await store.get('offline')).accessToken).toBe('valid')
  })

  it('disconnects its session and revokes the token', async () => {
    const store = fakeStore()
    await store.update('one', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    })
    let revoked = false
    const service = createCalendarService({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1/callback',
      store,
      fetchImpl: async (url, options) => {
        if (String(url).includes('/revoke')) revoked = String(options.body).includes('token=r')
        return json({})
      },
    })
    expect(await service.disconnect('one')).toEqual({ revoked: true })
    expect(revoked).toBe(true)
    expect(await store.get('one')).toBeNull()
  })
})
