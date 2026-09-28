import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createRemoteModelService } from './remote-model.mjs'
import { createTodayServer } from './index.mjs'

let endpoint
let http
let mode = 'normal'
let received = null
before(async () => {
  http = createServer(async (req, res) => {
    received = {
      authorization: req.headers.authorization,
      payload: JSON.parse(
        await new Promise((resolve) => {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => resolve(body))
        }),
      ),
    }
    if (mode === 'auth') {
      res.writeHead(401)
      return res.end('{}')
    }
    if (mode === 'rate') {
      res.writeHead(429)
      return res.end('{}')
    }
    if (mode === 'invalid') {
      res.writeHead(200)
      return res.end('{bad')
    }
    if (mode === 'huge') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text: 'x'.repeat(70_000) }))
    }
    if (mode === 'redirect') {
      res.writeHead(302, { location: 'https://example.com' })
      return res.end()
    }
    if (mode === 'hang') {
      await delay(100)
      if (!res.destroyed) {
        res.writeHead(200)
        res.end('{}')
      }
      return
    }
    if (mode === 'openai') {
      res.setHeader('content-type', 'application/json')
      return res.end(
        JSON.stringify({
          model: 'test-model',
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"schemaVersion":1}' },
            },
          ],
          usage: { prompt_tokens: 31, completion_tokens: 8 },
        }),
      )
    }
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        modelId: 'test-model',
        text: JSON.stringify({
          schemaVersion: 1,
          capability: 'compareContextCandidates',
          confidence: 0.8,
          sourceIds: ['a', 'b'],
          value: { relation: 'UNKNOWN', evidence: [], conflicts: [] },
        }),
        usage: { inputTokens: 25, outputTokens: 12, private: 'PRIVATE_METADATA_MARKER' },
      }),
    )
  })
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${http.address().port}/complete`
})
after(() => new Promise((resolve) => http.close(resolve)))

const input = {
  modelId: 'test-model',
  privacy: 'PUBLIC',
  messages: [
    { role: 'system', content: 'Return JSON' },
    { role: 'user', content: '{"left":{"id":"a"},"right":{"id":"b"}}' },
  ],
  maxOutputChars: 1000,
}
test('requires HTTPS for operator configured endpoints; zero-key is available', () => {
  assert.equal(createRemoteModelService({}), null)
  assert.throws(
    () => createRemoteModelService({ endpoint, model: 'test-model' }),
    /invalid_remote_endpoint/,
  )
  assert.throws(
    () => createRemoteModelService({ endpoint: 'https://127.0.0.1/complete', model: 'test-model' }),
    /invalid_remote_endpoint/,
  )
})
test('sends a real HTTP request with server-only bearer credential and tracks usage', async () => {
  mode = 'normal'
  const service = createRemoteModelService({
    endpoint,
    model: 'test-model',
    credential: 'test-only',
    allowLoopbackForTest: true,
  })
  const result = await service.complete(input, new AbortController().signal)
  assert.equal(received.authorization, 'Bearer test-only')
  assert.equal(received.payload.model, 'test-model')
  assert.equal(typeof result.text, 'string')
  assert.equal(JSON.stringify(result).includes('PRIVATE_METADATA_MARKER'), false)
  assert.equal(service.status().requests, 1)
  assert.equal(service.status().inputTokens, 25)
})
test('adapts OpenAI-compatible chat completions without vendor SDK or browser credential', async () => {
  mode = 'openai'
  const service = createRemoteModelService({
    endpoint,
    model: 'test-model',
    credential: 'test-only',
    protocol: 'openai-chat',
    allowLoopbackForTest: true,
  })
  const result = await service.complete(input, new AbortController().signal)
  assert.equal(result.text, '{"schemaVersion":1}')
  assert.equal(received.payload.response_format.type, 'json_object')
  assert.equal(received.payload.stream, false)
  assert.equal(received.authorization, 'Bearer test-only')
  assert.equal(service.status().inputTokens, 31)
  mode = 'normal'
})
test('denies private and connected data at the server boundary by default', async () => {
  const service = createRemoteModelService({
    endpoint,
    model: 'test-model',
    allowLoopbackForTest: true,
  })
  for (const privacy of ['LOCAL_PRIVATE', 'CONNECTED_SERVICE_DATA', 'SENSITIVE_CONTEXT']) {
    await assert.rejects(
      service.complete({ ...input, privacy }, new AbortController().signal),
      /remote_privacy_denied/,
    )
  }
  const enabled = createRemoteModelService({
    endpoint,
    model: 'test-model',
    allowLoopbackForTest: true,
    allowLocalPrivate: true,
  })
  await enabled.complete({ ...input, privacy: 'LOCAL_PRIVATE' }, new AbortController().signal)
  await assert.rejects(
    enabled.complete({ ...input, privacy: 'CONNECTED_SERVICE_DATA' }, new AbortController().signal),
    /remote_privacy_denied/,
  )
})
test('rejects credential-like prompt content before any remote request', async () => {
  const service = createRemoteModelService({
    endpoint,
    model: 'test-model',
    allowLoopbackForTest: true,
  })
  received = null
  await assert.rejects(
    service.complete(
      { ...input, messages: [{ role: 'user', content: 'password=supersecret123' }] },
      new AbortController().signal,
    ),
    /remote_credential_denied/,
  )
  assert.equal(received, null)
})
test('isolates authentication, rate limits, invalid JSON and redirects', async () => {
  const service = createRemoteModelService({
    endpoint,
    model: 'test-model',
    allowLoopbackForTest: true,
  })
  for (const [scenario, code] of [
    ['auth', 'remote_auth_failure'],
    ['rate', 'remote_rate_limit'],
    ['invalid', 'remote_invalid_response'],
    ['huge', 'remote_invalid_response'],
    ['redirect', 'remote_network_failure'],
  ]) {
    mode = scenario
    await assert.rejects(service.complete(input, new AbortController().signal), new RegExp(code))
  }
  mode = 'normal'
})
test('aborts a slow remote completion without blocking the app', async () => {
  mode = 'hang'
  const service = createRemoteModelService({
    endpoint,
    model: 'test-model',
    allowLoopbackForTest: true,
    timeoutMs: 20,
  })
  await assert.rejects(service.complete(input, new AbortController().signal), /remote_timeout/)
  mode = 'normal'
})
test('routes through the same-origin server boundary without exposing the credential', async () => {
  mode = 'normal'
  const reserve = createServer()
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve))
  const port = reserve.address().port
  await new Promise((resolve) => reserve.close(resolve))
  const app = await createTodayServer({
    port,
    production: true,
    env: {
      TODAY_REMOTE_ENDPOINT: endpoint,
      TODAY_REMOTE_MODEL: 'test-model',
      TODAY_REMOTE_API_KEY: 'server-only-test',
    },
    allowLoopbackRemoteForTest: true,
  })
  try {
    await app.listen()
    const origin = `http://127.0.0.1:${port}`
    const status = await (await fetch(`${origin}/api/remote-model/status`)).json()
    assert.equal(status.available, true)
    assert.equal(JSON.stringify(status).includes('server-only-test'), false)
    const response = await fetch(`${origin}/api/remote-model/complete`, {
      method: 'POST',
      headers: { origin, 'x-today-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    assert.equal(response.status, 200)
    assert.equal(received.authorization, 'Bearer server-only-test')
    assert.equal(typeof (await response.json()).text, 'string')
    const denied = await fetch(`${origin}/api/remote-model/complete`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    assert.equal(denied.status, 403)
  } finally {
    await app.close()
  }
})
