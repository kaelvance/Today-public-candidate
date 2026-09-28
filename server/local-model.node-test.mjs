import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalModelService } from './local-model.mjs'

const json = (value) => new Response(JSON.stringify(value))
test('local model verifies a trusted artifact and only talks to the pinned loopback model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-local-test-'))
  const bytes = Buffer.from('test-weight')
  await writeFile(join(dir, 'model.safetensors'), bytes)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const calls = []
  const service = createLocalModelService({
    modelDir: dir,
    python: process.execPath,
    expectedSha256: sha,
    externalUrl: 'http://127.0.0.1:8099',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/health')) return { ok: true }
      if (url.endsWith('/v1/models')) return json({ data: [{ id: dir }] })
      if (url.endsWith('/v1/chat/completions'))
        return json({
          choices: [{ message: { content: '{"ok":true}', reasoning: 'private reasoning' } }],
          usage: { prompt_tokens: 3, private: 'private reasoning' },
        })
      throw new Error('unexpected_url')
    },
  })
  try {
    assert.equal((await service.status()).state, 'READY')
    assert.equal((await service.load()).state, 'RUNNING')
    const result = await service.complete({
      messages: [{ role: 'user', content: 'test' }],
      maxOutputChars: 100,
    })
    assert.equal(result.text, '{"ok":true}')
    assert.equal(JSON.stringify(result).includes('private reasoning'), false)
    assert(calls.every((call) => call.url.startsWith('http://127.0.0.1:8099/')))
    await assert.rejects(
      () =>
        service.complete({
          messages: [{ role: 'assistant', content: 'not allowed' }],
          maxOutputChars: 100,
        }),
      /invalid_input/,
    )
  } finally {
    await service.unload()
    await rm(dir, { recursive: true, force: true })
  }
})

test('missing, corrupt, and mismatched model endpoints fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-local-test-'))
  await writeFile(join(dir, 'model.safetensors'), 'bad')
  const goodSha = createHash('sha256').update('good').digest('hex')
  try {
    const missing = createLocalModelService()
    assert.equal((await missing.status()).state, 'NOT_INSTALLED')
    const corrupt = createLocalModelService({
      modelDir: dir,
      python: process.execPath,
      expectedSha256: goodSha,
    })
    assert.equal((await corrupt.status()).state, 'CORRUPT')
    await assert.rejects(() => corrupt.load(), /corrupt/)
    const sha = createHash('sha256').update('bad').digest('hex')
    const wrongEndpoint = createLocalModelService({
      modelDir: dir,
      python: process.execPath,
      expectedSha256: sha,
      externalUrl: 'http://127.0.0.1:8099',
      fetchImpl: async (url) =>
        url.endsWith('/health') ? { ok: true } : json({ data: [{ id: '/different/model' }] }),
    })
    assert.equal((await wrongEndpoint.status()).state, 'READY')
    await assert.rejects(() => wrongEndpoint.load(), /incompatible/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt adapter cannot load, and a cancelled load never starts inference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-local-test-'))
  const adapter = await mkdtemp(join(tmpdir(), 'today-adapter-test-'))
  await writeFile(join(dir, 'model.safetensors'), 'base')
  await writeFile(join(adapter, 'adapters.safetensors'), 'adapter')
  const baseSha = createHash('sha256').update('base').digest('hex')
  const adapterSha = createHash('sha256').update('adapter').digest('hex')
  try {
    const corrupt = createLocalModelService({
      modelDir: dir,
      python: process.execPath,
      expectedSha256: baseSha,
      adapterDir: adapter,
      expectedAdapterSha256: baseSha,
    })
    assert.equal((await corrupt.status()).state, 'CORRUPT')
    const valid = createLocalModelService({
      modelDir: dir,
      python: process.execPath,
      expectedSha256: baseSha,
      adapterDir: adapter,
      expectedAdapterSha256: adapterSha,
    })
    assert.equal((await valid.status()).state, 'READY')
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(() => valid.load(controller.signal), /cancelled/)
    await writeFile(join(adapter, 'adapters.safetensors'), 'tampered')
    await assert.rejects(() => valid.load(), /corrupt/)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(adapter, { recursive: true, force: true })
  }
})

test('a trained request explicitly selects the verified adapter in MLX', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-local-test-'))
  const adapter = await mkdtemp(join(tmpdir(), 'today-adapter-test-'))
  await writeFile(join(dir, 'model.safetensors'), 'base')
  await writeFile(join(adapter, 'adapters.safetensors'), 'adapter')
  let spawned = false
  let body
  const service = createLocalModelService({
    modelDir: dir,
    python: process.execPath,
    expectedSha256: createHash('sha256').update('base').digest('hex'),
    adapterDir: adapter,
    expectedAdapterSha256: createHash('sha256').update('adapter').digest('hex'),
    spawnImpl: () => {
      spawned = true
      const child = new EventEmitter()
      child.kill = () => {
        queueMicrotask(() => child.emit('exit', 0))
        return true
      }
      return child
    },
    fetchImpl: async (url, init) => {
      if (url.endsWith('/health')) return { ok: spawned }
      if (url.endsWith('/v1/models')) return json({ data: [{ id: dir }] })
      if (url.endsWith('/v1/chat/completions')) {
        body = JSON.parse(init.body)
        return json({ choices: [{ message: { content: '{}' } }] })
      }
      throw new Error('unexpected_url')
    },
  })
  try {
    assert.equal((await service.status()).state, 'READY')
    await service.complete({ messages: [{ role: 'user', content: 'x' }], maxOutputChars: 100 })
    assert.equal(body.model, dir)
    assert.equal(body.adapters, adapter)
  } finally {
    await service.unload()
    await rm(dir, { recursive: true, force: true })
    await rm(adapter, { recursive: true, force: true })
  }
})

test('unload during verification prevents the delayed load from spawning a process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-local-race-'))
  await writeFile(join(dir, 'model.safetensors'), 'base')
  let spawns = 0
  const service = createLocalModelService({
    modelDir: dir,
    python: process.execPath,
    expectedSha256: createHash('sha256').update('base').digest('hex'),
    spawnImpl: () => {
      spawns++
      throw new Error('must_not_spawn')
    },
  })
  try {
    const pendingLoad = service.load()
    await service.unload()
    await assert.rejects(pendingLoad, /cancelled/)
    assert.equal(spawns, 0)
  } finally {
    await service.unload()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failed runtime health probe terminates the owned process instead of losing its handle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'today-local-health-'))
  await writeFile(join(dir, 'model.safetensors'), 'base')
  let spawned = false,
    healthy = true,
    kills = 0
  const service = createLocalModelService({
    modelDir: dir,
    python: process.execPath,
    expectedSha256: createHash('sha256').update('base').digest('hex'),
    spawnImpl: () => {
      spawned = true
      const child = new EventEmitter()
      child.exitCode = null
      child.signalCode = null
      child.kill = () => {
        kills++
        child.signalCode = 'SIGTERM'
        queueMicrotask(() => child.emit('exit', 0))
        return true
      }
      return child
    },
    fetchImpl: async (url) =>
      url.endsWith('/health') ? { ok: spawned && healthy } : json({ data: [{ id: dir }] }),
  })
  try {
    assert.equal((await service.load()).state, 'RUNNING')
    healthy = false
    assert.equal((await service.status()).state, 'ERROR')
    assert.equal(kills, 1)
  } finally {
    await service.unload()
    await rm(dir, { recursive: true, force: true })
  }
})
