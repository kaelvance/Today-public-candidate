import { describe, expect, it } from 'vitest'
import { createAIService, validateInterpretation } from './ai.mjs'

const input = {
  input: '来週までにレポート',
  localTime: '2026-09-25T00:00:00.000Z',
  timeZone: 'Asia/Tokyo',
}
const valid = {
  intent: 'task',
  title: 'レポート',
  date: '2026-09-28T23:59:00+09:00',
  importance: 2,
  confidence: 'medium',
}
const response = (value) =>
  new Response(
    JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    }),
    { status: 200 },
  )

describe('optional capture AI', () => {
  it('sends minimal context with structured output and no server-side response storage', async () => {
    let request
    const ai = createAIService({
      apiKey: 'synthetic',
      model: 'test-model',
      fetchImpl: async (_url, options) => {
        request = JSON.parse(options.body)
        return response(valid)
      },
    })
    expect(await ai.interpret(input)).toEqual(valid)
    expect(request.store).toBe(false)
    expect(request.text.format.strict).toBe(true)
    expect(JSON.parse(request.input)).toEqual({
      text: input.input,
      localTime: input.localTime,
      timeZone: input.timeZone,
    })
    expect(request).not.toHaveProperty('tools')
  })

  it('rejects malformed and invented outputs without applying state', async () => {
    expect(validateInterpretation({ ...valid, date: 'tomorrow' })).toBeNull()
    expect(validateInterpretation({ ...valid, importance: 9 })).toBeNull()
    const ai = createAIService({
      apiKey: 'synthetic',
      model: 'test-model',
      fetchImpl: async () => response({ ...valid, date: 'next week' }),
    })
    await expect(ai.interpret(input)).rejects.toThrow('invalid_ai_response')
  })

  it('handles provider failure and long input', async () => {
    const ai = createAIService({
      apiKey: 'synthetic',
      model: 'test-model',
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    await expect(ai.interpret(input)).rejects.toThrow('ai_unavailable')
    await expect(ai.interpret({ ...input, input: 'x'.repeat(201) })).rejects.toThrow(
      'invalid_input',
    )
  })
})
