import { demoItems } from './data'
import type { ConflictResolution, Context, ContextCorrection } from './domain/model'
import type { ProviderState, SyncCursor } from './ports/providers'
import type { Item, ItemAction, PersistedState, QueuedAction } from './types'
import type { IntelligenceMode } from './intelligence/types'

const DB = 'today-prototype-v1'
const STORE = 'state'
const KEY = 'current'
const FALLBACK = 'today-prototype-state-v1'
const now = () => new Date().toISOString()
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max = 500): string =>
  typeof value === 'string' ? value.slice(0, max) : ''
const date = (value: unknown): string | undefined =>
  typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : undefined

function normalizeAction(value: unknown, sourceId: string): ItemAction | null {
  if (!object(value) || !['view', 'complete', 'compose', 'open'].includes(String(value.type)))
    return null
  if (
    !Number.isInteger(value.riskLevel) ||
    Number(value.riskLevel) < 0 ||
    Number(value.riskLevel) > 4
  )
    return null
  if (string(value.plugin) !== sourceId) return null
  return {
    id: string(value.id, 100),
    label: string(value.label, 80),
    type: value.type as ItemAction['type'],
    plugin: sourceId,
    riskLevel: value.riskLevel as ItemAction['riskLevel'],
    requiresConfirmation: value.requiresConfirmation === true,
  }
}

function normalizeItem(value: unknown): Item | null {
  if (!object(value) || !['task', 'event', 'email'].includes(String(value.kind))) return null
  const id = string(value.id, 120)
  const title = string(value.title, 200).trim()
  const sourceId = string(value.sourceId, 100)
  if (!id || !title || !sourceId) return null
  const timestamp = date(value.lastUpdated) || now()
  const rawActions = Array.isArray(value.actions) ? value.actions : []
  const actions = rawActions
    .map((action) => normalizeAction(action, sourceId))
    .filter((action): action is ItemAction => !!action)
  if (!actions.length)
    actions.push({
      id: 'view',
      label: '詳細を見る',
      type: 'view',
      riskLevel: 0,
      requiresConfirmation: false,
      plugin: sourceId,
    })
  const importance = [1, 2, 3].includes(value.importance as number)
    ? (value.importance as Item['importance'])
    : 2
  const syncStatus = ['synced', 'pending', 'failed', 'conflict'].includes(String(value.syncStatus))
    ? (value.syncStatus as Item['syncStatus'])
    : value.syncStatus === 'queued'
      ? 'pending'
      : 'synced'
  return {
    id,
    externalId: string(value.externalId, 120) || undefined,
    conversationId: string(value.conversationId, 120) || undefined,
    observedAt: date(value.observedAt),
    extractionMethod: [
      'DIRECT',
      'DETERMINISTIC',
      'AI_EXTRACTED',
      'USER_CONFIRMED',
      'USER_CREATED',
    ].includes(String(value.extractionMethod))
      ? (value.extractionMethod as Item['extractionMethod'])
      : undefined,
    mailClassification: ['ACTIONABLE', 'CONTEXTUAL', 'INFORMATIONAL', 'IGNORE'].includes(
      String(value.mailClassification),
    )
      ? (value.mailClassification as Item['mailClassification'])
      : undefined,
    kind: value.kind as Item['kind'],
    title,
    description: string(value.description, 5000),
    originalInput: string(value.originalInput, 200) || undefined,
    source: string(value.source, 200) || '不明な情報源',
    sourceId,
    createdAt: date(value.createdAt) || timestamp,
    startAt: date(value.startAt),
    endAt: date(value.endAt),
    allDay: value.allDay === true,
    conflict: value.conflict === true,
    deadline: date(value.deadline),
    importance,
    pinned: value.pinned === true,
    snoozedUntil: date(value.snoozedUntil),
    requiresAction:
      typeof value.requiresAction === 'boolean' ? value.requiresAction : value.kind !== 'event',
    unread: value.unread === true,
    dependsOn: Array.isArray(value.dependsOn)
      ? value.dependsOn.filter((x) => typeof x === 'string').slice(0, 20)
      : undefined,
    confidence: ['high', 'medium', 'low'].includes(String(value.confidence))
      ? (value.confidence as Item['confidence'])
      : 'low',
    status: ['active', 'done', 'dismissed'].includes(String(value.status))
      ? (value.status as Item['status'])
      : 'active',
    syncStatus,
    lastUpdated: timestamp,
    sourceUpdatedAt: date(value.sourceUpdatedAt) || timestamp,
    demo: value.demo === true,
    actions,
  }
}

