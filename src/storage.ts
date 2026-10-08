import { demoItems } from './data'
import type { ConflictResolution, Context, ContextCorrection } from './domain/model'
import type { ProviderState, SyncCursor } from './ports/providers'
import type { Item, ItemAction, PersistedState, QueuedAction } from './types'
import type { IntelligenceMode } from './intelligence/types'

const DB = 'today-prototype-v1'
const STORE = 'state'
// Separate the new writer protocol from older, already-open tabs that do not use locks.
const KEY = 'current-v2'
const FALLBACK = 'today-prototype-state-v2'
const LEGACY_KEY = 'current'
const LEGACY_FALLBACK = 'today-prototype-state-v1'
const WRITER_LOCK = 'today-prototype-v1/state/writer'
let writerPermit: symbol | null = null
let revision = 0
let loaded = false
export type StorageLoadStatus = 'FIRST_USE' | 'READY' | 'RECOVERED' | 'UNAVAILABLE' | 'CORRUPT'
let loadStatus: StorageLoadStatus = 'UNAVAILABLE'
export const storageLoadStatus = () => loadStatus

export class StorageLoadError extends Error {
  constructor(readonly status: 'UNAVAILABLE' | 'CORRUPT') {
    super(`storage_${status.toLowerCase()}`)
  }
}
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
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('storage_database_unavailable'))
    }
    const timer = setTimeout(fail, 3000)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      clearTimeout(timer)
      if (settled) return request.result.close()
      settled = true
      resolve(request.result)
    }
    request.onerror = fail
    request.onblocked = fail
  })
}

async function readDB(key = KEY): Promise<unknown> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(key)
      transaction.oncomplete = () => {
        db.close()
        resolve(request.result)
      }
      transaction.onabort = transaction.onerror = () => {
        db.close()
        reject(new Error('storage_read_failed'))
      }
    } catch {
      db.close()
      reject(new Error('storage_read_failed'))
    }
  })
}

async function writeDB(state: PersistedState & { persistenceRevision: number }): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      db.close()
      if (error) reject(error)
      else resolve()
    }
    try {
      const transaction = db.transaction(STORE, 'readwrite')
      // Register before put: an explicit abort has no error event in some browsers.
      transaction.oncomplete = () => finish()
      transaction.onabort = () => finish(new Error('storage_write_aborted'))
      transaction.onerror = () => {
        // An unhandled IDB error aborts the transaction. Drain through onabort.
      }
      transaction.objectStore(STORE).put(state, KEY)
    } catch {
      finish(new Error('storage_write_failed'))
    }
  })
}

type Copy =
  | { kind: 'valid'; state: PersistedState; revision: number }
  | { kind: 'absent' | 'corrupt' | 'unavailable' }

function inspectCopy(value: unknown): Copy {
  if (value === undefined) return { kind: 'absent' }
  if (
    !object(value) ||
    ![1, 2, 3].includes(Number(value.version)) ||
    typeof value.version !== 'number' ||
    !Array.isArray(value.items) ||
    value.items.some((item) => !normalizeItem(item)) ||
    ['queuedActions', 'contexts', 'contextCorrections', 'conflictResolutions'].some(
      (key) => value[key] !== undefined && !Array.isArray(value[key]),
    ) ||
    (value.persistenceRevision !== undefined &&
      (!Number.isSafeInteger(value.persistenceRevision) || Number(value.persistenceRevision) < 0))
  )
    return { kind: 'corrupt' }
  return {
    kind: 'valid',
    state: normalizePersistedState(value),
    revision: Number(value.persistenceRevision || 0),
  }
}

async function readCopies(mirror: string, key: string): Promise<Copy[]> {
  let local: Copy
  try {
    const raw = localStorage.getItem(mirror)
    try {
      local = raw === null ? { kind: 'absent' } : inspectCopy(JSON.parse(raw))
    } catch {
      local = { kind: 'corrupt' }
    }
  } catch {
    local = { kind: 'unavailable' }
  }
  let database: Copy
  try {
    database = inspectCopy(await readDB(key))
  } catch {
    database = { kind: 'unavailable' }
  }
  return [local, database]
}

export async function loadState(): Promise<PersistedState> {
  loaded = false
  const current = await readCopies(FALLBACK, KEY)
  const choose = (copies: Copy[], migration = false): PersistedState | null => {
    const valid = copies
      .filter((copy): copy is Extract<Copy, { kind: 'valid' }> => copy.kind === 'valid')
      .sort((a, b) => b.revision - a.revision)
    if (!valid.length) return null
    revision = valid[0].revision
    loadStatus =
      migration || copies.some((copy) => copy.kind === 'corrupt' || copy.kind === 'unavailable')
        ? 'RECOVERED'
        : 'READY'
    loaded = true
    return valid[0].state
  }
  const fail = (copies: Copy[]): never => {
    loadStatus = copies.some((copy) => copy.kind === 'unavailable') ? 'UNAVAILABLE' : 'CORRUPT'
    throw new StorageLoadError(loadStatus)
  }
  const selected = choose(current)
  if (selected) return selected
  // Do not resurrect an old snapshot when a newer slot exists but cannot be read.
  if (current.some((copy) => copy.kind !== 'absent')) return fail(current)
  const legacy = await readCopies(LEGACY_FALLBACK, LEGACY_KEY)
  const migrated = choose(legacy, true)
  if (migrated) return migrated
  if (legacy.some((copy) => copy.kind !== 'absent')) return fail(legacy)
  revision = 0
  loaded = true
  loadStatus = 'FIRST_USE'
  return normalizePersistedState(null)
}

let writeChain = Promise.resolve()

/** Cooperating tabs use one editor. Holding the lock precedes loading any application state. */
export async function holdStateWriter(signal: AbortSignal, acquired: () => void): Promise<void> {
  if (!navigator.locks?.request) throw new Error('storage_lock_unavailable')
  await navigator.locks.request(WRITER_LOCK, { mode: 'exclusive', signal }, async (lock) => {
    if (!lock || signal.aborted) return
    const permit = Symbol('state-writer')
    writerPermit = permit
    loaded = false
    try {
      await new Promise<void>((release) => {
        signal.addEventListener(
          'abort',
          () => {
            if (writerPermit === permit) writerPermit = null
            release()
          },
          { once: true },
        )
        acquired()
      })
    } finally {
      if (writerPermit === permit) writerPermit = null
      // Drain accepted writes before a surviving document hands ownership to another tab.
      await writeChain.catch(() => {})
    }
  })
}

export function saveState(state: PersistedState): Promise<void> {
  if (!writerPermit) return Promise.reject(new Error('storage_writer_required'))
  if (!loaded) return Promise.reject(new Error('storage_load_required'))
  if (revision >= Number.MAX_SAFE_INTEGER)
    return Promise.reject(new Error('storage_revision_limit'))
  const snapshot = { ...state, persistenceRevision: ++revision }
  let mirrored = false
  try {
    localStorage.setItem(FALLBACK, JSON.stringify(snapshot))
    mirrored = true
  } catch {
    // Preserve the last good copy. Revision selects a newer successful IDB write.
  }
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      try {
        await writeDB(snapshot)
      } catch {
        if (!mirrored) throw new Error('No persistent storage available')
      }
    })
  return writeChain
}
