import { makeManualItem } from '../data'
import type { PersistedState } from '../types'
import { validateProposal, type CommandProposal } from '../chat/contracts'

/** Trusted application boundary. No model or channel owns this API. */
export function applyChatCommand(
  state: PersistedState,
  input: CommandProposal,
  now = new Date(),
): PersistedState {
  const proposal = validateProposal(input)
  if (proposal.type === 'create') {
    const item = makeManualItem(
      {
        title: proposal.title,
        kind: proposal.kind,
        confidence: 'high',
        sourceText: proposal.title,
      },
      proposal.at,
    )
    item.createdAt = item.lastUpdated = item.sourceUpdatedAt = now.toISOString()
    return { ...state, items: [item, ...state.items] }
  }
  const target = state.items.find((item) => item.id === proposal.targetId)
  if (
    !target ||
    target.sourceId !== 'manual' ||
    target.demo ||
    !['task', 'event'].includes(target.kind)
  )
    throw new Error('target_denied')
  if (
    (proposal.patch.title !== undefined && proposal.patch.title === target.title) ||
    (proposal.patch.status !== undefined && proposal.patch.status === target.status) ||
    (proposal.patch.at !== undefined &&
      Date.parse(proposal.patch.at) ===
        Date.parse((target.kind === 'event' ? target.startAt : target.deadline) || ''))
  )
    throw new Error('no_change')
  const updated = { ...target, ...proposal.patch, lastUpdated: now.toISOString() }
  delete (updated as Record<string, unknown>).at
  if (proposal.patch.at !== undefined) {
    if (target.kind === 'event') {
      updated.startAt = proposal.patch.at
      delete updated.endAt
    } else updated.deadline = proposal.patch.at
  }
  return { ...state, items: state.items.map((item) => (item.id === target.id ? updated : item)) }
}
export interface ApprovalReceipt {
  id: string
  proposal: CommandProposal
  revision: string
  expiresAt: number
}
export class ApprovalBroker {
  private pending = new Map<string, ApprovalReceipt>()
  constructor(private readonly clock = () => Date.now()) {}
  stage(input: CommandProposal, state: PersistedState): ApprovalReceipt {
    this.pending.clear()
    const proposal = structuredClone(validateProposal(input))
    applyChatCommand(state, proposal)
    this.pending.clear()
    const receipt = {
      id: crypto.randomUUID(),
      proposal,
      revision: JSON.stringify(state.items),
      expiresAt: this.clock() + 120_000,
    }
    this.pending.set(receipt.id, structuredClone(receipt))
    return receipt
  }
  discard() {
    this.pending.clear()
  }
  async approve(
    id: string,
    read: () => PersistedState,
    commit: (next: PersistedState, expected: string) => Promise<void>,
  ): Promise<void> {
    const receipt = this.pending.get(id)
    this.pending.delete(id) // single use, including failed or uncertain persistence
    if (!receipt || receipt.expiresAt <= this.clock()) throw new Error('approval_expired')
    const state = read()
    if (JSON.stringify(state.items) !== receipt.revision) throw new Error('stale_proposal')
    await commit(
      applyChatCommand(state, receipt.proposal, new Date(this.clock())),
      JSON.stringify(state),
    )
  }
}
