import { expect, it } from 'vitest'
import { ShadowLog } from './shadow'

it('keeps only source identifiers, model label and user outcome locally', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  const log = new ShadowLog(storage)
  const first = log.propose('left', 'right', 'UNKNOWN', 'local-model')
  expect(log.counts().pending).toBe(1)
  log.resolve(first.id, 'unknown_resolved')
  expect(log.counts().unknown_resolved).toBe(1)
  expect(log.read()[0]).toMatchObject({
    leftId: 'left',
    rightId: 'right',
    proposed: 'UNKNOWN',
    outcome: 'unknown_resolved',
  })
  expect(JSON.stringify(log.read())).not.toContain('description')
})
it('keeps user labels local and separates real-life counts from benchmark results', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const log = new ShadowLog(storage)
  const merge = log.propose('a', 'b', 'SAME_CONTEXT', 'local', {
    policyVersion: 'today-evidence/1',
    confidence: 0.8,
  })
  const missed = log.propose('c', 'd', 'UNKNOWN', 'local')
  log.feedback(merge.id, 'SHOULD_NOT_LINK')
  log.feedback(missed.id, 'SHOULD_LINK')
  expect(log.metrics()).toMatchObject({
    observed: 2,
    labelled: 2,
    falseMerges: 1,
    missedRelations: 1,
    abstentions: 1,
  })
  expect(JSON.stringify(log.read())).not.toContain('description')
  log.clear()
  expect(log.metrics().observed).toBe(0)
})
