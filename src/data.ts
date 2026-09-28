import type { CaptureResult, Item, ItemAction } from './types'

const at = (dayOffset: number, hours: number, minutes: number) => {
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  date.setDate(date.getDate() + dayOffset)
  return date.toISOString()
}

const action = (
  id: string,
  label: string,
  type: ItemAction['type'],
  plugin: string,
  riskLevel: ItemAction['riskLevel'] = 0,
): ItemAction => ({ id, label, type, plugin, riskLevel, requiresConfirmation: false })

export const manualActions = (kind: 'task' | 'event'): ItemAction[] =>
  kind === 'task'
    ? [
        action('complete', '完了にする', 'complete', 'manual', 1),
        action('view', '詳細', 'view', 'manual'),
      ]
    : [action('view', '詳細を見る', 'view', 'manual')]

export function demoItems(): Item[] {
  const now = new Date().toISOString()
  const common = {
    createdAt: now,
    lastUpdated: now,
    sourceUpdatedAt: now,
    status: 'active' as const,
    syncStatus: 'synced' as const,
    pinned: false,
    demo: true,
  }
  return [
    {
      ...common,
      id: 'demo-english',
      kind: 'task',
      title: '英語課題を提出',
      description: '提出前にファイルを最終確認',
      source: 'Classroom · サンプル',
      sourceId: 'mock-classroom',
      deadline: at(1, 8, 30),
      importance: 3,
      requiresAction: true,
      confidence: 'high',
      actions: [
        action('complete', '完了', 'complete', 'mock-classroom', 1),
        action('view', '詳細', 'view', 'mock-classroom'),
      ],
    },
    {
      ...common,
      id: 'demo-hospital',
      kind: 'event',
      title: '病院の予約',
      description: '受付 10:00 · 診察券を持参',
      source: 'Calendar · サンプル',
      sourceId: 'mock-calendar',
      startAt: at(0, 10, 0),
      importance: 2,
      requiresAction: false,
      confidence: 'high',
      actions: [action('view', '詳細を見る', 'view', 'mock-calendar')],
    },
    {
      ...common,
      id: 'demo-evening',
      kind: 'event',
      title: '夕方の予定',
      description: '18:30から · 予定を確認',
      source: 'Calendar · サンプル',
      sourceId: 'mock-calendar',
      startAt: at(0, 18, 30),
      importance: 1,
      requiresAction: false,
      confidence: 'high',
      actions: [action('view', '予定を見る', 'view', 'mock-calendar')],
    },
    {
      ...common,
      id: 'demo-email',
      kind: 'email',
      title: '返信が必要なメール',
      description: '田中さん · 来週の打ち合わせについて',
      source: 'Email · サンプル',
      sourceId: 'mock-email',
      importance: 2,
      requiresAction: true,
      unread: true,
      confidence: 'medium',
      actions: [
        action('compose', '返信案を作る', 'compose', 'mock-email', 0),
        action('complete', '対応済み', 'complete', 'mock-email', 1),
      ],
    },
  ]
}

export function makeManualItem(capture: CaptureResult, date?: string, important = false): Item {
  const now = new Date().toISOString()
  const kind = capture.kind
  return {
    id: crypto.randomUUID(),
    kind,
    title: capture.title.trim(),
    description: '',
    originalInput: capture.sourceText,
    source: '自分で追加',
    sourceId: 'manual',
    createdAt: now,
    lastUpdated: now,
    sourceUpdatedAt: now,
    ...(date
      ? kind === 'event'
        ? { startAt: new Date(date).toISOString() }
        : { deadline: new Date(date).toISOString() }
      : {}),
    importance: important ? 3 : 2,
    pinned: false,
    requiresAction: kind === 'task',
    confidence: 'high',
    status: 'active',
    syncStatus: 'synced',
    demo: false,
    actions: manualActions(kind),
  }
}
