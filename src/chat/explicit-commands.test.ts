import { expect, it } from 'vitest'
import { civilTime, explicitCommand } from './explicit-commands'
import type { ChatRequest } from './contracts'
const request = (content: string): ChatRequest => ({
  consent: true,
  messages: [{ role: 'user', content }],
  context: {
    now: '2026-10-10T23:30:00Z',
    timezone: 'Asia/Tokyo',
    expiresAt: '2026-10-10T23:31:00Z',
    facts: [],
    relations: [],
  },
})
it('creates a date-free task only from a full explicit command', () => {
  expect(explicitCommand(request('タスク「読書」を追加してください'))?.proposal).toEqual({
    type: 'create',
    kind: 'task',
    title: '読書',
  })
  expect(explicitCommand(request('次の例を説明: タスク「読書」を追加'))).toBeNull()
})
it('resolves tomorrow from local day rather than UTC day, with explicit approval pending', () => {
  expect(explicitCommand(request('予定「面談」を明日15時に追加'))?.proposal).toEqual({
    type: 'create',
    kind: 'event',
    title: '面談',
    at: '2026-10-12T06:00:00.000Z',
  })
})
it('rejects invalid civil dates and DST gaps/folds', () => {
  expect(civilTime('2026-02-30', 15, 0, 'Asia/Tokyo')).toBeNull()
  expect(civilTime('2026-03-08', 2, 30, 'America/New_York')).toBeNull()
  expect(civilTime('2026-11-01', 1, 30, 'America/New_York')).toBeNull()
  expect(civilTime('2026-10-04', 2, 15, 'Australia/Lord_Howe')).toBeNull()
  expect(civilTime('2026-10-10', 15, 30, 'Asia/Kathmandu')).toBe('2026-10-10T09:45:00.000Z')
})
it('does not select hidden or duplicate title targets', () => {
  const r = request('「読書」を完了')
  expect(explicitCommand(r)?.proposal).toBeNull()
  r.context.facts = [
    { id: 'a', kind: 'task', title: '読書', status: 'active', priority: 2 },
    { id: 'b', kind: 'task', title: '読書', status: 'active', priority: 2 },
  ]
  expect(explicitCommand(r)?.proposal).toBeNull()
  r.context.facts.pop()
  expect(explicitCommand(r)?.proposal).toEqual({
    type: 'update',
    targetId: 'a',
    patch: { status: 'done' },
  })
})
