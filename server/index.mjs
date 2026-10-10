import { equalBytes as same } from './security.mjs'
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthorization, createCalendarService } from './calendar.mjs'
import { createGmailAuthorization, createGmailService } from './gmail.mjs'
import { createAIService } from './ai.mjs'
import { createLocalModelService } from './local-model.mjs'
import { createRemoteModelService } from './remote-model.mjs'
import { createChatModelService } from './chat-model.mjs'
import { createChatApiService } from './chat-api.mjs'
import { createOllamaModelService } from './ollama-model.mjs'
import { EncryptedTokenStore } from './token-store.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
}
const parseCookies = (header) => {
  const cookies = Object.create(null)
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      /* Ignore malformed cookies. */
    }
  }
  return cookies
}
const appendCookie = (res, cookie) =>
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), cookie])
const send = (res, code, data) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}
const redirect = (res, location) => {
  res.writeHead(302, { location, 'cache-control': 'no-store' })
  res.end()
}
const readJson = async (req, limit = 2048) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('invalid_input')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid_input')
  }
}

export function calendarConfig(env, baseUrl) {
  const key =
    typeof env.TODAY_TOKEN_KEY === 'string' ? Buffer.from(env.TODAY_TOKEN_KEY, 'base64') : null
  const configured = !!(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.TODAY_TOKEN_STORE &&
    key?.length === 32
  )
  return {
    configured,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenStore: env.TODAY_TOKEN_STORE,
    key,
    redirectUri: `${baseUrl}/api/calendar/callback`,
  }
}
export function gmailConfig(env, baseUrl) {
  const key =
    typeof env.TODAY_TOKEN_KEY === 'string' ? Buffer.from(env.TODAY_TOKEN_KEY, 'base64') : null
  const clientId = env.GMAIL_CLIENT_ID || env.GOOGLE_CLIENT_ID
  const clientSecret = env.GMAIL_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET
  const configured = !!(clientId && clientSecret && env.TODAY_TOKEN_STORE && key?.length === 32)
  return {
    configured,
    clientId,
    clientSecret,
    tokenStore: env.TODAY_TOKEN_STORE,
    key,
    redirectUri: `${baseUrl}/api/gmail/callback`,
  }
}

