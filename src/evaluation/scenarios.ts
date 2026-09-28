import { MockAIProvider, NullAIProvider } from '../adapters/ai-providers'
import { MockCalendarProvider, MockMailProvider } from '../adapters/mock-providers'
import { createTodayApplication } from '../application/today'
import { createProviderRegistry } from '../ports/providers'
import type { Item, ItemKind } from '../types'

export type ScenarioName =
  | 'NORMAL_DAY'
  | 'BUSY_DAY'
  | 'CONFLICT_DAY'
  | 'OFFLINE_DAY'
  | 'AI_FAILURE'
  | 'GMAIL_FAILURE'
  | 'AUTH_EXPIRED'
  | 'AMBIGUOUS_CONTEXT'
const observed = '2026-09-25T00:00:00.000Z'
export function scenarioItem(
  id: string,
  kind: ItemKind,
  title: string,
  sourceId: string,
  options: Partial<Item> = {},
): Item {
  return {
    id,
    externalId: id,
    kind,
    title,
    description: '',
    source:
      sourceId === 'manual'
        ? '手動 · 検証用'
        : sourceId === 'mail.mock'
          ? 'メール · 検証用'
          : '予定 · 検証用',
    sourceId,
    createdAt: observed,
    importance: 2,
    pinned: false,
    requiresAction: kind !== 'event',
    confidence: 'high',
    status: 'active',
    syncStatus: 'synced',
    lastUpdated: observed,
    sourceUpdatedAt: observed,
    demo: false,
    actions: [
      {
        id: 'view',
        label: '詳細を見る',
        type: 'view',
        riskLevel: 0,
        requiresConfirmation: false,
        plugin: sourceId,
      },
    ],
    ...options,
  }
}
const calendar = (id: string, title: string, startAt: string) =>
  scenarioItem(id, 'event', title, 'calendar.mock', {
    startAt,
    endAt: new Date(new Date(startAt).getTime() + 3_600_000).toISOString(),
    requiresAction: false,
  })
const mail = (id: string, title: string, description: string) =>
  scenarioItem(id, 'email', title, 'mail.mock', { description })
const task = (id: string, title: string) => scenarioItem(id, 'task', title, 'manual')

export function scenarioData(name: ScenarioName): {
  calendar: Item[]
  mail: Item[]
  local: Item[]
} {
  if (name === 'CONFLICT_DAY')
    return {
      calendar: [calendar('cal-meeting', 'Meeting', '2026-09-30T10:00:00+09:00')],
      mail: [mail('mail-moved', 'Meeting moved to 09:30 on 9/30', 'Meeting moved to 09:30.')],
      local: [],
    }
  if (name === 'AMBIGUOUS_CONTEXT')
    return {
      calendar: [calendar('cal-math', 'Math class', '2026-09-25T10:00:00+09:00')],
      mail: [mail('mail-math', 'Math assignment due Friday 9/25', 'Submit the assignment.')],
      local: [],
    }
  if (name === 'BUSY_DAY')
    return {
      calendar: [
        calendar('cal-survey', 'Surveying Practice', '2026-09-30T13:30:00+09:00'),
        calendar('cal-other', 'Meeting', '2026-09-30T16:00:00+09:00'),
      ],
      mail: [
        mail(
          'mail-survey',
          'Regarding 9/30 Surveying Practice',
          'Bring your field notebook and writing materials.',
        ),
      ],
      local: [task('task-notebook', 'Prepare field notebook for surveying practice')],
    }
  return {
    calendar: [calendar('cal-survey', 'Surveying Practice', '2026-09-30T13:30:00+09:00')],
    mail: [
      mail(
        'mail-survey',
        'Regarding 9/30 Surveying Practice',
        'Bring your field notebook and writing materials.',
      ),
    ],
    local: [task('task-notebook', 'Prepare field notebook for surveying practice')],
  }
}
export function createScenarioApplication(name: ScenarioName) {
  const data = scenarioData(name)
  const calendarProvider = new MockCalendarProvider(
    data.calendar,
    name === 'OFFLINE_DAY' ? 'offline' : name === 'AUTH_EXPIRED' ? 'expired' : undefined,
  )
  const mailProvider = new MockMailProvider(
    data.mail,
    name === 'GMAIL_FAILURE' ? 'offline' : undefined,
  )
  const aiProvider = name === 'AI_FAILURE' ? new MockAIProvider('malformed') : new NullAIProvider()
  const registry = createProviderRegistry({
    calendar: calendarProvider,
    mail: mailProvider,
    ai: aiProvider,
  })
  return {
    app: createTodayApplication(registry, { now: () => new Date('2026-09-25T07:00:00+09:00') }),
    registry,
    data,
  }
}
