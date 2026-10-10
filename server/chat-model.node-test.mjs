import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { test } from 'node:test'
import { createChatModelService, validateChatOutput, validateChatRequest } from './chat-model.mjs'
import { createTodayServer } from './index.mjs'
const digest = 'a'.repeat(64),
  model = 'fixture:4b'
const input = () => ({
  messages: [{ role: 'user', content: '架空の予定は？' }],
  consent: true,
  context: {
    now: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    expiresAt: new Date(Date.now() + 59_000).toISOString(),
    facts: [{ id: 'fixture-id', kind: 'task', title: '架空', status: 'active', priority: 2 }],
    relations: [],
  },
})
const good = { text: '架空の予定です。', citations: ['fixture-id'], proposal: null }
function fixture(output = good) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ path: url.pathname, init })
    return new Response(
      JSON.stringify(
        url.pathname === '/api/tags'
          ? { models: [{ name: model, digest }] }
          : { model, done: true, message: { role: 'assistant', content: JSON.stringify(output) } },
      ),
    )
  }
  return { calls, fetchImpl, service: createChatModelService({ model, digest, fetchImpl }) }
}
test('does not pull/load on status, fixes digest, only loopback endpoint', () => {
  const f = fixture()
  assert.equal(f.service.status().model, model)
  assert.equal(f.calls.length, 0)
  for (const endpoint of [
    'https://example.com',
    'http://localhost:11434',
    'http://192.168.0.2',
    'http://127.0.0.1/?bad',
    'http://user:pass@127.0.0.1',
  ])
    assert.throws(() => createChatModelService({ model, digest, endpoint }))
  assert.throws(() => createChatModelService({ model, digest: 'wrong' }))
})
test('uses dedicated chat contract, server-owned system prompt and no tools/fallback', async () => {
  const f = fixture()
  assert.deepEqual(await f.service.respond(input()), good)
  const body = JSON.parse(f.calls[1].init.body)
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.think, false)
  assert.equal(body.stream, false)
  assert.equal(body.keep_alive, 0)
  assert.equal(body.model, model)
  assert.equal(body.tools, undefined)
  assert.deepEqual(
    f.calls.map((c) => c.path),
    ['/api/tags', '/api/chat'],
  )
})
test('rejects input roles, missing consent, stale context, oversized text, and credentials', () => {
  for (const modify of [
    (v) => (v.messages[0].role = 'system'),
    (v) => (v.messages[0].role = 'tool'),
    (v) => (v.consent = false),
    (v) => (v.endpoint = 'evil'),
    (v) => (v.messages[0].content = 'x'.repeat(2001)),
    (v) => (v.context.expiresAt = '2000-01-01T00:00:00Z'),
    (v) => (v.context.timezone = 'Mars/Olympus'),
    (v) => (v.messages[0].content = 'api_key=syntheticsecret01234567890'),
  ]) {
    const v = input()
    modify(v)
    assert.throws(() => validateChatRequest(v))
  }
})
test('rejects poisoned output and nonselected modification targets', () => {
  for (const output of [
    { ...good, tool_calls: [] },
    { ...good, citations: ['hidden'] },
    { ...good, proposal: { type: 'delete' } },
    { ...good, proposal: { type: 'update', targetId: 'hidden', patch: { title: 'bad' } } },
    {
      ...good,
      proposal: { type: 'create', kind: 'event', title: 'bad', at: '2026-02-30T10:00:00Z' },
    },
    { ...good, proposal: { type: 'create', kind: 'task', title: 'ok', sendMail: true } },
  ])
    assert.throws(() => validateChatOutput(output, input().context))
})
test('rejects model digest mismatch before inference', async () => {
  const f = fixture()
  const service = createChatModelService({ model, digest: 'b'.repeat(64), fetchImpl: f.fetchImpl })
  await assert.rejects(service.respond(input()), /chat_model_identity/)
  assert.equal(f.calls.length, 1)
})
test('caps parallel requests, cancels late outputs, and enforces per-session rate', async () => {
  let finish
  const service = createChatModelService({
    model,
    digest,
    fetchImpl: (url) =>
      url.pathname === '/api/tags'
        ? Promise.resolve(new Response(JSON.stringify({ models: [{ name: model, digest }] })))
        : new Promise((resolve) => {
            finish = resolve
          }),
  })
  const controller = new AbortController(),
    first = service.respond(input(), controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(service.respond(input()), /chat_busy/)
  controller.abort()
  finish(
    new Response(
      JSON.stringify({
        model,
        done: true,
        message: { role: 'assistant', content: JSON.stringify(good) },
      }),
    ),
  )
  await assert.rejects(first, /chat_cancelled/)
  const f = fixture()
  for (let i = 0; i < 10; i++) await f.service.respond(input())
  await assert.rejects(f.service.respond(input()), /chat_rate_limited/)
})
test('bounds untrusted response bodies and rejects model tool calls', async () => {
  for (const data of [
    {
      model,
      done: true,
      message: { role: 'assistant', content: JSON.stringify(good), tool_calls: [{}] },
    },
    { model: 'different', done: true, message: { role: 'assistant', content: '{}' } },
    'x'.repeat(70_000),
  ]) {
    const service = createChatModelService({
      model,
      digest,
      fetchImpl: async (url) =>
        new Response(
          url.pathname === '/api/tags'
            ? JSON.stringify({ models: [{ name: model, digest }] })
            : typeof data === 'string'
              ? data
              : JSON.stringify(data),
        ),
    })
    await assert.rejects(service.respond(input()), /chat_invalid_output/)
  }
})
test('HTTP integration requires valid host/origin/request header and signed session', async () => {
  const f = fixture(),
    port = 4283,
    base = `http://127.0.0.1:${port}`,
    app = await createTodayServer({
      port,
      production: true,
      env: { TODAY_CHAT_MODEL: model, TODAY_CHAT_DIGEST: digest },
      fetchImpl: f.fetchImpl,
    })
  await app.listen()
  try {
    const status = await fetch(base + '/api/chat/status')
    assert.equal(status.status, 200)
    const cookie = status.headers.get('set-cookie').split(';')[0]
    for (const headers of [
      {},
      { origin: 'https://evil.invalid', 'x-today-request': '1' },
      { origin: base },
    ])
      assert.equal(
        (
          await fetch(base + '/api/chat/respond', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(input()),
          })
        ).status,
        403,
      )
    assert.equal(f.calls.length, 0)
    const result = await fetch(base + '/api/chat/respond', {
      method: 'POST',
      headers: { origin: base, 'x-today-request': '1', cookie, 'content-type': 'application/json' },
      body: JSON.stringify(input()),
    })
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), good)
    assert.equal(
      await new Promise((resolve, reject) => {
        const request = httpRequest(
          base + '/api/chat/status',
          { headers: { host: 'evil.invalid' } },
          (response) => {
            response.resume()
            resolve(response.statusCode)
          },
        )
        request.on('error', reject)
        request.end()
      }),
      403,
    )
  } finally {
    await app.close()
  }
})

test('rejects status plus date bundling and duplicate-name target before UI', () => {
  const context = input().context
  assert.throws(() =>
    validateChatOutput(
      {
        ...good,
        proposal: {
          type: 'update',
          targetId: 'fixture-id',
          patch: { status: 'done', at: '2026-10-11T06:00:00Z' },
        },
      },
      context,
    ),
  )
  context.facts.push({ ...context.facts[0], id: 'second' })
  assert.throws(() =>
    validateChatOutput(
      { ...good, proposal: { type: 'update', targetId: 'fixture-id', patch: { status: 'done' } } },
      context,
    ),
  )
})
