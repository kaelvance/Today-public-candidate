import { describe, expect, it } from 'vitest'
import { mergeCalendarItems, normalizeCalendarEvents } from './calendar'
import { demoItems } from './data'
import { localPriorityProvider } from './priority'

const fetched = '2026-09-25T00:00:00.000Z'

describe('Google Calendar normalization', () => {
  it('deduplicates external IDs, ignores cancelled events and preserves local tasks', () => {
    const events = normalizeCalendarEvents(
      [
        {
          id: 'a',
          summary: 'Old',
          status: 'confirmed',
          start: { dateTime: '2026-09-25T10:30:00+09:00' },
          updated: fetched,
        },
        {
          id: 'a',
          summary: 'Dentist',
          status: 'confirmed',
          start: { dateTime: '2026-09-25T10:30:00+09:00' },
          updated: fetched,
        },
        {
          id: 'b',
          summary: 'Cancelled',
          status: 'cancelled',
          start: { dateTime: '2026-09-25T11:00:00+09:00' },
        },
      ],
      fetched,
    )
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Dentist')
    expect(new Date(events[0].startAt!).toISOString()).toBe('2026-09-25T01:30:00.000Z')
    const local = {
      ...demoItems()[0],
      id: 'manual-a',
      sourceId: 'manual',
      demo: false,
      title: 'Dentist',
    }
    expect(mergeCalendarItems([local], events)).toHaveLength(2)
  })

  it('handles all-day dates as local dates and retains user pinning on refresh', () => {
    const [event] = normalizeCalendarEvents(
      [{ id: 'all', summary: 'Trip', start: { date: '2026-09-26' }, end: { date: '2026-09-27' } }],
      fetched,
    )
    expect(event.allDay).toBe(true)
    expect(new Date(event.startAt!).getDate()).toBe(26)
    const old = { ...event, pinned: true, importance: 3 as const, status: 'dismissed' as const }
    const [merged] = mergeCalendarItems([old], [{ ...event, title: 'Trip updated' }])
    expect(merged.title).toBe('Trip updated')
    expect(merged.pinned).toBe(true)
    expect(merged.status).toBe('dismissed')
    const today = new Date(2026, 8, 26, 12, 0)
    expect(localPriorityProvider.rank([{ ...event, status: 'active' }], today)[0].layer).not.toBe(
      'later',
    )
  })

  it('removes only Calendar items on disconnect', () => {
    const [event] = normalizeCalendarEvents(
      [{ id: 'x', start: { dateTime: '2026-09-25T10:30:00+09:00' } }],
      fetched,
    )
    const local = { ...demoItems()[0], sourceId: 'manual', demo: false }
    const disconnected = [local, event].filter((item) => item.sourceId !== 'google-calendar')
    expect(disconnected).toEqual([local])
  })

  it('flags overlapping timed events without treating an all-day entry as a conflict', () => {
    const events = normalizeCalendarEvents(
      [
        {
          id: 'a',
          start: { dateTime: '2026-09-25T10:00:00+09:00' },
          end: { dateTime: '2026-09-25T11:00:00+09:00' },
        },
        {
          id: 'b',
          start: { dateTime: '2026-09-25T10:30:00+09:00' },
          end: { dateTime: '2026-09-25T11:30:00+09:00' },
        },
        { id: 'c', start: { date: '2026-09-25' }, end: { date: '2026-09-26' } },
      ],
      fetched,
    )
    expect(events.find((item) => item.externalId === 'a')?.conflict).toBe(true)
    expect(events.find((item) => item.externalId === 'b')?.conflict).toBe(true)
    expect(events.find((item) => item.externalId === 'c')?.conflict).toBeFalsy()
  })
})
