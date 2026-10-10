import { budget, safeText, type ChatContext, type ChatModelPort, type ChatReply } from './contracts'
import { ConversationOrchestrator } from './orchestrator'
export interface IncomingMessage {
  adapter: string
  eventId: string
  conversationId: string
  senderId: string
  text: string
  fromSelf: boolean
  hops: number
  receivedAt: number
}
export interface Binding {
  adapter: string
  conversationId: string
  senderId: string
  credential: string
  mode: 'manual' | 'auto'
  expiresAt: number
}
export interface OutgoingMessage {
  id: string
  adapter: string
  conversationId: string
  recipient: string
  text: string
}
export type Delivery = 'DRAFT' | 'SENT' | 'FAILED' | 'UNKNOWN'
export interface MessagingAdapter {
  readonly id: string
  send(message: OutgoingMessage): Promise<'SENT' | 'FAILED' | 'UNKNOWN'>
}
export interface OutboxEntry {
  message: OutgoingMessage
  state: Delivery
  attempts: number
  expiresAt: number
}
export class MockMessagingAdapter implements MessagingAdapter {
  readonly id = 'mock'
  readonly sent: OutgoingMessage[] = []
  result: 'SENT' | 'FAILED' | 'UNKNOWN' = 'SENT'
  async send(message: OutgoingMessage) {
    this.sent.push(structuredClone(message))
    return this.result
  }
}
/** Browser-live preview only. Bindings are created by trusted UI, never by model/input. */
export class MessagingGateway {
  private bindings = new Map<string, Binding>()
  private seen = new Set<string>()
  private histories = new Map<string, ConversationOrchestrator>()
  private outbox = new Map<string, OutboxEntry>()
  private busy = false
  private rates = new Map<string, number[]>()
  constructor(
    private readonly adapter: MessagingAdapter,
    private readonly model: ChatModelPort,
    private readonly clock = () => Date.now(),
  ) {}
  private key(conversation: string) {
    return JSON.stringify([this.adapter.id, conversation])
  }
  bind(binding: Binding) {
    if (
      binding.adapter !== this.adapter.id ||
      !safeText(binding.conversationId, 128) ||
      !safeText(binding.senderId, 128) ||
      binding.credential.length < 32 ||
      !Number.isFinite(binding.expiresAt) ||
      binding.expiresAt > this.clock() + 600_000 ||
      binding.expiresAt <= this.clock() ||
      this.bindings.size >= 8
    )
      throw new Error('binding_invalid')
    this.revoke(binding.conversationId)
    this.bindings.set(this.key(binding.conversationId), structuredClone(binding))
  }
  revoke(conversation: string) {
    const key = this.key(conversation)
    this.bindings.delete(key)
    this.histories.get(key)?.clear()
    this.histories.delete(key)
    for (const [id, entry] of this.outbox)
      if (entry.message.conversationId === conversation) this.outbox.delete(id)
  }
  cancel() {
    for (const conversation of this.histories.values()) conversation.cancel()
  }
  clear() {
    for (const binding of this.bindings.values()) this.revoke(binding.conversationId)
    this.seen.clear()
    this.rates.clear()
  }
  entries() {
    return structuredClone([...this.outbox.values()])
  }
  async receive(
    event: IncomingMessage,
    credential: string,
    context: ChatContext,
  ): Promise<{ reply: ChatReply; entry: OutboxEntry }> {
    const key = this.key(event.conversationId),
      binding = this.bindings.get(key),
      now = this.clock()
    if (
      !binding ||
      binding.adapter !== event.adapter ||
      binding.senderId !== event.senderId ||
      binding.credential !== credential ||
      binding.expiresAt <= now
    )
      throw new Error('message_unauthorized')
    if (
      !safeText(event.eventId, 128) ||
      !safeText(event.text, budget.user) ||
      event.fromSelf !== false ||
      event.hops !== 0 ||
      !Number.isFinite(event.receivedAt) ||
      Math.abs(now - event.receivedAt) > 60_000 ||
      Date.parse(context.expiresAt) <= now
    )
      throw new Error('message_rejected')
    const id = JSON.stringify([event.adapter, event.conversationId, event.eventId])
    if (this.seen.has(id)) throw new Error('message_duplicate')
    if (this.busy || this.seen.size >= 512 || this.outbox.size >= 64)
      throw new Error('message_busy')
    const times = (this.rates.get(key) || []).filter((t) => now - t < 60_000)
    if (times.length >= 5) throw new Error('message_rate_limited')
    this.rates.set(key, [...times, now])
    this.seen.add(id)
    this.busy = true
    const conversation = this.histories.get(key) || new ConversationOrchestrator(this.model)
    this.histories.set(key, conversation)
    try {
      const reply = await conversation.ask(event.text, context)
      // Revocation during inference invalidates the draft and every send.
      if (
        this.bindings.get(key) !== binding ||
        binding.expiresAt <= this.clock() ||
        Date.parse(context.expiresAt) <= this.clock()
      )
        throw new Error('message_unauthorized')
      const message = {
        id: crypto.randomUUID(),
        adapter: event.adapter,
        conversationId: event.conversationId,
        recipient: binding.senderId,
        text: reply.text,
      }
      const entry: OutboxEntry = {
        message,
        state: 'DRAFT',
        attempts: 0,
        expiresAt: Math.min(
          binding.expiresAt,
          Date.parse(context.expiresAt),
          this.clock() + 120_000,
        ),
      }
      this.outbox.set(message.id, entry)
      // Auto output is a deterministic projection; arbitrary model prose is manual only.
      if (binding.mode === 'auto' && !reply.proposal && event.text === '選択情報を確認') {
        message.text = context.facts.length
          ? context.facts
              .map((f) => `${f.title} / ${f.status}${f.at ? ` / ${f.at}` : ''}`)
              .join('\n')
          : '共有された情報はありません。'
        await this.approve(message.id)
      }
      return { reply, entry: structuredClone(entry) }
    } finally {
      this.busy = false
    }
  }
  async approve(id: string): Promise<Delivery> {
    const entry = this.outbox.get(id)
    if (
      !entry ||
      !['DRAFT', 'FAILED'].includes(entry.state) ||
      entry.attempts >= 2 ||
      entry.expiresAt <= this.clock()
    )
      throw new Error('send_denied')
    const binding = this.bindings.get(this.key(entry.message.conversationId))
    if (
      !binding ||
      binding.expiresAt <= this.clock() ||
      binding.senderId !== entry.message.recipient ||
      entry.message.adapter !== binding.adapter
    )
      throw new Error('send_denied')
    entry.state = 'UNKNOWN'
    entry.attempts++ // no parallel/replay send; lost ACK stays unknown
    try {
      entry.state = await this.adapter.send(structuredClone(entry.message))
    } catch {
      entry.state = 'UNKNOWN'
    }
    return entry.state
  }
}
