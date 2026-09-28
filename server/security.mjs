import { timingSafeEqual } from 'node:crypto'

export function equalBytes(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left),
    b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Bound bytes before JSON parsing, including responses without Content-Length. */
export async function boundedJson(
  response,
  errorName = 'invalid_provider_response',
  maxBytes = 64 * 1024,
) {
  if (Number(response.headers?.get('content-length')) > maxBytes || !response.body)
    throw new Error(errorName)
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error(errorName)
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(errorName)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export const containsCredential = (value) =>
  /\b(?:Bearer\s+[A-Za-z0-9._~+/-]{8,}|sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*\S{4,})/i.test(
    value,
  )

/** Never return arbitrary provider metadata (reasoning, credentials or nested objects). */
export function numericUsage(value, keys = ['inputTokens', 'outputTokens']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const pairs = keys
    .filter((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    .map((key) => [key, value[key]])
  return pairs.length ? Object.fromEntries(pairs) : null
}
