import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as netServer } from 'node:net'
import { request } from 'node:http'
import { randomBytes } from 'node:crypto'
import { equalBytes, boundedJson } from './security.mjs'
import { createTodayServer } from './index.mjs'
import { EncryptedTokenStore } from './token-store.mjs'
import { createAIService } from './ai.mjs'

const freePort = () =>
  new Promise((resolve) => {
    const server = netServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
async function withServer(env, operation) {
  const port = await freePort()
  const app = await createTodayServer({ port, production: true, env })
  const base = await app.listen()
  try {
    await operation(base, port)
  } finally {
    await app.close()
  }
}

test('signature comparison handles equal UTF-16 length and unequal UTF-8 bytes', () => {
  assert.equal(equalBytes('é', 'a'), false)
  assert.equal(equalBytes(null, 'a'), false)
  assert.equal(equalBytes('same', 'same'), true)
  assert.equal(equalBytes('same', 'samo'), false)
})

test('bounded JSON cancels an oversized chunked body and rejects invalid UTF-8', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(128))
      },
      cancel() {
        cancelled = true
      },
    }),
  )
  await assert.rejects(boundedJson(response, 'bounded', 64), /bounded/)
  assert.equal(cancelled, true)
  await assert.rejects(boundedJson(new Response(new Uint8Array([0xff])), 'bounded'), /bounded/)
})

test('invalid optional model configuration cannot prevent zero-key Core startup', async () => {
  await withServer(
    {
      TODAY_LOCAL_MODEL_MANIFEST: join(tmpdir(), 'absent-today-manifest'),
      TODAY_LOCAL_MODEL_URL: 'https://example.invalid',
      TODAY_REMOTE_ENDPOINT: 'file:///private',
      TODAY_REMOTE_MODEL: 'test',
      TODAY_OLLAMA_ENDPOINT: 'https://example.invalid',
      TODAY_OLLAMA_MODEL: 'test',
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/calendar/status`)).status, 200)
      assert.equal(
        (await (await fetch(`${base}/api/local-model/status`)).json()).state,
        'INCOMPATIBLE',
      )
      assert.equal((await (await fetch(`${base}/api/remote-model/status`)).json()).available, false)
      assert.equal((await (await fetch(`${base}/api/ollama-model/status`)).json()).available, false)
    },
  )
})

test('malformed Unicode session signature is replaced without crashing the handler', async () => {
  await withServer({}, async (base) => {
    const result = await fetch(`${base}/api/ai/status`, {
      headers: { cookie: `today_sid=${'a'.repeat(43)}.${encodeURIComponent('é'.repeat(43))}` },
    })
    assert.equal(result.status, 200)
    assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/)
  })
})

test('invalid absolute request targets return 400 and the server remains usable', async () => {
  await withServer({}, async (base, port) => {
    for (const path of ['http://[invalid', 'https://example.invalid/api/ai/status']) {
      const code = await new Promise((resolve, reject) => {
        const req = request(
          { hostname: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } },
          (res) => {
            res.resume()
            resolve(res.statusCode)
          },
        )
        req.on('error', reject)
        req.end()
      })
      assert.equal(code, 400)
    }
    assert.equal((await fetch(`${base}/api/ai/status`)).status, 200)
  })
})

test('cross-origin POST, forged Host, oversized body and no-model calls fail closed', async () => {
  await withServer({}, async (base, port) => {
    assert.equal(
      (
        await fetch(`${base}/api/local-model/load`, {
          method: 'POST',
          headers: { origin: 'https://example.invalid', 'x-today-request': '1' },
        })
      ).status,
      403,
    )
    const badHost = await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/ai/status',
          headers: { host: 'example.invalid' },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        },
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(badHost, 403)
    const headers = { origin: base, 'x-today-request': '1', 'content-type': 'application/json' }
    assert.equal(
      (
        await fetch(`${base}/api/local-model/complete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ padding: 'a'.repeat(17000) }),
        })
      ).status,
      400,
    )
    assert.equal(
      (await fetch(`${base}/api/local-model/load`, { method: 'POST', headers })).status,
      503,
    )
    assert.equal((await fetch(`${base}/api/ai/status`)).status, 200)
  })
})

