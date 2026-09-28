import { boundedJson, numericUsage } from './security.mjs'
/** Optional local Ollama transport. No download, cloud fallback, or direct browser access. */
export function createOllamaModelService({
  model,
  endpoint = 'http://127.0.0.1:11434',
  fetchImpl = fetch,
  timeoutMs = 12_000,
} = {}) {
  if (!model) return null
  const url = new URL(endpoint)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('invalid_ollama_endpoint')
  if (typeof model !== 'string' || !/^[\w.:-]{1,120}$/.test(model))
    throw new Error('invalid_ollama_model')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000)
    throw new Error('invalid_ollama_timeout')
  const base = new URL(url)
  async function request(path, init, signal) {
    let response
    try {
      response = await fetchImpl(new URL(path, base), {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      })
    } catch (error) {
      throw new Error(
        signal.aborted
          ? 'ollama_cancelled'
          : error?.name === 'TimeoutError'
            ? 'ollama_timeout'
            : 'ollama_unavailable',
      )
    }
    if (!response.ok)
      throw new Error(response.status === 404 ? 'ollama_model_missing' : 'ollama_unavailable')
    return response
  }
  return {
    async status(signal = new AbortController().signal) {
      try {
        const response = await request('api/tags', { method: 'GET' }, signal)
        const data = await boundedJson(response, 'ollama_invalid_response')
        const installed =
          Array.isArray(data.models) &&
          data.models.some((value) => value.name === model || value.model === model)
        return {
          available: installed,
          state: installed ? 'READY' : 'NOT_INSTALLED',
          modelId: model,
          locality: 'local',
          experimental: true,
        }
      } catch {
        return {
          available: false,
          state: 'UNAVAILABLE',
          modelId: model,
          locality: 'local',
          experimental: true,
        }
      }
    },
    async complete(input, signal) {
      if (
        !input ||
        input.modelId !== model ||
        !['PUBLIC', 'LOCAL_PRIVATE', 'CONNECTED_SERVICE_DATA', 'SENSITIVE_CONTEXT'].includes(
          input.privacy,
        ) ||
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
      const response = await request(
        'api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: input.messages,
            stream: false,
            format: 'json',
            think: false,
            options: { temperature: 0, num_predict: 384 },
          }),
        },
        signal,
      )
      let data
      try {
        data = await boundedJson(response, 'ollama_invalid_response')
      } catch {
        throw new Error('ollama_invalid_response')
      }
      const text = data?.message?.content
      if (
        data?.model !== model ||
        data?.done !== true ||
        typeof text !== 'string' ||
        text.length > input.maxOutputChars ||
        data?.message?.tool_calls?.length
      )
        throw new Error('ollama_invalid_response')
      return {
        text,
        modelId: model,
        outputChars: text.length,
        usage: numericUsage({ inputTokens: data.prompt_eval_count, outputTokens: data.eval_count }),
      }
    },
  }
}
