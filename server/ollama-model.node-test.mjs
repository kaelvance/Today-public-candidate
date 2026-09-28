import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { createOllamaModelService } from './ollama-model.mjs'

let server
let endpoint
let mode = 'normal'
let payload
before(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/tags')
      return res.end(
        JSON.stringify({ models: mode === 'missing' ? [] : [{ name: 'test-local:latest' }] }),
      )
    let body = ''
    for await (const chunk of req) body += chunk
    payload = JSON.parse(body)
    if (mode === 'invalid')
      return res.end(
        JSON.stringify({
          model: 'test-local:latest',
          done: true,
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: 'delete' } }],
            content: '{}',
          },
        }),
      )
    return res.end(
      JSON.stringify({
        model: 'test-local:latest',
        done: true,
        message: { role: 'assistant', content: '{"schemaVersion":1}' },
        prompt_eval_count: 15,
        eval_count: 8,
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise((resolve) => server.close(resolve)))

test('allows only loopback and never pulls a model', () => {
  assert.throws(
    () => createOllamaModelService({ model: 'test', endpoint: 'https://example.com' }),
    /invalid_ollama_endpoint/,
  )
  assert.throws(
    () => createOllamaModelService({ model: 'test', endpoint: 'http://192.168.1.2:11434' }),
    /invalid_ollama_endpoint/,
  )
  assert.throws(
    () => createOllamaModelService({ model: '../bad', endpoint }),
    /invalid_ollama_model/,
  )
})
test('checks installed models and sends nonstreaming JSON chat locally', async () => {
  const service = createOllamaModelService({ model: 'test-local:latest', endpoint })
  assert.equal((await service.status()).state, 'READY')
  const result = await service.complete(
    {
      modelId: 'test-local:latest',
      privacy: 'LOCAL_PRIVATE',
      messages: [{ role: 'user', content: 'hello' }],
      maxOutputChars: 1000,
    },
    new AbortController().signal,
  )
  assert.equal(result.text, '{"schemaVersion":1}')
  assert.equal(payload.stream, false)
  assert.equal(payload.format, 'json')
  assert.equal(payload.think, false)
  mode = 'missing'
  assert.equal((await service.status()).state, 'NOT_INSTALLED')
  mode = 'normal'
})
test('rejects tool calls, oversized outputs and invalid requests', async () => {
  const service = createOllamaModelService({ model: 'test-local:latest', endpoint })
  mode = 'invalid'
  await assert.rejects(
    service.complete(
      {
        modelId: 'test-local:latest',
        privacy: 'PUBLIC',
        messages: [{ role: 'user', content: 'x' }],
        maxOutputChars: 20,
      },
      new AbortController().signal,
    ),
    /ollama_invalid_response/,
  )
  mode = 'normal'
  await assert.rejects(
    service.complete(
      {
        modelId: 'test-local:latest',
        privacy: 'PUBLIC',
        messages: [{ role: 'user', content: 'x' }],
        maxOutputChars: 2,
      },
      new AbortController().signal,
    ),
    /ollama_invalid_response/,
  )
  await assert.rejects(
    service.complete(
      { modelId: 'test-local:latest', privacy: 'SECRET', messages: [], maxOutputChars: 200 },
      new AbortController().signal,
    ),
    /invalid_input/,
  )
})
