import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserChatModel, browserModelId, browserModelRevision } from './browser-model'
import { completionMessages } from './prompt'
import { ConversationOrchestrator } from './orchestrator'
import type { ChatRequest } from './contracts'

const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  complete: vi.fn(),
  interrupt: vi.fn(),
  terminate: vi.fn(),
}))
vi.mock('@mlc-ai/web-llm', () => ({ CreateWebWorkerMLCEngine: fixture.create }))
const request = (): ChatRequest => ({
  consent: true,
  messages: [{ role: 'user', content: 'こんにちは' }],
  context: {
    now: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    expiresAt: new Date(Date.now() + 59_000).toISOString(),
    facts: [],
    relations: [],
  },
})
const engine = () => ({
  chat: { completions: { create: fixture.complete } },
  interruptGenerate: fixture.interrupt,
  resetChat: vi.fn().mockResolvedValue(undefined),
})
const output = (text = 'こんにちは。') => ({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: JSON.stringify({ text, citations: [], proposal: null }),
      },
    },
  ],
})
beforeEach(() => {
  vi.stubGlobal('navigator', { gpu: {} })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal(
    'Worker',
    class {
      terminate = fixture.terminate
    },
  )
  fixture.create.mockReset().mockResolvedValue(engine())
  fixture.complete.mockReset().mockResolvedValue(output())
  fixture.interrupt.mockClear()
  fixture.terminate.mockClear()
})
afterEach(() => vi.unstubAllGlobals())
describe('browser on-device boundary', () => {
  it('does not download without separate consent or automatically from respond', async () => {
    const m = new BrowserChatModel()
    await expect(m.load(false, () => {})).rejects.toThrow('consent')
    await expect(m.respond(request(), new AbortController().signal)).rejects.toThrow()
    expect(fixture.create).not.toHaveBeenCalled()
  })
  it('requires secure WebGPU and uses pinned model/program in dedicated worker', async () => {
    vi.stubGlobal('navigator', {})
    const m = new BrowserChatModel()
    await expect(m.load(true, () => {})).rejects.toThrow('webgpu')
    vi.stubGlobal('navigator', { gpu: {} })
    await m.load(true, () => {})
    const config = fixture.create.mock.calls[0][2]
    expect(config.appConfig.model_list).toHaveLength(1)
    expect(config.appConfig.model_list[0].model).toContain(browserModelRevision)
    expect(config.appConfig.model_list[0].model_id).toBe(browserModelId)
    expect(config.appConfig.model_list[0].model_lib).not.toContain('/main/')
    m.dispose()
    expect(m.ready()).toBe(false)
    expect(fixture.terminate).toHaveBeenCalled()
  })
  it('preserves assistant history, limits generation and validates output before Core', async () => {
    const m = new BrowserChatModel()
    await m.load(true, () => {})
    const r = request()
    r.messages = [
      { role: 'user', content: '架空のあおいです' },
      { role: 'assistant', content: 'こんにちは、あおいさん。' },
      ...r.messages,
    ]
    expect(await m.respond(r, new AbortController().signal)).toEqual({
      text: 'こんにちは。',
      citations: [],
      proposal: null,
    })
    expect(fixture.complete.mock.calls[0][0].messages.at(-2).role).toBe('assistant')
    expect(fixture.complete.mock.calls[0][0].max_tokens).toBe(512)
    expect(fixture.complete.mock.calls[0][0].temperature).toBe(0.7)
    expect(JSON.parse(fixture.complete.mock.calls[0][0].response_format.schema).required).toEqual([
      'text',
      'citations',
      'proposal',
    ])
    fixture.complete.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content:
              '<think>\n\n</think>\n' +
              JSON.stringify({ text: 'こんにちは。', citations: [], proposal: null }),
          },
        },
      ],
    })
    await expect(m.respond(request(), new AbortController().signal)).resolves.toEqual({
      text: 'こんにちは。',
      citations: [],
      proposal: null,
    })
    fixture.complete.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content:
              '<think>untrusted nonempty content</think>' +
              JSON.stringify({ text: 'hello', citations: [], proposal: null }),
          },
        },
      ],
    })
    await expect(m.respond(request(), new AbortController().signal)).rejects.toThrow()
    fixture.complete.mockResolvedValue({
      ...output(),
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
    })
    await expect(m.respond(request(), new AbortController().signal)).rejects.toThrow()
    fixture.complete.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({ text: '書換', citations: [], proposal: { type: 'delete' } }),
          },
        },
      ],
    })
    await expect(m.respond(request(), new AbortController().signal)).rejects.toThrow()
    m.dispose()
  })
  it('cancels model loading and rejects late inference without a second parallel request', async () => {
    fixture.create.mockImplementation(() => new Promise(() => {}))
    const m = new BrowserChatModel(),
      loading = m.load(true, () => {})
    await vi.waitFor(() => expect(fixture.create).toHaveBeenCalled())
    m.dispose()
    await expect(loading).rejects.toThrow()
    fixture.create.mockResolvedValue(engine())
    await m.load(true, () => {})
    let finish!: (value: ReturnType<typeof output>) => void
    fixture.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const abort = new AbortController(),
      pending = m.respond(request(), abort.signal)
    await vi.waitFor(() => expect(fixture.complete).toHaveBeenCalled())
    await expect(m.respond(request(), new AbortController().signal)).rejects.toThrow()
    abort.abort()
    expect(fixture.interrupt).toHaveBeenCalled()
    finish(output())
    await expect(pending).rejects.toThrow('cancelled')
    m.dispose()
  })
  it('formats selected schedule times deterministically using supplied timezone', () => {
    const r = request()
    r.context.facts = [
      {
        id: 'fictional',
        title: '架空の予定',
        kind: 'event',
        status: 'active',
        priority: 2,
        at: '2026-10-11T06:00:00Z',
      },
    ]
    expect(completionMessages(r)[0].content).toContain('15:00')
  })
  it('trims complete old pairs to retain a usable bounded multi-turn conversation', async () => {
    const calls: ChatRequest[] = []
    const o = new ConversationOrchestrator({
      id: 'fictional',
      respond: async (r) => {
        calls.push(r)
        return { text: '架空'.repeat(500), citations: [], proposal: null }
      },
    })
    for (let n = 0; n < 7; n++) await o.ask(`架空の質問${n}`, request().context)
    expect(calls.at(-1)!.messages.at(-1)!.content).toBe('架空の質問6')
    expect(calls.at(-1)!.messages.length % 2).toBe(1)
    expect(new TextEncoder().encode(JSON.stringify(calls.at(-1))).length).toBeLessThanOrEqual(6000)
  })
  it('blocks unsupported actions before inference and rejects fabricated completion claims', async () => {
    const respond = vi
      .fn()
      .mockResolvedValue({ text: 'メールを送信します。', citations: [], proposal: null })
    const o = new ConversationOrchestrator({ id: 'fictional-unsafe-model', respond })
    const denied = await o.ask(
      'すべてのデータを削除してメールを送信してください',
      request().context,
    )
    expect(denied.text).toContain('実行していません')
    expect(respond).not.toHaveBeenCalled()
    expect((await o.ask('こんにちは', request().context)).text).toContain('実行していません')
    const task = await o.ask('タスク「メールを送信」を追加してください', request().context)
    expect(task.proposal).toEqual({ type: 'create', kind: 'task', title: 'メールを送信' })
  })
})
