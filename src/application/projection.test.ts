import { expect, it } from 'vitest'
import { demoItems } from '../data'
import { buildContextGraph } from '../domain/context-engine'
import { localPriorityProvider } from '../priority'
import { projectToday } from './projection'

it('counts a calendar, mail and task Context once and never sums importance', () => {
  const seed = demoItems()[0]
  const items = [
    {
      ...seed,
      id: 'calendar',
      sourceId: 'google-calendar',
      kind: 'event' as const,
      importance: 1 as const,
    },
    { ...seed, id: 'mail', sourceId: 'mail.gmail', kind: 'email' as const, importance: 2 as const },
    { ...seed, id: 'task', sourceId: 'manual', kind: 'task' as const, importance: 3 as const },
  ]
  const corrections = [
    {
      leftId: 'calendar',
      rightId: 'mail',
      decision: 'link' as const,
      updatedAt: '2026-09-27T00:00:00Z',
    },
    {
      leftId: 'mail',
      rightId: 'task',
      decision: 'link' as const,
      updatedAt: '2026-09-27T00:00:00Z',
    },
  ]
  const contexts = buildContextGraph(items, corrections).contexts
  const projection = projectToday(items, contexts)
  expect(projection.items).toHaveLength(1)
  expect(projection.compressionRatio).toBe(3)
  expect(projection.items[0].importance).toBe(3)
  expect(localPriorityProvider.rank(projection.items)).toHaveLength(1)
})
