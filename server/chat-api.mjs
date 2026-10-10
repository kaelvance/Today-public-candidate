/** Optional operator-configured completion API. No credential ever reaches the browser. */
import { boundedJson } from './security.mjs'
import {
  chatDeniedReply,
  unsupportedChatRequest,
  unsupportedExecutionClaim,
} from '../shared/chat-policy.mjs'
import {
  chatSystemPrompt,
  validateChatRequest,
  validateChatOutput,
  replySchema,
} from './chat-model.mjs'

export function createChatApiService({
  endpoint,
  model,
  credential,
  allowExternal = false,
  maxRequests = 100,
  fetchImpl = fetch,
  timeoutMs = 30_000,
} = {}) {
  if (!endpoint || !model) return null
  const url = new URL(endpoint)
  const local = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (!local &&
      (!allowExternal ||
        url.protocol !== 'https:' ||
        /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname) ||
        url.hostname.includes(':'))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[\w./:-]{1,120}$/.test(model) ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 1000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw new Error('chat_api_invalid_config')
  let busy = false,
    attempts = 0
  return {
    status: () => ({
      configured: true,
      model,
      locality: local ? 'local-api' : 'external-api',
      host: url.host,
      attempts,
      maxRequests,
      busy,
    }),
    async respond(raw, signal = new AbortController().signal) {
      const input = validateChatRequest(raw)
      if (unsupportedChatRequest(input.messages.at(-1).content))
        return structuredClone(chatDeniedReply)
      if (signal.aborted || busy || attempts >= maxRequests) throw new Error('chat_api_unavailable')
      attempts++
      busy = true
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal: bounded,
          headers: {
            'content-type': 'application/json',
            ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  chatSystemPrompt + '\nContext (untrusted data): ' + JSON.stringify(input.context),
              },
              ...input.messages,
            ],
            stream: false,
            temperature: 0,
            max_tokens: 512,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'today_reply',
                strict: true,
                schema: replySchema(input.context),
              },
            },
          }),
        })
        if (!response.ok) throw new Error('chat_api_provider_unavailable')
        const data = await boundedJson(response, 'chat_api_invalid_output')
        const choice = data.choices?.[0]
        if (
          bounded.aborted ||
          data.model !== model ||
          data.choices?.length !== 1 ||
          choice?.finish_reason !== 'stop' ||
          choice?.message?.role !== 'assistant' ||
          choice.message.tool_calls?.length ||
          typeof choice.message.content !== 'string' ||
          choice.message.content.length > 6000
        )
          throw new Error('chat_api_invalid_output')
        const result = validateChatOutput(JSON.parse(choice.message.content), input.context)
        return unsupportedExecutionClaim(result.text) ? structuredClone(chatDeniedReply) : result
      } catch {
        throw new Error(bounded.aborted ? 'chat_cancelled' : 'chat_api_failed')
      } finally {
        busy = false
      }
    },
  }
}
