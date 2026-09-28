import { describe, expect, it } from 'vitest'
import failures from '../../evals/v16-false-merges.json'
import benchmark from '../../evals/benchmark-v3.json'
import sealed from '../../evals/benchmark-v3-sealed.json'
import finalHoldout from '../../evals/benchmark-v3-final.json'
import { evaluateRelationship } from './relationship-policy'

describe('conservative relationship evidence', () => {
  it('vetoes all 17 recorded Alpha false merges as same or related', () => {
    expect(failures.records).toHaveLength(17)
    for (const failure of failures.records) {
      const decision = evaluateRelationship(
        failure.inputA,
        failure.inputB,
        failure.modelRelation as 'SAME_CONTEXT' | 'RELATED',
        0.99,
      )
      expect(['SAME_CONTEXT', 'RELATED'], failure.id).not.toContain(decision.relation)
    }
  })
  it('requires independent identity and time evidence to accept a same context', () => {
    const a = { id: 'a', title: '図書館の読み聞かせ会', date: '2026-10-03T09:00:00+09:00' }
    expect(
      evaluateRelationship(
        a,
        { id: 'b', title: '図書館の読み聞かせ会', date: a.date },
        'SAME_CONTEXT',
      ).relation,
    ).toBe('SAME_CONTEXT')
    expect(
      evaluateRelationship(a, { id: 'b', title: '図書館の読み聞かせ会' }, 'SAME_CONTEXT').relation,
    ).toBe('POSSIBLY_RELATED')
    expect(
      evaluateRelationship(
        a,
        { id: 'b', title: '図書館の読み聞かせ会', date: '2026-10-10T09:00:00+09:00' },
        'SAME_CONTEXT',
      ).relation,
    ).toBe('UNRELATED')
  })
  it('treats cancellation as a conflict, advertising as separate, and vague references as unknown', () => {
    const a = { id: 'a', title: '合唱団の発表会', date: '2026-10-08T09:00:00+09:00' }
    expect(
      evaluateRelationship(
        a,
        { id: 'b', title: '合唱団の発表会は中止', date: a.date },
        'SAME_CONTEXT',
      ).relation,
    ).toBe('CONFLICTING')
    expect(
      evaluateRelationship(a, { id: 'b', title: '広告: 合唱団の発表会に似た商品' }, 'RELATED')
        .relation,
    ).toBe('UNRELATED')
    expect(evaluateRelationship(a, { id: 'b', title: '例の件です' }, 'SAME_CONTEXT').relation).toBe(
      'UNKNOWN',
    )
  })
  it('keeps a same-ID time-change notice as a conflict instead of forcing a merge', () => {
    const calendar = {
      id: 'calendar',
      title: '市民講座',
      date: '2027-03-02T10:00:00+09:00',
      eventId: 'DEV-001',
    }
    const update = {
      id: 'mail',
      title: '市民講座は11時に変更',
      date: calendar.date,
      eventId: calendar.eventId,
    }
    const decision = evaluateRelationship(calendar, update, 'CONFLICTING')
    expect(decision.relation).toBe('CONFLICTING')
    expect(decision.negativeEvidence).toContain('status_change')
  })
  it('recognizes a same-day task that names its event in the description', () => {
    const event = { id: 'calendar', title: '市民講座', date: '2027-03-02T10:00:00+09:00' }
    const task = {
      id: 'task',
      title: '会場へ持参するものを確認',
      description: '市民講座への参加に必要',
      date: event.date,
    }
    expect(evaluateRelationship(event, task, 'RELATED').relation).toBe('RELATED')
  })
  it('recognizes a same-day participation confirmation without an event ID', () => {
    const event = { id: 'calendar', title: '市民講座', date: '2027-03-02T10:00:00+09:00' }
    const mail = { id: 'mail', title: '市民講座の参加確認', date: event.date }
    expect(evaluateRelationship(event, mail, 'SAME_CONTEXT').relation).toBe('RELATED')
  })
})

describe('sealed benchmark and training lineage', () => {
  it('keeps 200 new cases distinct from 324 known regression cases', () => {
    expect(benchmark.cases).toHaveLength(524)
    expect(sealed.cases).toHaveLength(200)
    const ids = new Set(benchmark.cases.map((item) => item.id))
    expect(ids.size).toBe(524)
    expect(benchmark.cases.filter((item) => item.split === 'REGRESSION_V2')).toHaveLength(324)
    expect(
      sealed.cases.every((item) => item.split !== 'REGRESSION_V2' && item.privacySafeSynthetic),
    ).toBe(true)
  })
  it('seals a fresh 140-case final holdout after the source-ID training diagnosis', () => {
    expect(finalHoldout.cases).toHaveLength(140)
    expect(finalHoldout.cases.filter((item) => item.split === 'HARD_TEST')).toHaveLength(130)
    expect(finalHoldout.cases.filter((item) => item.split === 'ADVERSARIAL')).toHaveLength(10)
    const previous = new Set(benchmark.cases.map((item) => JSON.stringify(item.input)))
    expect(finalHoldout.cases.some((item) => previous.has(JSON.stringify(item.input)))).toBe(false)
  })
})
