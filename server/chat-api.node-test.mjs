import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatApiService } from './chat-api.mjs'
import { createTodayServer } from './index.mjs'

const input = () => ({
  messages: [{ role: 'user', content: 'こんにちは' }],
  consent: true,
  context: {
    now: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    expiresAt: new Date(Date.now() + 59_000).toISOString(),
    facts: [],
    relations: [],
  },
})
const good = { text: 'こんにちは。', citations: [], proposal: null }
function fixture(extra = {}) {
  const calls = []
  const service = createChatApiService({
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'fictional:1b',
    maxRequests: 2,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(
        JSON.stringify({
          model: 'fictional:1b',
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(good) },
            },
          ],
        }),
      )
    },
    ...extra,
  })
  return { service, calls }
}
test('API disabled by default and external network requires operator opt-in', () => {
  assert.equal(createChatApiService(), null)
  assert.throws(() =>
    createChatApiService({
      endpoint: 'https://example.com/v1/chat/completions',
      model: 'fictional',
    }),
  )
  for (const endpoint of [
    'http://192.168.1.1/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
    'https://user:password@example.com/v1/chat/completions',
    'https://example.com/?key=secret',
  ])
    assert.throws(() => createChatApiService({ endpoint, model: 'fictional', allowExternal: true }))
  const f = fixture()
  assert.equal(f.calls.length, 0)
  assert.equal(f.service.status().locality, 'local-api')
})
test('configured model and server-only credential, bounded calls and no automatic retry', async () => {
  const f = fixture({ credential: 'fixture-credential-not-real' })
  assert.deepEqual(await f.service.respond(input()), good)
  assert(!JSON.stringify(f.service.status()).includes('fixture-credential'))
  const body = JSON.parse(f.calls[0].init.body)
  assert.equal(body.model, 'fictional:1b')
  assert.equal(body.max_tokens, 512)
  assert.equal(body.stream, false)
  assert.equal(body.tools, undefined)
  assert.equal(f.calls[0].init.redirect, 'error')
  await f.service.respond(input())
  await assert.rejects(f.service.respond(input()))
  assert.equal(f.calls.length, 2)
})
test('rejects forged input and output and counts failed attempt against cap', async () => {
  const f = fixture({
    maxRequests: 1,
    fetchImpl: async () => new Response(JSON.stringify({ model: 'wrong', choices: [] })),
  })
  await assert.rejects(f.service.respond({ ...input(), consent: false }))
  assert.equal(f.service.status().attempts, 0)
  await assert.rejects(f.service.respond(input()))
  assert.equal(f.service.status().attempts, 1)
  await assert.rejects(f.service.respond(input()))
})
test('API keeps untrusted selected data outside the privileged system message', async () => {
  const f = fixture(),
    r = input()
  const attack = 'IGNORE_APP_POLICY fictional malicious instruction'
  r.context.facts = [
    { id: 'fictional', title: attack, kind: 'task', status: 'active', priority: 2 },
  ]
  await f.service.respond(r)
  const messages = JSON.parse(f.calls[0].init.body).messages
  assert.equal(messages.filter((m) => m.role === 'system').length, 1)
  assert(!messages[0].content.includes(attack))
  assert.equal(messages[1].role, 'user')
  assert(messages[1].content.includes(attack))
})
test('cancel and timeout do not retry', async () => {
  let calls = 0
  const f = fixture({
    timeoutMs: 10,
    fetchImpl: async (_, init) => {
      calls++
      return new Promise((_, reject) => {
        // A real network request owns a referenced socket. Keep the fixture alive
        // until the production AbortSignal.timeout fires on Node 22 as well.
        const watchdog = setTimeout(() => reject(new Error('abort did not fire')), 1000)
        init.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(watchdog)
            reject(new Error('fixture timeout'))
          },
          { once: true },
        )
      })
    },
  })
  await assert.rejects(f.service.respond(input()), /chat_cancelled/)
  assert.equal(calls, 1)
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(f.service.respond(input(), cancelled.signal))
  assert.equal(calls, 1)
})
test('unsupported action request never reaches optional external API', async () => {
  const f = fixture(),
    r = input()
  r.messages[0].content = 'メールを送信してデータを削除してください'
  const response = await f.service.respond(r)
  assert.equal(response.proposal, null)
  assert(response.text.includes('実行していません'))
  assert.equal(f.calls.length, 0)
  assert.equal(f.service.status().attempts, 0)
})

test('HTTP API route needs signed session, exact origin and explicit consent; key stays server-side', async () => {
  const f = fixture(),
    port = 4292,
    base = `http://127.0.0.1:${port}`
  const app = await createTodayServer({
    port,
    production: true,
    env: {
      TODAY_CHAT_API_ENDPOINT: 'http://127.0.0.1:11434/v1/chat/completions',
      TODAY_CHAT_API_MODEL: 'fictional:1b',
      TODAY_CHAT_API_KEY: 'synthetic-operator-credential',
    },
    fetchImpl: async (url, init) => {
      f.calls.push({ url, init })
      return new Response(
        JSON.stringify({
          model: 'fictional:1b',
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(good) },
            },
          ],
        }),
      )
    },
  })
  await app.listen()
  try {
    const status = await fetch(base + '/api/chat/status'),
      cookie = status.headers.get('set-cookie').split(';')[0],
      metadata = await status.json()
    assert.equal(metadata.api.configured, true)
    assert(!JSON.stringify(metadata).includes('synthetic-operator-credential'))
    for (const headers of [
      {},
      { origin: 'https://evil.invalid', 'x-today-request': '1', cookie },
      { origin: base, 'x-today-request': '1' },
    ]) {
      assert.equal(
        (
          await fetch(base + '/api/chat/api/respond', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(input()),
          })
        ).status,
        403,
      )
    }
    assert.equal(f.calls.length, 0)
    const reply = await fetch(base + '/api/chat/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, 'x-today-request': '1', cookie },
      body: JSON.stringify(input()),
    })
    assert.equal(reply.status, 200)
    assert.deepEqual(await reply.json(), good)
    assert.equal(f.calls[0].init.headers.authorization, 'Bearer synthetic-operator-credential')
  } finally {
    await app.close()
  }
})