export async function createTodayServer({
  port = 5173,
  production = false,
  env = process.env,
  fetchImpl = fetch,
  store: injectedStore,
  now = () => new Date(),
  allowLoopbackRemoteForTest = false,
} = {}) {
  const baseUrl = `http://127.0.0.1:${port}`
  const config = calendarConfig(env, baseUrl)
  const mailConfig = gmailConfig(env, baseUrl)
  const signingKey =
    config.key?.length === 32
      ? config.key
      : mailConfig.key?.length === 32
        ? mailConfig.key
        : randomBytes(32)
  const store =
    config.configured || mailConfig.configured
      ? injectedStore || new EncryptedTokenStore(env.TODAY_TOKEN_STORE, signingKey)
      : null
  const calendar = config.configured
    ? createCalendarService({ ...config, store, fetchImpl, now })
    : null
  const gmail = mailConfig.configured
    ? createGmailService({ ...mailConfig, store, fetchImpl, now })
    : null
  const ai =
    env.OPENAI_API_KEY && env.TODAY_AI_MODEL
      ? createAIService({ apiKey: env.OPENAI_API_KEY, model: env.TODAY_AI_MODEL, fetchImpl })
      : null
  const configurationErrors = new Set()
  const optional = (name, create) => {
    try {
      return create()
    } catch {
      configurationErrors.add(name)
      return null
    }
  }
  async function manifest(path, name, weight) {
    if (!path) return null
    try {
      const handle = await open(path, 'r')
      let raw
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > 65_536) throw new Error('manifest_too_large')
        const buffer = Buffer.alloc(65_537)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (bytesRead > 65_536) throw new Error('manifest_too_large')
        raw = buffer.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close()
      }
      const value = JSON.parse(raw)
      if (value?.schemaVersion !== 1 || !value.files?.[weight]) throw new Error('invalid_manifest')
      return value
    } catch {
      configurationErrors.add(name)
      return null
    }
  }
  const localManifest = await manifest(env.TODAY_LOCAL_MODEL_MANIFEST, 'local', 'model.safetensors')
  const adapterManifest = await manifest(
    env.TODAY_LOCAL_ADAPTER_MANIFEST,
    'local',
    'adapters.safetensors',
  )
  const configuredLocal = optional('local', () =>
    createLocalModelService({
      modelDir: env.TODAY_LOCAL_MODEL_DIR,
      python: env.TODAY_LOCAL_PYTHON,
      expectedSha256:
        env.TODAY_LOCAL_MODEL_SHA256 || localManifest?.files?.['model.safetensors']?.sha256,
      expectedFiles: localManifest?.files,
      modelId: adapterManifest?.id || localManifest?.id || 'custom-local-model',
      adapterDir: env.TODAY_LOCAL_ADAPTER_DIR,
      expectedAdapterSha256:
        env.TODAY_LOCAL_ADAPTER_SHA256 || adapterManifest?.files?.['adapters.safetensors']?.sha256,
      expectedAdapterFiles: adapterManifest?.files,
      port: Number(env.TODAY_LOCAL_MODEL_PORT) || 8092,
      externalUrl: env.TODAY_LOCAL_MODEL_URL,
      fetchImpl,
    }),
  )
  const localModel =
    configurationErrors.has('local') || !configuredLocal
      ? {
          status: async () => ({
            state: 'INCOMPATIBLE',
            available: false,
            configurationError: true,
          }),
          load: async () => {
            throw new Error('incompatible')
          },
          complete: async () => {
            throw new Error('incompatible')
          },
          unload: async () => {},
        }
      : configuredLocal
  const remoteModel = optional('remote', () =>
    createRemoteModelService({
      endpoint: env.TODAY_REMOTE_ENDPOINT,
      model: env.TODAY_REMOTE_MODEL,
      credential: env.TODAY_REMOTE_API_KEY,
      protocol: env.TODAY_REMOTE_PROTOCOL || 'today-json',
      fetchImpl,
      allowLoopbackForTest: allowLoopbackRemoteForTest,
      allowLocalPrivate: env.TODAY_REMOTE_ALLOW_LOCAL_PRIVATE === 'true',
    }),
  )
  const chatModel = optional('chat', () =>
    createChatModelService({
      model: env.TODAY_CHAT_MODEL,
      digest: env.TODAY_CHAT_DIGEST,
      endpoint: env.TODAY_CHAT_OLLAMA_URL,
      fetchImpl,
    }),
  )
  const ollamaModel = optional('ollama', () =>
    createOllamaModelService({
      endpoint: env.TODAY_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
      model: env.TODAY_OLLAMA_MODEL,
      fetchImpl,
    }),
  )
  const chatApi = optional('chat-api', () =>
    createChatApiService({
      endpoint: env.TODAY_CHAT_API_ENDPOINT,
      model: env.TODAY_CHAT_API_MODEL,
      credential: env.TODAY_CHAT_API_KEY,
      allowExternal: env.TODAY_CHAT_API_ALLOW_EXTERNAL === 'true',
      maxRequests: Number(env.TODAY_CHAT_API_MAX_REQUESTS || 100),
      fetchImpl,
    }),
  )
  const pending = new Map()
  const aiRequests = new Map()
  const vite = production
    ? null
    : await (
        await import('vite')
      ).createServer({
        root,
        server: { middlewareMode: true, hmr: { port: port + 1 } },
        appType: 'spa',
      })

  function validSession(req) {
    const cookie = parseCookies(req.headers.cookie).today_sid || ''
    const [id, signature] = cookie.split('.')
    if (
      id &&
      /^[A-Za-z0-9_-]{43}$/.test(id) &&
      /^[A-Za-z0-9_-]{43}$/.test(signature || '') &&
      same(signature, createHmac('sha256', signingKey).update(id).digest('base64url'))
    )
      return id
    return null
  }
  function session(req, res) {
    const existing = validSession(req)
    if (existing) return existing
    const next = randomBytes(32).toString('base64url')
    const signed = `${next}.${createHmac('sha256', signingKey).update(next).digest('base64url')}`
    appendCookie(res, `today_sid=${signed}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`)
    return next
  }

  async function staticFile(req, res, pathname) {
    const dist = join(root, 'dist')
    const requested = pathname === '/' ? '/index.html' : pathname
    const file = resolve(dist, `.${requested}`)
    if (file !== dist && !file.startsWith(dist + sep)) return send(res, 404, { error: 'not_found' })
    const target = existsSync(file) ? file : extname(file) ? file : join(dist, 'index.html')
    try {
      const details = await stat(target)
      if (!details.isFile()) throw new Error('not_file')
      const accepts = req.headers['accept-encoding'] || ''
      const encoding =
        accepts.includes('br') && existsSync(`${target}.br`)
          ? 'br'
          : accepts.includes('gzip') && existsSync(`${target}.gz`)
            ? 'gzip'
            : null
      const transfer = encoding ? `${target}.${encoding === 'gzip' ? 'gz' : 'br'}` : target
      const transferDetails = encoding ? await stat(transfer) : details
      res.writeHead(200, {
        'content-type': mime[extname(target)] || 'application/octet-stream',
        'content-length': transferDetails.size,
        'cache-control': target.includes(`${sep}assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        vary: 'Accept-Encoding',
        ...(encoding ? { 'content-encoding': encoding } : {}),
      })
      if (req.method === 'HEAD') res.end()
      else createReadStream(transfer).pipe(res)
    } catch {
      send(res, 404, { error: 'not_found' })
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    if (production)
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com",
      )
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: 'invalid_host' })
    let url
    try {
      url = new URL(req.url || '/', baseUrl)
    } catch {
      return send(res, 400, { error: 'invalid_input' })
    }
    if (url.origin !== baseUrl) return send(res, 400, { error: 'invalid_input' })
    const currentTime = now().getTime()
    for (const [key, value] of pending) if (value.expiresAt <= currentTime) pending.delete(key)
    for (const [key, times] of aiRequests)
      if (!times.some((time) => Date.now() - time < 60_000)) aiRequests.delete(key)
    const sid = session(req, res)
    if (
      req.method === 'POST' &&
      (req.headers.origin !== baseUrl || req.headers['x-today-request'] !== '1')
    )
      return send(res, 403, { error: 'request_denied' })
    try {
      if (url.pathname === '/api/chat/status' && req.method === 'GET')
        return send(res, 200, {
          ...(chatModel?.status() || { configured: false, locality: 'local', experimental: true }),
          api: chatApi?.status() || { configured: false },
        })
      if (
        ['/api/chat/respond', '/api/chat/api/respond'].includes(url.pathname) &&
        req.method === 'POST'
      ) {
        if (!validSession(req)) return send(res, 403, { error: 'chat_session_required' })
        const service = url.pathname === '/api/chat/api/respond' ? chatApi : chatModel
        if (!service) return send(res, 503, { error: 'chat_not_configured' })
        const body = await readJson(req, 24_000)
        const controller = new AbortController()
        req.on('aborted', () => controller.abort())
        res.on('close', () => {
          if (!res.writableEnded) controller.abort()
        })
        return send(res, 200, await service.respond(body, controller.signal, sid))
      }
      if (url.pathname === '/api/calendar/status' && req.method === 'GET') {
        const record = store ? await store.get(sid) : null
        return send(res, 200, {
          configured: config.configured,
          connection: record?.expired ? 'expired' : record ? 'connected' : 'disconnected',
        })
      }
      if (url.pathname === '/api/calendar/connect' && req.method === 'POST') {
        if (!calendar) return send(res, 503, { error: 'not_configured' })
        if (pending.size >= 512) return send(res, 429, { error: 'rate_limited' })
        const auth = createAuthorization(config.clientId, config.redirectUri)
        pending.set(auth.state, { sid, verifier: auth.verifier, expiresAt: currentTime + 600_000 })
        appendCookie(
          res,
          `today_oauth_state=${auth.state}; HttpOnly; SameSite=Lax; Path=/api/calendar/callback; Max-Age=600`,
        )
        return send(res, 200, { url: auth.url })
      }
      if (url.pathname === '/api/calendar/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state') || ''
        const saved = pending.get(state)
        appendCookie(
          res,
          'today_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/calendar/callback; Max-Age=0',
        )
        if (
          !calendar ||
          !saved ||
          saved.expiresAt <= currentTime ||
          saved.sid !== sid ||
          !same(state, parseCookies(req.headers.cookie).today_oauth_state)
        )
          return send(res, 400, { error: 'invalid_oauth_state' })
        pending.delete(state)
        if (url.searchParams.get('error')) return redirect(res, '/?calendar=cancelled')
        const code = url.searchParams.get('code')
        if (!code) return send(res, 400, { error: 'missing_code' })
        const token = await calendar.exchange(code, saved.verifier)
        await store.update(sid, token)
        return redirect(res, '/?calendar=connected')
      }
      if (url.pathname === '/api/calendar/events' && req.method === 'GET') {
        if (!calendar) return send(res, 503, { error: 'not_configured' })
        const result = await calendar.events(sid)
        return send(res, 200, result)
      }
      if (url.pathname === '/api/calendar/disconnect' && req.method === 'POST') {
        const result = calendar ? await calendar.disconnect(sid) : { revoked: false }
        return send(res, 200, result)
      }
      if (url.pathname === '/api/gmail/status' && req.method === 'GET') {
        const record = gmail ? await store.get(`gmail:${sid}`) : null
        return send(res, 200, {
          configured: mailConfig.configured,
          connection: record?.expired ? 'expired' : record ? 'connected' : 'disconnected',
        })
      }
      if (url.pathname === '/api/gmail/connect' && req.method === 'POST') {
        if (!gmail) return send(res, 503, { error: 'not_configured' })
        if (pending.size >= 512) return send(res, 429, { error: 'rate_limited' })
        const auth = createGmailAuthorization(mailConfig.clientId, mailConfig.redirectUri)
        pending.set(`gmail:${auth.state}`, {
          sid,
          verifier: auth.verifier,
          expiresAt: currentTime + 600_000,
        })
        appendCookie(
          res,
          `today_gmail_oauth_state=${auth.state}; HttpOnly; SameSite=Lax; Path=/api/gmail/callback; Max-Age=600`,
        )
        return send(res, 200, { url: auth.url })
      }
      if (url.pathname === '/api/gmail/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state') || ''
        const saved = pending.get(`gmail:${state}`)
        appendCookie(
          res,
          'today_gmail_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/gmail/callback; Max-Age=0',
        )
        if (
          !gmail ||
          !saved ||
          saved.expiresAt <= currentTime ||
          saved.sid !== sid ||
          !same(state, parseCookies(req.headers.cookie).today_gmail_oauth_state)
        )
          return send(res, 400, { error: 'invalid_oauth_state' })
        pending.delete(`gmail:${state}`)
        if (url.searchParams.get('error')) return redirect(res, '/?gmail=cancelled')
        const code = url.searchParams.get('code')
        if (!code) return send(res, 400, { error: 'missing_code' })
        try {
          const token = await gmail.exchange(code, saved.verifier)
          await store.update(`gmail:${sid}`, token)
          return redirect(res, '/?gmail=connected')
        } catch {
          return redirect(res, '/?gmail=failed')
        }
      }
      if (url.pathname === '/api/gmail/changes' && req.method === 'GET') {
        if (!gmail) return send(res, 503, { error: 'not_configured' })
        const cursor = url.searchParams.get('cursor')
        return send(
          res,
          200,
          cursor ? await gmail.incremental(sid, cursor) : await gmail.initial(sid),
        )
      }
      if (url.pathname === '/api/gmail/message' && req.method === 'GET') {
        if (!gmail) return send(res, 503, { error: 'not_configured' })
        return send(res, 200, await gmail.getMessage(sid, url.searchParams.get('id') || ''))
      }
      if (url.pathname === '/api/gmail/disconnect' && req.method === 'POST') {
        return send(res, 200, gmail ? await gmail.disconnect(sid) : { revoked: false })
      }
      if (url.pathname === '/api/ai/status' && req.method === 'GET')
        return send(res, 200, { configured: !!ai })
      if (url.pathname === '/api/ai/interpret' && req.method === 'POST') {
        if (!ai) return send(res, 503, { error: 'not_configured' })
        const recent = (aiRequests.get(sid) || []).filter((time) => Date.now() - time < 60_000)
        if (recent.length >= 20 || aiRequests.size >= 1024)
          return send(res, 429, { error: 'ai_rate_limited' })
        aiRequests.set(sid, [...recent, Date.now()])
        const body = await readJson(req)
        const controller = new AbortController()
        res.once('close', () => controller.abort())
        const result = await ai.interpret(body, controller.signal)
        return send(res, 200, result)
      }
      if (url.pathname === '/api/local-model/status' && req.method === 'GET')
        return send(res, 200, await localModel.status())
      if (url.pathname === '/api/remote-model/status' && req.method === 'GET')
        return send(
          res,
          200,
          remoteModel?.status() || {
            available: false,
            configurationError: configurationErrors.has('remote'),
          },
        )
      if (url.pathname === '/api/ollama-model/status' && req.method === 'GET')
        return send(
          res,
          200,
          ollamaModel
            ? await ollamaModel.status()
            : {
                available: false,
                state: 'NOT_INSTALLED',
                configurationError: configurationErrors.has('ollama'),
              },
        )
      if (url.pathname === '/api/ollama-model/complete' && req.method === 'POST') {
        if (!ollamaModel) return send(res, 503, { error: 'ollama_unavailable' })
        const body = await readJson(req, 16_384)
        const controller = new AbortController()
        res.once('close', () => controller.abort())
        return send(res, 200, await ollamaModel.complete(body, controller.signal))
      }
      if (url.pathname === '/api/remote-model/complete' && req.method === 'POST') {
        if (!remoteModel) return send(res, 503, { error: 'remote_provider_unavailable' })
        const recent = (aiRequests.get(`remote:${sid}`) || []).filter(
          (time) => Date.now() - time < 60_000,
        )
        if (recent.length >= 20 || aiRequests.size >= 1024)
          return send(res, 429, { error: 'remote_rate_limit' })
        aiRequests.set(`remote:${sid}`, [...recent, Date.now()])
        const body = await readJson(req, 16_384)
        const controller = new AbortController()
        res.once('close', () => controller.abort())
        return send(res, 200, await remoteModel.complete(body, controller.signal))
      }
      if (url.pathname === '/api/local-model/load' && req.method === 'POST') {
        const controller = new AbortController()
        res.once('close', () => controller.abort())
        return send(res, 200, await localModel.load(controller.signal))
      }
      if (url.pathname === '/api/local-model/unload' && req.method === 'POST') {
        await localModel.unload()
        return send(res, 200, { state: 'READY' })
      }
      if (url.pathname === '/api/local-model/complete' && req.method === 'POST') {
        const body = await readJson(req, 16_384)
        const controller = new AbortController()
        res.once('close', () => controller.abort())
        return send(res, 200, await localModel.complete(body, controller.signal))
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' })
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return send(res, 405, { error: 'method_not_allowed' })
      if (vite) return vite.middlewares(req, res, () => send(res, 404, { error: 'not_found' }))
      return staticFile(req, res, url.pathname)
    } catch (error) {
      const code =
        error?.message === 'not_connected' ||
        error?.message === 'auth_expired' ||
        error?.message === 'remote_auth_failure'
          ? 401
          : error?.message === 'invalid_input' || error?.message === 'invalid_oauth_state'
            ? 400
            : error?.message === 'permission_denied' || error?.message === 'remote_privacy_denied'
              ? 403
              : error?.message === 'rate_limited' ||
                  error?.message === 'ai_rate_limited' ||
                  error?.message === 'model_busy' ||
                  error?.message === 'remote_rate_limit'
                ? 429
                : error?.message === 'invalid_ai_response' ||
                    error?.message === 'invalid_provider_response' ||
                    error?.message === 'invalid_model_output' ||
                    error?.message === 'local_inference_failed' ||
                    error?.message === 'remote_invalid_response'
                  ? 502
                  : 503
      const name = [
        'not_connected',
        'auth_expired',
        'provider_unavailable',
        'invalid_provider_response',
        'invalid_input',
        'ai_rate_limited',
        'invalid_ai_response',
        'ai_unavailable',
        'permission_denied',
        'rate_limited',
        'network_unavailable',
        'sync_limited',
        'token_exchange_failed',
        'model_busy',
        'model_load_failed',
        'local_inference_failed',
        'invalid_model_output',
        'not_installed',
        'incompatible',
        'corrupt',
        'port_in_use',
        'remote_auth_failure',
        'remote_rate_limit',
        'remote_provider_unavailable',
        'remote_invalid_response',
        'remote_network_failure',
        'remote_timeout',
        'remote_cancelled',
        'remote_privacy_denied',
        'ollama_unavailable',
        'ollama_model_missing',
        'ollama_invalid_response',
        'ollama_timeout',
        'ollama_cancelled',
        'chat_invalid_input',
        'chat_invalid_output',
        'chat_busy',
        'chat_rate_limited',
        'chat_model_identity',
        'chat_unavailable',
        'chat_cancelled',
      ].includes(error?.message)
        ? error.message
        : 'service_unavailable'
      return send(res, code, { error: name })
    }
  })

  return {
    server,
    close: async () => {
      await localModel.unload()
      await vite?.close()
      await new Promise((resolve) => server.close(resolve))
    },
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve(baseUrl)
        })
      }),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envPath = join(root, '.env.local')
  if (existsSync(envPath)) process.loadEnvFile(envPath)
  const production = process.argv.includes('--production')
  const portIndex = process.argv.indexOf('--port')
  const port = portIndex < 0 ? (production ? 4173 : 5173) : Number(process.argv[portIndex + 1])
  if (!Number.isInteger(port) || port < 1 || port > (production ? 65535 : 65534))
    throw new Error('Invalid --port; use 1–65534 (production also permits 65535)')
  const app = await createTodayServer({ port, production })
  await app.listen()
  process.stdout.write(`Today: http://127.0.0.1:${port}/\n`)
  const stop = async () => {
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
