import { describe, expect, it, vi } from 'vitest'
import { contextSnapshot } from './context'
import {
  exactDate,
  validateProposal,
  validateReply,
  type ChatModelPort,
  type ChatReply,
} from './contracts'
import { ConversationOrchestrator } from './orchestrator'
import { MockChatModel } from './models'
import { ApprovalBroker, applyChatCommand } from '../application/chat-commands'
import { MessagingGateway, MockMessagingAdapter, type IncomingMessage } from './messaging'
import { makeManualItem } from '../data'
import { normalizePersistedState } from '../storage'
const fixture = () =>
  normalizePersistedState({
    version: 3,
    items: [
      makeManualItem({
        title: '架空の読書',
        kind: 'task',
        confidence: 'high',
        sourceText: 'fixture',
      }),
    ],
    theme: 'light',
    showSamples: false,
    queuedActions: [],
  })
const reply: ChatReply = { text: '架空の回答', citations: [], proposal: null }
const model: ChatModelPort = { id: 'fixture', respond: async () => reply }

describe('chat authorization and structured output', () => {
  it('minimizes context to selected local data and never exposes descriptions', () => {
    const state = fixture()
    state.items[0].description = 'excluded private description'
    const context = contextSnapshot(state, [state.items[0].id])
    expect(JSON.stringify(context)).not.toContain('description')
    expect(context.facts).toHaveLength(1)
    expect(contextSnapshot(state, []).facts).toHaveLength(0)
  })
  it.each(['gmail', 'calendar'])('rejects connected source %s even if selected', (source) => {
    const s = fixture()
    s.items[0].sourceId = source
    expect(() => contextSnapshot(s, [s.items[0].id])).toThrow('context_denied')
  })
  it('rejects sample data, missing ids, duplicate ids and large selections', () => {
    const s = fixture()
    expect(() => contextSnapshot(s, ['missing'])).toThrow()
    expect(() => contextSnapshot(s, [s.items[0].id, s.items[0].id])).toThrow()
    expect(() => contextSnapshot(s, Array(7).fill('a'))).toThrow()
    s.items[0].demo = true
    expect(() => contextSnapshot(s, [s.items[0].id])).toThrow()
  })
  it.each(['2026-02-30T10:00:00Z', '2026-01-01', '明日', '2026-10-10T09:00:00+09:00', 'bad'])(
    'rejects ambiguous or impossible date %s',
    (value) => expect(exactDate(value)).toBe(false),
  )
  it.each([
    { type: 'delete', targetId: 'x' },
    { type: 'create', kind: 'email', title: 'mail' },
    { type: 'create', kind: 'event', title: 'missing time' },
    { type: 'create', kind: 'task', title: 'x', execute: true },
    { type: 'update', targetId: 'x', patch: { sourceId: 'manual' } },
    { type: 'update', targetId: 'x', patch: {} },
    { type: 'update', targetId: 'x', patch: { status: 'dismissed' } },
  ])('rejects forbidden proposal %#', (input) => expect(() => validateProposal(input)).toThrow())
  it('rejects fabricated citations, nonselected targets and tool output', () => {
    const c = contextSnapshot(fixture(), [])
    expect(() => validateReply({ ...reply, citations: ['secret'] }, c)).toThrow()
    expect(() =>
      validateReply(
        { ...reply, proposal: { type: 'update', targetId: 'secret', patch: { title: 'x' } } },
        c,
      ),
    ).toThrow()
    expect(() => validateReply({ ...reply, tool_calls: [] }, c)).toThrow()
  })
})
describe('real-model failure defenses', () => {
  it('rejects a no-op title proposal instead of claiming completion', () => {
    const state = fixture()
    expect(() =>
      applyChatCommand(state, {
        type: 'update',
        targetId: state.items[0].id,
        patch: { title: state.items[0].title },
      }),
    ).toThrow('no_change')
  })
  it('rejects bundled status and timestamp modification', () => {
    expect(() =>
      validateProposal({
        type: 'update',
        targetId: 'x',
        patch: { status: 'done', at: '2026-10-11T06:00:00Z' },
      }),
    ).toThrow()
  })
  it('rejects a chosen ID when two selected targets have the same name', () => {
    const state = fixture(),
      other = structuredClone(state.items[0])
    other.id = 'second'
    state.items.push(other)
    const context = contextSnapshot(
      state,
      state.items.map((i) => i.id),
    )
    expect(() =>
      validateReply(
        {
          ...reply,
          proposal: { type: 'update', targetId: state.items[0].id, patch: { status: 'done' } },
        },
        context,
      ),
    ).toThrow('ambiguous_target')
  })
})
describe('approval and existing application command boundary', () => {
  it('does not mutate before approval and persists only once', async () => {
    let s = fixture()
    const broker = new ApprovalBroker()
    const receipt = broker.stage({ type: 'create', kind: 'task', title: '架空の追加' }, s)
    expect(s.items).toHaveLength(1)
    const commit = vi.fn(async (next) => {
      s = next
    })
    await broker.approve(receipt.id, () => s, commit)
    expect(s.items).toHaveLength(2)
    expect(commit).toHaveBeenCalledTimes(1)
    await expect(broker.approve(receipt.id, () => s, commit)).rejects.toThrow('approval_expired')
  })
  it('binds a proposal to original item contents, not just lastUpdated', async () => {
    const s = fixture(),
      broker = new ApprovalBroker(),
      receipt = broker.stage(
        { type: 'update', targetId: s.items[0].id, patch: { status: 'done' } },
        s,
      )
    s.items[0].title = 'changed without timestamp'
    await expect(
      broker.approve(
        receipt.id,
        () => s,
        async () => {},
      ),
    ).rejects.toThrow('stale_proposal')
  })
  it('does not trust the receipt copy returned to UI', async () => {
    let s = fixture()
    const broker = new ApprovalBroker(),
      receipt = broker.stage({ type: 'create', kind: 'task', title: 'safe' }, s)
    ;(receipt.proposal as { title: string }).title = 'tampered'
    await broker.approve(
      receipt.id,
      () => s,
      async (next) => {
        s = next
      },
    )
    expect(s.items[0].title).toBe('safe')
  })
  it('consumes expired and failed approvals without success claims', async () => {
    let now = Date.now()
    const s = fixture(),
      broker = new ApprovalBroker(() => now),
      r = broker.stage({ type: 'create', kind: 'task', title: 'x' }, s)
    now += 120_001
    await expect(
      broker.approve(
        r.id,
        () => s,
        async () => {},
      ),
    ).rejects.toThrow()
    const fresh = broker.stage({ type: 'create', kind: 'task', title: 'x' }, s)
    await expect(
      broker.approve(
        fresh.id,
        () => s,
        async () => {
          throw new Error('disk failed')
        },
      ),
    ).rejects.toThrow('disk failed')
    await expect(
      broker.approve(
        fresh.id,
        () => s,
        async () => {},
      ),
    ).rejects.toThrow()
  })
  it('does not mutate Google data via the application port', () => {
    const s = fixture()
    s.items[0].sourceId = 'google-calendar'
    expect(() =>
      applyChatCommand(s, { type: 'update', targetId: s.items[0].id, patch: { title: 'bad' } }),
    ).toThrow('target_denied')
  })
  it('creates event date in the existing version3 schema and supports restoration', () => {
    let s = fixture()
    s = applyChatCommand(s, {
      type: 'create',
      kind: 'event',
      title: '架空予定',
      at: '2026-10-11T06:00:00Z',
    })
    expect(s.items[0].startAt).toBe('2026-10-11T06:00:00.000Z')
    s = applyChatCommand(s, { type: 'update', targetId: s.items[0].id, patch: { status: 'done' } })
    s = applyChatCommand(s, {
      type: 'update',
      targetId: s.items[0].id,
      patch: { status: 'active' },
    })
    expect(s.version).toBe(3)
    expect(s.items[0].status).toBe('active')
  })
})
describe('conversation lifecycle', () => {
  it('keeps completed pairs, uses separate model port, and clears memory', async () => {
    const s = fixture(),
      c = contextSnapshot(s, []),
      m = vi.fn(model.respond),
      conversation = new ConversationOrchestrator({ id: 'test', respond: m })
    await conversation.ask('こんにちは', c)
    await conversation.ask('続けて', c)
    expect(m.mock.calls[1][0].messages.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    expect(conversation.turns()).toHaveLength(4)
    conversation.clear()
    expect(conversation.turns()).toHaveLength(0)
  })
  it('cancels late results and retains busy until underlying inference settles', async () => {
    let finish!: (value: unknown) => void
    const conversation = new ConversationOrchestrator({
        id: 'deferred',
        respond: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      }),
      c = contextSnapshot(fixture(), []),
      first = conversation.ask('x', c)
    conversation.cancel()
    await expect(conversation.ask('second', c)).rejects.toThrow('chat_busy')
    finish(reply)
    await expect(first).rejects.toThrow('chat_cancelled')
    expect(conversation.turns()).toEqual([])
  })
  it('rejects stale context and budget overflow before invoking model', async () => {
    const m = vi.fn(model.respond),
      c = contextSnapshot(fixture(), []),
      conversation = new ConversationOrchestrator({ id: 'x', respond: m })
    c.expiresAt = '2000-01-01T00:00:00Z'
    await expect(conversation.ask('x', c)).rejects.toThrow()
    c.expiresAt = new Date(Date.now() + 60_000).toISOString()
    await expect(conversation.ask('x'.repeat(2001), c)).rejects.toThrow()
    expect(m).not.toHaveBeenCalled()
  })
  it('mock proposals are visibly simulations and require the same validation', async () => {
    const s = fixture(),
      conversation = new ConversationOrchestrator(new MockChatModel()),
      result = await conversation.ask('タスク「架空」を追加', contextSnapshot(s, []))
    expect(result.text).toContain('Mock')
    expect(result.proposal?.type).toBe('create')
    expect(s.items).toHaveLength(1)
  })
})
function messaging(mode: 'manual' | 'auto' = 'manual', m = model) {
  const adapter = new MockMessagingAdapter(),
    gateway = new MessagingGateway(adapter, m),
    credential = 'synthetic-fixture-credential-1234567890',
    event: IncomingMessage = {
      adapter: 'mock',
      eventId: '1',
      conversationId: 'thread',
      senderId: 'owner',
      text: '架空の質問',
      fromSelf: false,
      hops: 0,
      receivedAt: Date.now(),
    }
  gateway.bind({
    adapter: 'mock',
    conversationId: 'thread',
    senderId: 'owner',
    credential,
    mode,
    expiresAt: Date.now() + 600_000,
  })
  return { adapter, gateway, credential, event, context: contextSnapshot(fixture(), []) }
}
describe('messaging receive → infer → approved reply', () => {
  it('receives a mock event, drafts, then sends exactly the approved recipient', async () => {
    const f = messaging()
    const r = await f.gateway.receive(f.event, f.credential, f.context)
    expect(r.entry.state).toBe('DRAFT')
    expect(f.adapter.sent).toHaveLength(0)
    await f.gateway.approve(r.entry.message.id)
    expect(f.adapter.sent[0].recipient).toBe('owner')
    await expect(f.gateway.approve(r.entry.message.id)).rejects.toThrow()
    await expect(f.gateway.receive(f.event, f.credential, f.context)).rejects.toThrow(
      'message_duplicate',
    )
  })
  it.each(['credential', 'sender', 'thread', 'adapter'])(
    'rejects unbound %s before inference',
    async (field) => {
      const m = vi.fn(model.respond),
        f = messaging('manual', { id: 'spy', respond: m }),
        e = { ...f.event }
      if (field === 'sender') e.senderId = 'third-party'
      if (field === 'thread') e.conversationId = 'group'
      if (field === 'adapter') e.adapter = 'imessage'
      await expect(
        f.gateway.receive(e, field === 'credential' ? 'wrong' : f.credential, f.context),
      ).rejects.toThrow('message_unauthorized')
      expect(m).not.toHaveBeenCalled()
    },
  )
  it.each(['self', 'hops', 'stale'])('rejects %s and echo loops', async (field) => {
    const f = messaging(),
      e = { ...f.event }
    if (field === 'self') e.fromSelf = true
    if (field === 'hops') e.hops = 1
    if (field === 'stale') e.receivedAt -= 60_001
    await expect(f.gateway.receive(e, f.credential, f.context)).rejects.toThrow('message_rejected')
  })
  it('never auto-sends arbitrary model prose or command proposals', async () => {
    const f = messaging('auto')
    await f.gateway.receive(f.event, f.credential, f.context)
    expect(f.adapter.sent).toHaveLength(0)
    const g = messaging('auto', {
      id: 'malicious',
      respond: async () => ({
        ...reply,
        proposal: { type: 'create', kind: 'task', title: 'unapproved' },
      }),
    })
    g.event.text = '選択情報を確認'
    await g.gateway.receive(g.event, g.credential, g.context)
    expect(g.adapter.sent).toHaveLength(0)
  })
  it('auto mode uses only deterministic authorized snapshot, never LLM free text', async () => {
    const f = messaging('auto')
    f.event.text = '選択情報を確認'
    await f.gateway.receive(f.event, f.credential, f.context)
    expect(f.adapter.sent[0].text).toBe('共有された情報はありません。')
    expect(f.adapter.sent[0].text).not.toBe(reply.text)
  })
  it('unknown ACK stops retries; known failure allows at most one explicit retry', async () => {
    const f = messaging()
    f.adapter.result = 'UNKNOWN'
    const r = await f.gateway.receive(f.event, f.credential, f.context)
    await f.gateway.approve(r.entry.message.id)
    await expect(f.gateway.approve(r.entry.message.id)).rejects.toThrow()
    const g = messaging()
    g.adapter.result = 'FAILED'
    const draft = await g.gateway.receive(g.event, g.credential, g.context)
    await g.gateway.approve(draft.entry.message.id)
    await g.gateway.approve(draft.entry.message.id)
    await expect(g.gateway.approve(draft.entry.message.id)).rejects.toThrow()
    expect(g.adapter.sent).toHaveLength(2)
  })
  it('revocation invalidates drafts and in-flight inference', async () => {
    const f = messaging(),
      r = await f.gateway.receive(f.event, f.credential, f.context)
    f.gateway.revoke('thread')
    await expect(f.gateway.approve(r.entry.message.id)).rejects.toThrow()
    let finish!: (r: unknown) => void
    const g = messaging('manual', {
      id: 'slow',
      respond: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const pending = g.gateway.receive(g.event, g.credential, g.context)
    g.gateway.revoke('thread')
    finish(reply)
    await expect(pending).rejects.toThrow()
    expect(g.adapter.sent).toHaveLength(0)
  })
  it('bounds sender rate, dedup cache, and exported outbox cannot change recipient', async () => {
    const f = messaging()
    const r = await f.gateway.receive(f.event, f.credential, f.context)
    r.entry.message.recipient = 'attacker'
    const copy = f.gateway.entries()
    copy[0].message.recipient = 'attacker'
    await f.gateway.approve(r.entry.message.id)
    expect(f.adapter.sent[0].recipient).toBe('owner')
    for (let i = 2; i <= 5; i++)
      await f.gateway.receive({ ...f.event, eventId: String(i) }, f.credential, f.context)
    await expect(
      f.gateway.receive({ ...f.event, eventId: '6' }, f.credential, f.context),
    ).rejects.toThrow('message_rate_limited')
  })
})
