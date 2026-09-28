import type { Item } from '../types'
import type { SourcePlugin } from './source-plugin'

export interface ReadingClubRecord {
  id: string
  title: string
  note: string
  dueAt: string
  updatedAt: string
}
export const readingClubSample = (now = new Date()): ReadingClubRecord => {
  const due = new Date(now)
  due.setDate(due.getDate() + 2)
  due.setHours(17, 0, 0, 0)
  return {
    id: 'return-1',
    title: '図書館の本を返す',
    note: '返却期限までに本をまとめる',
    dueAt: due.toISOString(),
    updatedAt: now.toISOString(),
  }
}
export const readingClubPlugin: SourcePlugin<ReadingClubRecord> = {
  manifest: {
    apiVersion: 1,
    id: 'sample.reading-club',
    name: '図書館サンプル',
    version: '1.0.0',
    description: '資格情報不要の読み取り専用サンプル',
    license: 'Today project license pending',
    capabilities: ['READ_ITEMS'],
    permissions: ['LOCAL_SAMPLE'],
    stability: 'EXPERIMENTAL',
  },
  async fetchInitial() {
    return [readingClubSample()]
  },
  async health() {
    return 'CONNECTED'
  },
  normalize(raw, now): Item {
    if (!/^[-\w]{1,60}$/.test(raw.id) || !Number.isFinite(Date.parse(raw.dueAt)))
      throw new Error('INVALID_SAMPLE_RECORD')
    return {
      id: `sample.reading-club:${raw.id}`,
      externalId: raw.id,
      kind: 'task',
      title: raw.title,
      description: raw.note,
      source: '図書館 · サンプルPlugin',
      sourceId: 'sample.reading-club',
      deadline: raw.dueAt,
      createdAt: raw.updatedAt,
      lastUpdated: now.toISOString(),
      sourceUpdatedAt: raw.updatedAt,
      importance: 2,
      pinned: false,
      requiresAction: true,
      confidence: 'high',
      status: 'active',
      syncStatus: 'synced',
      demo: true,
      actions: [],
    }
  },
}
