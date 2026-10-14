export type SourceState =
  | 'ready'
  | 'partial'
  | 'stale'
  | 'unavailable'
  | 'disconnected'
  | 'unconfigured'
export interface SourceFreshness {
  state: SourceState
  retrievedAt: string | null
}
export interface OverviewTask {
  id: string
  title: string
  dueAt: string | null
  sourceTime: string
  importance: 1 | 2 | 3
  group: 'overdue' | 'due_today' | 'unscheduled' | 'later'
  reason: string
}
export interface OverviewEvent {
  id: string
  title: string
  sourceTime: string
  source: 'manual' | 'google-calendar'
  allDay: boolean
  startAt: string | null
  endAt: string | null
  startDate: string | null
  endDate: string | null
}
export interface WorkspaceSnapshot {
  schemaVersion: 1
  capturedAt: string
  expiresAt: string
  tasks: Omit<OverviewTask, 'group' | 'reason'>[]
  events: OverviewEvent[]
  calendar: SourceFreshness
}
export interface DailyOverview {
  schemaVersion: 1
  contractVersion: 'today.overview.v1'
  coverage: 'selected_only'
  date: string
  timeZone: string
  generatedAt: string
  capturedAt: string
  expiresAt: string
  snapshotHash: string
  sources: {
    local: SourceFreshness
    calendar: SourceFreshness
    mail: SourceFreshness
    weather: SourceFreshness
  }
  counts: {
    overdue: number
    dueToday: number
    tasksSelected: number
    manualEvents: number
    calendarEvents: number | null
    mail: null
    weather: null
  }
  summary: string
  warnings: string[]
  tasks: OverviewTask[]
  events: OverviewEvent[]
}
export const overviewScopes = ['brief:read', 'tasks:read', 'agenda:read'] as const
