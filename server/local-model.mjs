import { boundedJson, numericUsage } from './security.mjs'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join, resolve } from 'node:path'

const SHA = /^[a-f0-9]{64}$/i
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const loopback = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port
      ? url.origin
      : null
  } catch {
    return null
  }
}

/** The HTTP bridge never accepts a model path, URL, or executable from a browser request. */
export function createLocalModelService({
  modelDir,
  python,
  expectedSha256,
  expectedFiles,
  modelId = 'local-base-model',
  adapterDir,
  expectedAdapterSha256,
  expectedAdapterFiles,
  port = 8092,
  externalUrl,
  fetchImpl = fetch,
  spawnImpl = spawn,
} = {}) {
  const endpoint = externalUrl ? loopback(externalUrl) : `http://127.0.0.1:${port}`
  if (externalUrl && !endpoint) throw new Error('invalid_local_endpoint')
  let phase = modelDir ? 'VERIFYING' : 'NOT_INSTALLED'
  let verified = false
  let child = null
  let loading = null
  let generation = 0
  let inFlight = false
  let lastError = null
  let lastUsedAt = 0
  const modelFile = modelDir ? join(resolve(modelDir), 'model.safetensors') : null

  let verification = null
  async function verify() {
    if (verification) return verification
    verification = verifyFiles().finally(() => {
      verification = null
    })
    return verification
  }
  async function verifyFiles() {
    if (!modelDir || !modelFile || !python || !existsSync(python)) {
      phase = 'NOT_INSTALLED'
      return false
    }
    if (!SHA.test(expectedSha256 || '')) {
      phase = 'INCOMPATIBLE'
      return false
    }
    try {
      const root = await realpath(modelDir)
      const files = expectedFiles || { 'model.safetensors': { sha256: expectedSha256 } }
      if (
        expectedFiles &&
        files['model.safetensors']?.sha256?.toLowerCase() !== expectedSha256.toLowerCase()
      ) {
        phase = 'INCOMPATIBLE'
        return false
      }
      phase = 'VERIFYING'
      for (const [name, details] of Object.entries(files)) {
        if (!/^[a-zA-Z0-9._-]+$/.test(name) || !SHA.test(details?.sha256 || '')) {
          phase = 'INCOMPATIBLE'
          return false
        }
        const file = await realpath(join(root, name))
        const info = await stat(file)
        if (
          !file.startsWith(root + '/') ||
          !info.isFile() ||
          (details.bytes !== undefined && info.size !== details.bytes)
        ) {
          phase = 'INCOMPATIBLE'
          return false
        }
        const hash = createHash('sha256')
        const stream = createReadStream(file)
        stream.on('data', (chunk) => hash.update(chunk))
        await once(stream, 'end')
        if (hash.digest('hex') !== details.sha256.toLowerCase()) {
          phase = 'CORRUPT'
          return false
        }
      }
      if (adapterDir) {
        if (!SHA.test(expectedAdapterSha256 || '') || externalUrl) {
          phase = 'INCOMPATIBLE'
          return false
        }
        const adapterRoot = await realpath(adapterDir)
        const adapterFiles = expectedAdapterFiles || {
          'adapters.safetensors': { sha256: expectedAdapterSha256 },
        }
        if (
          adapterFiles['adapters.safetensors']?.sha256?.toLowerCase() !==
          expectedAdapterSha256.toLowerCase()
        ) {
          phase = 'INCOMPATIBLE'
          return false
        }
        for (const [name, details] of Object.entries(adapterFiles)) {
          if (!/^[a-zA-Z0-9._-]+$/.test(name) || !SHA.test(details?.sha256 || '')) {
            phase = 'INCOMPATIBLE'
            return false
          }
          const file = await realpath(join(adapterRoot, name))
          const info = await stat(file)
          if (
            !file.startsWith(adapterRoot + '/') ||
            !info.isFile() ||
            (details.bytes !== undefined && info.size !== details.bytes)
          ) {
            phase = 'INCOMPATIBLE'
            return false
          }
          const hash = createHash('sha256')
          const stream = createReadStream(file)
          stream.on('data', (chunk) => hash.update(chunk))
          await once(stream, 'end')
          if (hash.digest('hex') !== details.sha256.toLowerCase()) {
            phase = 'CORRUPT'
            return false
          }
        }
      }
      verified = true
      phase = verified ? 'READY' : 'CORRUPT'
      return verified
    } catch {
      phase = 'NOT_INSTALLED'
      return false
    }
  }
  async function probe() {
    try {
      const response = await fetchImpl(`${endpoint}/health`, {
        redirect: 'error',
        signal: AbortSignal.timeout(1000),
      })
      return response.ok
    } catch {
      return false
    }
  }
  async function matchesModel() {
    try {
      const response = await fetchImpl(`${endpoint}/v1/models`, {
        redirect: 'error',
        signal: AbortSignal.timeout(1000),
      })
      if (!response.ok) return false
      const payload = await boundedJson(response, 'invalid_model_output')
      return (
        Array.isArray(payload?.data) && payload.data.some((item) => item?.id === resolve(modelDir))
      )
    } catch {
      return false
    }
  }
  async function status() {
    if (phase === 'RUNNING' && !(await probe())) {
      await unload()
      phase = 'ERROR'
      lastError = 'model_process_unavailable'
    }
    if (!verified && phase === 'VERIFYING') await verify()
    return {
      state: phase,
      available: phase === 'READY' || phase === 'RUNNING',
      modelLoaded: phase === 'RUNNING',
      structuredOutput: true,
      contextWindow: 4096,
      quantization: 'Q4',
      memoryEstimateMiB: 1800,
      device: 'Apple Silicon',
      backend: 'mlx-lm',
      modelId,
      capabilities: [
        'interpretInput',
        'extractFacts',
        'classifyItem',
        'compareContextCandidates',
        'resolveAmbiguity',
        'summarizeContext',
        'extractTemporalInformation',
      ],
      lastError,
      lastUsedAt,
    }
  }
  async function load(signal) {
    const startedGeneration = generation
    if (phase === 'RUNNING' && (await probe())) return status()
    if (loading) return loading
    loading = (async () => {
      // Recheck the files immediately before loading; READY may have been shown earlier.
      if (!(await verify())) throw new Error(phase.toLowerCase())
      if (signal?.aborted || startedGeneration !== generation) throw new Error('cancelled')
      phase = 'LOADING'
      lastError = null
      if (!externalUrl) {
        if (await probe()) {
          phase = 'ERROR'
          lastError = 'port_in_use'
          throw new Error('port_in_use')
        }
        child = spawnImpl(
          python,
          [
            '-m',
            'mlx_lm.server',
            '--model',
            resolve(modelDir),
            ...(adapterDir ? ['--adapter-path', resolve(adapterDir)] : []),
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--max-tokens',
            '384',
            '--chat-template-args',
            '{"enable_thinking":false}',
            '--temp',
            '0',
            '--log-level',
            'ERROR',
          ],
          {
            stdio: 'ignore',
            env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
          },
        )
        const startedChild = child
        child.on('error', () => {
          if (child !== startedChild) return
          {
            lastError = 'model_process_failed'
            phase = 'ERROR'
            child = null
          }
        })
        child.on('exit', () => {
          if (child !== startedChild) return
          if (phase === 'RUNNING' || phase === 'LOADING') phase = 'ERROR'
          child = null
        })
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        if (signal?.aborted || startedGeneration !== generation) {
          if (startedGeneration === generation) await unload()
          throw new Error('cancelled')
        }
        if (await probe()) {
          if (!(await matchesModel())) {
            if (child) child.kill('SIGTERM')
            phase = 'INCOMPATIBLE'
            lastError = 'model_identity_mismatch'
            throw new Error('incompatible')
          }
          phase = 'RUNNING'
          lastUsedAt = Date.now()
          return status()
        }
        if (!externalUrl && !child) break
        await delay(150)
      }
      if (child) child.kill('SIGTERM')
      phase = 'ERROR'
      lastError = 'model_load_failed'
      throw new Error('model_load_failed')
    })().finally(() => {
      loading = null
    })
    return loading
  }
  async function complete(input, signal = new AbortController().signal) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    if (inFlight) throw new Error('model_busy')
    if (
      !input ||
      !Array.isArray(input.messages) ||
      input.messages.length > 4 ||
      input.messages.some(
        (message) =>
          !['system', 'user'].includes(message?.role) ||
          typeof message.content !== 'string' ||
          message.content.length > 6000,
      ) ||
      !Number.isInteger(input.maxOutputChars) ||
      input.maxOutputChars < 1 ||
      input.maxOutputChars > 4000
    )
      throw new Error('invalid_input')
    inFlight = true
    try {
      await load(signal)
      const response = await fetchImpl(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: resolve(modelDir),
          ...(adapterDir ? { adapters: resolve(adapterDir) } : {}),
          messages: input.messages,
          max_tokens: Math.min(384, Math.ceil(input.maxOutputChars / 2)),
          temperature: 0,
          stream: false,
        }),
        signal,
      })
      if (!response.ok) throw new Error('local_inference_failed')
      const payload = await boundedJson(response, 'invalid_model_output')
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.length > input.maxOutputChars)
        throw new Error('invalid_model_output')
      lastUsedAt = Date.now()
      return {
        text,
        modelId,
        outputChars: text.length,
        usage: numericUsage(payload.usage, ['prompt_tokens', 'completion_tokens', 'total_tokens']),
      }
    } finally {
      inFlight = false
    }
  }
  async function unload() {
    generation++
    if (child) {
      const ownedChild = child
      child = null
      ownedChild.kill('SIGTERM')
      await Promise.race([once(ownedChild, 'exit').catch(() => {}), delay(2000)])
      if (ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill('SIGKILL')
    }
    phase = verified ? 'READY' : 'NOT_INSTALLED'
  }
  return { status, load, complete, unload, verify }
}