test('token store serializes writes, encrypts tokens and detects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-token-test-'))
  const file = join(dir, 'tokens.json'),
    key = randomBytes(32)
  const store = new EncryptedTokenStore(file, key)
  await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      store.update(`fixture-${i}`, { refreshToken: `fictional-${i}` }),
    ),
  )
  assert.equal(Object.keys(await store.all()).length, 16)
  const raw = await readFile(file, 'utf8')
  assert.equal(raw.includes('fictional-'), false)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  const envelope = JSON.parse(raw)
  envelope.tag = randomBytes(16).toString('base64url')
  await writeFile(file, JSON.stringify(envelope))
  await assert.rejects(store.all())
})

test('manual remote capture rejects null input and credential text without network calls', async () => {
  let calls = 0
  const ai = createAIService({
    apiKey: 'fictional',
    model: 'fixture',
    fetchImpl: async () => {
      calls++
      throw new Error('unexpected')
    },
  })
  await assert.rejects(ai.interpret(null), /invalid_input/)
  await assert.rejects(
    ai.interpret({
      input: 'password=fictional',
      localTime: new Date().toISOString(),
      timeZone: 'UTC',
    }),
    /invalid_input/,
  )
  assert.equal(calls, 0)
})

test('OAuth pending states have a capacity limit and are reclaimed after expiry', async () => {
  const port = await freePort()
  let time = Date.now()
  const app = await createTodayServer({
    port,
    production: true,
    now: () => new Date(time),
    env: {
      GOOGLE_CLIENT_ID: 'fixture',
      GOOGLE_CLIENT_SECRET: 'fictional',
      TODAY_TOKEN_STORE: join(tmpdir(), 'unused-capacity-fixture.json'),
      TODAY_TOKEN_KEY: randomBytes(32).toString('base64'),
    },
  })
  const base = await app.listen()
  try {
    const headers = { origin: base, 'x-today-request': '1' }
    for (let i = 0; i < 512; i++)
      assert.equal(
        (await fetch(`${base}/api/calendar/connect`, { method: 'POST', headers })).status,
        200,
      )
    assert.equal(
      (await fetch(`${base}/api/calendar/connect`, { method: 'POST', headers })).status,
      429,
    )
    time += 600001
    assert.equal(
      (await fetch(`${base}/api/calendar/connect`, { method: 'POST', headers })).status,
      200,
    )
    assert.equal(app.server.address().address, '127.0.0.1')
  } finally {
    await app.close()
  }
})

test('oversized or malformed optional manifests are isolated from Core', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-manifest-test-'))
  const path = join(dir, 'manifest.json')
  for (const text of ['{invalid', 'a'.repeat(65537)]) {
    await writeFile(path, text)
    await withServer({ TODAY_LOCAL_MODEL_MANIFEST: path }, async (base) => {
      assert.equal((await fetch(`${base}/api/ai/status`)).status, 200)
      assert.equal(
        (await (await fetch(`${base}/api/local-model/status`)).json()).configurationError,
        true,
      )
    })
  }
})

test('provider usage metadata is restricted to nonnegative integer counters', async () => {
  const { numericUsage } = await import('./security.mjs')
  assert.deepEqual(
    numericUsage({
      inputTokens: 4,
      outputTokens: 'PRIVATE_METADATA_MARKER',
      reasoning: 'PRIVATE_METADATA_MARKER',
    }),
    { inputTokens: 4 },
  )
  assert.equal(numericUsage({ inputTokens: -1, outputTokens: Number.MAX_SAFE_INTEGER + 1 }), null)
  assert.equal(numericUsage(['PRIVATE_METADATA_MARKER']), null)
})
