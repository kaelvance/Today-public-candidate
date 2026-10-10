import type { Item } from '../types'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}
export interface ChatFact {
  id: string
  kind: 'task' | 'event'
  title: string
  status: Item['status']
  at?: string
  priority: number
}
export interface ChatContext {
  now: string
  timezone: string
  expiresAt: string
  facts: ChatFact[]
  relations: { title: string; itemIds: string[] }[]
}
export interface ChatRequest {
  messages: ChatTurn[]
  context: ChatContext
  consent: true
}
export type CommandProposal =
  | { type: 'create'; kind: 'task' | 'event'; title: string; at?: string }
  | {
      type: 'update'
      targetId: string
      patch: { title?: string; status?: 'active' | 'done'; at?: string }
    }
export interface ChatReply {
  text: string
  citations: string[]
  proposal: CommandProposal | null
}
export interface ChatModelPort {
  readonly id: string
  respond(request: ChatRequest, signal: AbortSignal): Promise<unknown>
}
export const budget = {
  user: 2000,
  history: 12,
  facts: 6,
  chars: 4500,
  utf8: 6000,
  timeout: 30_000,
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}
export function safeText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)
  )
}
export function exactDate(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false
  const date = new Date(value)
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
  )
}
export function validateProposal(value: unknown): CommandProposal {
  if (!record(value)) throw new Error('invalid_proposal')
  if (
    value.type === 'create' &&
    exact(value, ['type', 'kind', 'title', 'at']) &&
    ['task', 'event'].includes(String(value.kind)) &&
    safeText(value.title, 160) &&
    (value.at === undefined || exactDate(value.at)) &&
    (value.kind !== 'event' || value.at !== undefined)
  )
    return value as unknown as CommandProposal
  if (
    value.type === 'update' &&
    exact(value, ['type', 'targetId', 'patch']) &&
    safeText(value.targetId, 128) &&
    record(value.patch) &&
    exact(value.patch, ['title', 'status', 'at']) &&
    Object.keys(value.patch).length === 1 &&
    (value.patch.title === undefined || safeText(value.patch.title, 160)) &&
    (value.patch.status === undefined || ['active', 'done'].includes(String(value.patch.status))) &&
    (value.patch.at === undefined || exactDate(value.patch.at))
  )
    return value as unknown as CommandProposal
  throw new Error('invalid_proposal')
}
export function validateReply(value: unknown, context: ChatContext): ChatReply {
  if (
    !record(value) ||
    !exact(value, ['text', 'citations', 'proposal']) ||
    !safeText(value.text, 4000) ||
    !Array.isArray(value.citations) ||
    value.citations.length > budget.facts ||
    value.citations.some((id) => !context.facts.some((fact) => fact.id === id))
  )
    throw new Error('invalid_reply')
  const proposal = value.proposal === null ? null : validateProposal(value.proposal)
  if (proposal?.type === 'update' && !context.facts.some((fact) => fact.id === proposal.targetId))
    throw new Error('unauthorized_target')
  if (proposal?.type === 'update') {
    const target = context.facts.find((f) => f.id === proposal.targetId)!
    if (context.facts.filter((f) => f.title === target.title).length !== 1)
      throw new Error('ambiguous_target')
  }
  return { text: value.text, citations: [...new Set(value.citations as string[])], proposal }
}
