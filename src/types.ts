export type ItemKind = 'task' | 'event' | 'email'
export type ItemStatus = 'active' | 'done' | 'dismissed'
export type SyncStatus = 'synced' | 'pending' | 'failed' | 'conflict'
export type Confidence = 'high' | 'medium' | 'low'
export type ActionType = 'view' | 'complete' | 'compose' | 'open'
export type RiskLevel = 0 | 1 | 2 | 3 | 4
import type { ConflictResolution, Context, ContextCorrection } from './domain/model'
import type { ProviderState, SyncCursor } from './ports/providers'
import type { IntelligenceMode } from './intelligence/types'

export interface ItemAction {
  id: string
  label: string
  type: ActionType
  riskLevel: RiskLevel
  requiresConfirmation: boolean
  plugin: string
  payload?: Record<string, string>
}

export interface Item {
  id: string
  externalId?: string
  conversationId?: string
  observedAt?: string
  extractionMethod?: 'DIRECT' | 'DETERMINISTIC' | 'AI_EXTRACTED' | 'USER_CONFIRMED' | 'USER_CREATED'
  mailClassification?: 'ACTIONABLE' | 'CONTEXTUAL' | 'INFORMATIONAL' | 'IGNORE'
  kind: ItemKind
  title: string
  description: string
  originalInput?: string
  source: string
  sourceId: string
  createdAt: string
  startAt?: string
  endAt?: string
  allDay?: boolean
  conflict?: boolean
  deadline?: string
  importance: 1 | 2 | 3
  pinned: boolean
  snoozedUntil?: string
  requiresAction: boolean
  unread?: boolean
  dependsOn?: string[]
  confidence: Confidence
  status: ItemStatus
  syncStatus: SyncStatus
  lastUpdated: string
  sourceUpdatedAt: string
  demo: boolean
  actions: ItemAction[]
  contextId?: string
}

export interface PriorityResult {
  itemId: string
  priorityScore: number
  reason: string
  confidence: Confidence
  suggestedActions: string[]
  layer: 'now' | 'next' | 'awareness' | 'later'
}

export interface QueuedAction {
  id: string
  idempotencyKey: string
  itemId: string
  actionId: string
  queuedAt: string
  attempts: number
  status: 'pending' | 'failed' | 'conflict'
}

export interface PersistedState {
  version: 3
  items: Item[]
  contexts?: Context[]
  contextCorrections?: ContextCorrection[]
  conflictResolutions?: ConflictResolution[]
  providerStates?: Record<string, ProviderState>
  syncCursors?: Record<string, SyncCursor>
  queuedActions: QueuedAction[]
  theme: 'light' | 'dark' | 'system'
  showSamples: boolean
  calendarSyncedAt?: string
  mailSyncedAt?: string
  aiEnabled?: boolean
  intelligenceMode?: IntelligenceMode
  remotePrivateConsent?: boolean
  shadowEvaluationEnabled?: boolean
}

export interface CaptureResult {
  title: string
  kind: 'task' | 'event'
  date?: string
  confidence: Confidence
  sourceText: string
  importance?: 1 | 2 | 3
}
