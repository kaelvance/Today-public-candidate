import type { Item } from './types'

/** The calendar lists active items by event start, otherwise task deadline.
 * ISO offsets represent instants; all-day dates retain the existing local-date policy.
 * Invalid extension data never reaches DateTimeFormat or a NaN comparator.
 */
export function scheduledItems(items: Item[]): Item[] {
  return items
    .map((item) => ({ item, time: new Date(item.startAt || item.deadline || '').getTime() }))
    .filter(({ item, time }) => item.status === 'active' && Number.isFinite(time))
    .sort((a, b) => a.time - b.time)
    .map(({ item }) => item)
}