function normalizeQueue(value: unknown): QueuedAction | null {
  if (!object(value) || !string(value.id) || !string(value.itemId) || !string(value.actionId))
    return null
  return {
    id: string(value.id, 120),
    idempotencyKey: string(value.idempotencyKey, 120) || string(value.id, 120),
    itemId: string(value.itemId, 120),
    actionId: string(value.actionId, 120),
    queuedAt: date(value.queuedAt) || now(),
    attempts: Number.isInteger(value.attempts)
      ? Math.max(0, Math.min(10, Number(value.attempts)))
      : 0,
    status: ['pending', 'failed', 'conflict'].includes(String(value.status))
      ? (value.status as QueuedAction['status'])
      : 'failed',
  }
}

export function normalizePersistedState(value: unknown): PersistedState {
  if (!object(value))
    return {
      version: 3,
      items: [],
      queuedActions: [],
      theme: 'system',
      showSamples: false,
      contexts: [],
      contextCorrections: [],
      conflictResolutions: [],
      providerStates: {},
      syncCursors: {},
    }
  const samples = new Map(demoItems().map((item) => [item.id, item]))
  const items = (Array.isArray(value.items) ? value.items : [])
    .map(normalizeItem)
    .filter((item): item is Item => !!item)
    .map((item) => {
      const refreshed = item.demo ? samples.get(item.id) : undefined
      return refreshed
        ? {
            ...refreshed,
            status: item.status,
            pinned: item.pinned,
            snoozedUntil: item.snoozedUntil,
          }
        : item
    })
  const queuedActions = (Array.isArray(value.queuedActions) ? value.queuedActions : [])
    .map(normalizeQueue)
    .filter((action): action is QueuedAction => !!action)
  const theme = ['light', 'dark', 'system'].includes(String(value.theme))
    ? (value.theme as PersistedState['theme'])
    : 'system'
  const knownIds = new Set(items.map((item) => item.id))
  const contextCorrections: ContextCorrection[] = (
    Array.isArray(value.contextCorrections) ? value.contextCorrections : []
  )
    .filter(object)
    .map((entry) => ({
      leftId: string(entry.leftId, 120),
      rightId: string(entry.rightId, 120),
      decision: entry.decision,
      updatedAt: date(entry.updatedAt) || now(),
    }))
    .filter(
      (entry) =>
        knownIds.has(entry.leftId) &&
        knownIds.has(entry.rightId) &&
        entry.leftId !== entry.rightId &&
        (entry.decision === 'link' || entry.decision === 'separate'),
    ) as ContextCorrection[]
  const conflictResolutions: ConflictResolution[] = (
    Array.isArray(value.conflictResolutions) ? value.conflictResolutions : []
  )
    .filter(object)
    .map((entry) => ({
      conflictId: string(entry.conflictId, 500),
      providerId: string(entry.providerId, 100),
      externalId: string(entry.externalId, 120),
      value: string(entry.value, 100),
      updatedAt: date(entry.updatedAt) || now(),
    }))
    .filter(
      (entry) =>
        entry.conflictId.startsWith('context:') &&
        entry.providerId &&
        entry.externalId &&
        entry.value,
    )
  const contexts: Context[] = (Array.isArray(value.contexts) ? value.contexts : [])
    .filter(object)
    .map((entry) => {
      const itemRefs = Array.isArray(entry.itemRefs)
        ? entry.itemRefs
            .filter((id): id is string => typeof id === 'string' && knownIds.has(id))
            .slice(0, 50)
        : []
      return {
        id: string(entry.id, 500),
        type: 'UNKNOWN',
        canonicalTitle: string(entry.canonicalTitle, 200),
        itemRefs,
        entityRefs: [],
        temporal: { precision: 'unknown' },
        facts: [],
        conflicts: [],
        relations: [],
        requirements: [],
        confidence: 'low',
        lifecycle: 'ACTIVE',
        createdAt: now(),
        updatedAt: now(),
      } satisfies Context
    })
    .filter(
      (context) =>
        context.id.startsWith('context:') && context.canonicalTitle && context.itemRefs.length > 1,
    )
  const providerStates: Record<string, ProviderState> = Object.create(null)
  if (object(value.providerStates))
    for (const [id, state] of Object.entries(value.providerStates))
      if (
        !['__proto__', 'constructor', 'prototype'].includes(id) &&
        id.length < 100 &&
        [
          'UNCONFIGURED',
          'DISCONNECTED',
          'CONNECTING',
          'CONNECTED',
          'DEGRADED',
          'AUTH_EXPIRED',
          'OFFLINE',
          'ERROR',
        ].includes(String(state))
      )
        providerStates[id] = state as ProviderState
  const syncCursors: Record<string, SyncCursor> = Object.create(null)
  if (object(value.syncCursors))
    for (const [id, cursor] of Object.entries(value.syncCursors))
      if (
        !['__proto__', 'constructor', 'prototype'].includes(id) &&
        id.length < 100 &&
        object(cursor) &&
        typeof cursor.opaque === 'string' &&
        cursor.opaque.length < 500 &&
        date(cursor.updatedAt)
      )
        syncCursors[id] = { opaque: cursor.opaque, updatedAt: cursor.updatedAt as string }
  const modes: IntelligenceMode[] = [
    'DISABLED',
    'LOCAL_ONLY',
    'PREFER_LOCAL',
    'LOCAL_REMOTE_FALLBACK',
    'REMOTE_LOCAL_FALLBACK',
    'CUSTOM_ONLY',
  ]
  return {
    version: 3,
    items,
    contexts,
    contextCorrections,
    conflictResolutions,
    providerStates,
    syncCursors,
    queuedActions,
    theme,
    showSamples:
      typeof value.showSamples === 'boolean' ? value.showSamples : items.some((item) => item.demo),
    calendarSyncedAt: date(value.calendarSyncedAt),
    mailSyncedAt: date(value.mailSyncedAt),
    aiEnabled: value.aiEnabled === true,
    intelligenceMode: modes.includes(value.intelligenceMode as IntelligenceMode)
      ? (value.intelligenceMode as IntelligenceMode)
      : 'LOCAL_ONLY',
    remotePrivateConsent: value.remotePrivateConsent === true,
    shadowEvaluationEnabled: value.shadowEvaluationEnabled === true,
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readDB(): Promise<unknown> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}

async function writeDB(state: PersistedState): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(state, KEY)
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

export async function loadState(): Promise<PersistedState> {
  // The synchronous mirror protects edits when the tab closes before an IndexedDB transaction finishes.
  try {
    const raw = localStorage.getItem(FALLBACK)
    if (raw) return normalizePersistedState(JSON.parse(raw) as unknown)
  } catch {
    /* private mode may block storage */
  }
  try {
    const state = await readDB()
    if (state) return normalizePersistedState(state)
  } catch {
    /* IndexedDB unavailable */
  }
  return normalizePersistedState(null)
}

let writeChain = Promise.resolve()
export function saveState(state: PersistedState): Promise<void> {
  let mirrored = false
  try {
    localStorage.setItem(FALLBACK, JSON.stringify(state))
    mirrored = true
  } catch {
    try {
      localStorage.removeItem(FALLBACK)
    } catch {
      /* IndexedDB may still work */
    }
  }
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      try {
        await writeDB(state)
      } catch {
        if (!mirrored) throw new Error('No persistent storage available')
      }
    })
  return writeChain
}
