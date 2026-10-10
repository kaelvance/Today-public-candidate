import {
  budget,
  validateReply,
  type ChatContext,
  type ChatModelPort,
  type ChatReply,
  type ChatTurn,
} from './contracts'
import { explicitCommand } from './explicit-commands'
import {
  chatDeniedReply,
  unsupportedChatRequest,
  unsupportedExecutionClaim,
} from '../../shared/chat-policy.mjs'
export class ConversationOrchestrator {
  private history: ChatTurn[] = []
  private active: AbortController | null = null
  private generation = 0
  constructor(private readonly model: ChatModelPort) {}
  turns(): ChatTurn[] {
    return structuredClone(this.history)
  }
  cancel() {
    this.generation++
    this.active?.abort()
  }
  clear() {
    this.cancel()
    this.history = []
  }
  async ask(content: string, context: ChatContext): Promise<ChatReply> {
    if (this.active) throw new Error('chat_busy')
    if (
      !content.trim() ||
      content.length > budget.user ||
      Date.parse(context.expiresAt) <= Date.now()
    )
      throw new Error('invalid_input')
    const messages = [...this.history.slice(-budget.history), { role: 'user' as const, content }]
    const overflow = () =>
      JSON.stringify({ messages, context }).length > budget.chars ||
      new TextEncoder().encode(JSON.stringify({ messages, context, consent: true })).length >
        budget.utf8
    // Remove complete old pairs, never split an exchange or truncate the latest user request.
    while (overflow() && messages.length > 1) messages.splice(0, 2)
    if (overflow()) throw new Error('context_budget')
    const controller = new AbortController(),
      generation = ++this.generation
    this.active = controller
    const timer = setTimeout(() => controller.abort(), budget.timeout)
    try {
      const request = { messages, context, consent: true as const }
      const planned = this.model.id === 'mock-not-ai' ? null : explicitCommand(request)
      const raw =
        planned ??
        (unsupportedChatRequest(content)
          ? structuredClone(chatDeniedReply)
          : await this.model.respond(request, controller.signal))
      if (controller.signal.aborted || generation !== this.generation)
        throw new Error('chat_cancelled')
      const validated = validateReply(raw, context)
      const reply = unsupportedExecutionClaim(validated.text)
        ? structuredClone(chatDeniedReply)
        : validated
      this.history = [...messages, { role: 'assistant' as const, content: reply.text }].slice(
        -budget.history,
      )
      return reply
    } finally {
      clearTimeout(timer)
      this.active = null
    }
  }
}
