/** Server-owned generic JSON completion transport. Configuration is operator-only. */
import { boundedJson, containsCredential, numericUsage } from './security.mjs'
export function createRemoteModelService({
  endpoint,
  model,
  credential,
  protocol = 'today-json',
  fetchImpl = fetch,
  allowLoopbackForTest = false,
  timeoutMs = 12_000,
  allowLocalPrivate = false,
} = {}) {
  if (!endpoint || !model) return null
  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('invalid_remote_endpoint')
  }
  const loopback =
    allowLoopbackForTest && url.protocol === 'http:' && ['127.0.0.1', '::1'].includes(url.hostname)
  if (
    !loopback &&
    (url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      /^(?:localhost|.*\.local|.*\.internal)$/i.test(url.hostname) ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) ||
      url.hostname.includes(':'))
  )
    throw new Error('invalid_remote_endpoint')
  if (typeof model !== 'string' || !model.trim() || model.length > 120)
    throw new Error('invalid_remote_model')
  if (!['today-json', 'openai-chat'].includes(protocol)) throw new Error('invalid_remote_protocol')
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < (allowLoopbackForTest ? 1 : 1000) ||
    timeoutMs > 30_000
  )
    throw new Error('invalid_remote_timeout')
  let requests = 0
  let inputChars = 0
  let outputChars = 0
  let inputTokens = 0
  let outputTokens = 0
  return {
    status: () => ({
      available: true,
      modelId: model,
      protocol,
      localPrivateAllowed: allowLocalPrivate,
      requests,
      inputChars,
      outputChars,
      inputTokens,
      outputTokens,
    }),
    async complete(input, signal) {
      if (
        input?.privacy === 'CONNECTED_SERVICE_DATA' ||
        input?.privacy === 'SENSITIVE_CONTEXT' ||
        (input?.privacy === 'LOCAL_PRIVATE' && !allowLocalPrivate) ||
        (input?.privacy !== 'PUBLIC' && input?.privacy !== 'LOCAL_PRIVATE')
      )
        throw new Error('remote_privacy_denied')
      if (
        !input ||
        input.modelId !== model ||
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
      if (input.messages.some((message) => containsCredential(message.content)))
        throw new Error('remote_credential_denied')
      const payload = JSON.stringify(
        protocol === 'openai-chat'
          ? {
              model,
              messages: input.messages,
              stream: false,
              temperature: 0,
              response_format: { type: 'json_object' },
            }
          : { model, messages: input.messages, maxOutputChars: input.maxOutputChars },
      )
      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          },
          body: payload,
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        })
      } catch (error) {
        throw new Error(
          signal.aborted
            ? 'remote_cancelled'
            : error?.name === 'TimeoutError'
              ? 'remote_timeout'
              : 'remote_network_failure',
        )
      }
      if (response.status === 401 || response.status === 403) throw new Error('remote_auth_failure')
      if (response.status === 429) throw new Error('remote_rate_limit')
      if (!response.ok) throw new Error('remote_provider_unavailable')
      let data
      data = await boundedJson(response, 'remote_invalid_response')
      const text = protocol === 'openai-chat' ? data?.choices?.[0]?.message?.content : data?.text
      const usage =
        protocol === 'openai-chat'
          ? {
              inputTokens: data?.usage?.prompt_tokens,
              outputTokens: data?.usage?.completion_tokens,
            }
          : data?.usage
      if (
        protocol === 'openai-chat' &&
        (data?.choices?.length !== 1 ||
          data.choices[0]?.message?.tool_calls?.length ||
          !['stop', null, undefined].includes(data.choices[0]?.finish_reason))
      )
        throw new Error('remote_invalid_response')
      if (
        !data ||
        typeof text !== 'string' ||
        text.length > input.maxOutputChars ||
        (protocol === 'today-json' && data.modelId !== model)
      )
        throw new Error('remote_invalid_response')
      requests++
      inputChars += payload.length
      outputChars += text.length
      if (Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens >= 0)
        inputTokens += usage.inputTokens
      if (Number.isSafeInteger(usage?.outputTokens) && usage.outputTokens >= 0)
        outputTokens += usage.outputTokens
      return { text, modelId: model, outputChars: text.length, usage: numericUsage(usage) }
    },
  }
}
