import { boundedJson, containsCredential } from './security.mjs'
const API_URL = 'https://api.openai.com/v1/responses'
const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['task', 'event'] },
    title: { type: 'string' },
    date: { type: ['string', 'null'] },
    importance: { type: 'integer', enum: [1, 2, 3] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['intent', 'title', 'date', 'importance', 'confidence'],
}

export function validateInterpretation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (
    !['task', 'event'].includes(value.intent) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 200
  )
    return null
  if (
    ![1, 2, 3].includes(value.importance) ||
    !['high', 'medium', 'low'].includes(value.confidence)
  )
    return null
  if (
    value.date !== null &&
    (typeof value.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value.date,
      ) ||
      !Number.isFinite(new Date(value.date).getTime()))
  )
    return null
  return {
    intent: value.intent,
    title: value.title.trim(),
    date: value.date,
    importance: value.importance,
    confidence: value.confidence,
  }
}

export function createAIService({ apiKey, model, fetchImpl = fetch }) {
  return {
    async interpret(value, signal = new AbortController().signal) {
      const { input, localTime, timeZone } = value || {}
      if (
        typeof input !== 'string' ||
        !input.trim() ||
        input.length > 200 ||
        typeof localTime !== 'string' ||
        !Number.isFinite(new Date(localTime).getTime()) ||
        typeof timeZone !== 'string' ||
        timeZone.length > 80
      )
        throw new Error('invalid_input')
      if (containsCredential(input)) throw new Error('invalid_input')
      const body = {
        model,
        store: false,
        max_output_tokens: 180,
        instructions:
          'Interpret a short Japanese or English personal reminder. Return only the structured object. Use the supplied local time and time zone for relative dates. Never invent an exact date or time when uncertain; use null. For tasks with a date but no time, use 23:59 local time. For events, require an explicit or strongly implied start time; otherwise return null date. Preserve the user intention and concise title. Never suggest or execute an external action.',
        input: JSON.stringify({ text: input.trim(), localTime, timeZone }),
        text: { format: { type: 'json_schema', name: 'today_capture', strict: true, schema } },
      }
      let response
      try {
        response = await fetchImpl(API_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        })
      } catch {
        throw new Error('ai_unavailable')
      }
      if (!response.ok)
        throw new Error(response.status === 429 ? 'ai_rate_limited' : 'ai_unavailable')
      let payload
      try {
        payload = await boundedJson(response, 'invalid_ai_response')
      } catch {
        throw new Error('invalid_ai_response')
      }
      const content = payload?.output
        ?.flatMap((item) => item?.content || [])
        .find((item) => item?.type === 'output_text')?.text
      if (typeof content !== 'string') throw new Error('invalid_ai_response')
      let interpreted
      try {
        interpreted = JSON.parse(content)
      } catch {
        throw new Error('invalid_ai_response')
      }
      const result = validateInterpretation(interpreted)
      if (!result) throw new Error('invalid_ai_response')
      return result
    },
  }
}
