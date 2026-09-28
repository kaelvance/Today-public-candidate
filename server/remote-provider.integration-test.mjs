import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createServer as createVite } from 'vite'
import { createTodayServer } from './index.mjs'

async function freePort() {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test('generic HTTP Provider traverses Router, Privacy Gateway, schema and relationship policy', async () => {
  let calls = 0
  let responseMode = 'valid'
  const endpoint = createServer(async (req, res) => {
    calls++
    for await (const chunk of req) {
      void chunk
    }
    if (responseMode === 'auth') {
      res.writeHead(401)
      return res.end('{}')
    }
    if (responseMode === 'invalid') {
      res.writeHead(200)
      return res.end('{broken')
    }
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        modelId: 'test-model',
        text: JSON.stringify({
          schemaVersion: 1,
          capability: 'compareContextCandidates',
          confidence: 0.9,
          sourceIds: ['calendar', 'mail'],
          value: { relation: 'SAME_CONTEXT', evidence: ['same_event_identifier'], conflicts: [] },
        }),
      }),
    )
  })
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const port = await freePort()
  const appUrl = `http://127.0.0.1:${port}`
  const realFetch = globalThis.fetch
  const app = await createTodayServer({
    port,
    production: true,
    env: {
      TODAY_REMOTE_ENDPOINT: `http://127.0.0.1:${endpoint.address().port}/complete`,
      TODAY_REMOTE_MODEL: 'test-model',
    },
    allowLoopbackRemoteForTest: true,
    fetchImpl: realFetch,
  })
  const vite = await createVite({
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
  try {
    await app.listen()
    globalThis.fetch = (input, init = {}) =>
      realFetch(input, {
        ...init,
        headers:
          init.method === 'POST' && String(input).startsWith(appUrl)
            ? { ...init.headers, origin: appUrl }
            : init.headers,
      })
    const [
      { ConnectedModelProvider },
      { HttpRemoteTransport },
      { IntelligenceRouter, intelligenceRequest },
      { defaultPolicy },
    ] = await Promise.all([
      vite.ssrLoadModule('/src/intelligence/providers.ts'),
      vite.ssrLoadModule('/src/intelligence/http-remote-transport.ts'),
      vite.ssrLoadModule('/src/intelligence/router.ts'),
      vite.ssrLoadModule('/src/intelligence/types.ts'),
    ])
    const provider = new ConnectedModelProvider(
      'remote.test-http',
      'test-model',
      'CUSTOM',
      new HttpRemoteTransport(appUrl + '/api/remote-model'),
      ['compareContextCandidates'],
    )
    const router = new IntelligenceRouter([provider], {
      ...defaultPolicy,
      mode: 'CUSTOM_ONLY',
      remoteEnabled: true,
      localPrivateRemoteConsent: false,
    })
    const input = {
      left: {
        id: 'calendar',
        title: '防災倉庫の見学',
        date: '2027-04-02T10:00:00+09:00',
        eventId: 'EVT-1',
      },
      right: {
        id: 'mail',
        title: '防災倉庫の見学は予定どおり',
        date: '2027-04-02T10:00:00+09:00',
        eventId: 'EVT-1',
      },
    }
    const request = intelligenceRequest(
      'compareContextCandidates',
      input,
      'PUBLIC',
      'remote-test',
      { minConfidence: 0 },
    )
    const result = await router.route(request, new AbortController().signal)
    assert.equal(result.status, 'proposal')
    assert.equal(result.route, 'remote')
    assert.equal(result.proposal.value.relation, 'SAME_CONTEXT')
    assert.equal(calls, 1)
    const denied = await router.route(
      { ...request, traceId: 'private', privacy: 'CONNECTED_SERVICE_DATA' },
      new AbortController().signal,
    )
    assert.equal(denied.status, 'deterministic')
    assert.equal(calls, 1)
    responseMode = 'invalid'
    const invalid = await router.route(
      { ...request, traceId: 'invalid' },
      new AbortController().signal,
    )
    assert.equal(invalid.status, 'deterministic')
    responseMode = 'auth'
    const auth = await router.route({ ...request, traceId: 'auth' }, new AbortController().signal)
    assert.equal(auth.status, 'deterministic')
  } finally {
    globalThis.fetch = realFetch
    await vite.close()
    await app.close()
    await new Promise((resolve) => endpoint.close(resolve))
  }
})
