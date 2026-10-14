import { previewBackup } from '../backup'
import type { Item, PersistedState } from '../types'

export interface MigrationFinding {
  code: string
  itemId?: string
  fields?: string[]
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const validDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const empty: PersistedState = {
  version: 3,
  items: [],
  queuedActions: [],
  theme: 'system',
  showSamples: false,
}
const stampFields = ['createdAt', 'lastUpdated', 'sourceUpdatedAt']
const optionalDates = ['deadline', 'startAt', 'endAt', 'snoozedUntil', 'observedAt']
function canonical(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Pure dry-run over explicitly supplied fictional export. No storage, Core writes or external calls. */
export function inspectFixtureV2Backup({
  fixtureOnly,
  backupJSON,
  now,
}: {
  fixtureOnly: boolean
  backupJSON: string
  now: Date
}) {
  if (fixtureOnly !== true) throw new Error('fixture_opt_in_required')
  if (
    typeof backupJSON !== 'string' ||
    new TextEncoder().encode(backupJSON).length > 2_097_152 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error('invalid_fixture_input')
  let backup: unknown
  try {
    backup = JSON.parse(backupJSON)
  } catch {
    throw new Error('invalid_backup_json')
  }
  if (
    !object(backup) ||
    backup.app !== 'Today' ||
    backup.version !== 2 ||
    !validDate(backup.exportedAt) ||
    !object(backup.state) ||
    ![1, 2, 3].includes(Number(backup.state.version)) ||
    !Array.isArray(backup.state.items) ||
    backup.state.items.length > 500
  )
    throw new Error('invalid_backup')
  const state = backup.state
  const items = state.items as unknown[]
  const findings: MigrationFinding[] = []
  const ids = new Set<string>()
  if (Date.parse(backup.exportedAt as string) > now.getTime() + 30_000)
    findings.push({ code: 'FUTURE_EXPORT_TIME' })
  if (!Array.isArray(state.queuedActions) || state.queuedActions.length)
    findings.push({ code: 'PENDING_OPERATIONS_REQUIRE_RECONCILIATION' })
  const ignoredStateFields = Object.keys(state).filter(
    (key) => !['version', 'items', 'queuedActions', 'theme', 'showSamples'].includes(key),
  )
  if (ignoredStateFields.length)
    findings.push({ code: 'STATE_FIELDS_NOT_IN_MANUAL_EXPORT', fields: ignoredStateFields })
  const envelopeExtras = Object.keys(backup).filter(
    (key) => !['app', 'version', 'exportedAt', 'state'].includes(key),
  )
  if (envelopeExtras.length)
    findings.push({ code: 'UNKNOWN_EXPORT_FIELDS', fields: envelopeExtras })
  if (!['light', 'dark', 'system'].includes(String(state.theme)) || state.showSamples !== false)
    findings.push({ code: 'INVALID_EXPORT_SETTINGS' })
  for (const value of items) {
    if (
      !object(value) ||
      typeof value.id !== 'string' ||
      !/^fixture-[A-Za-z0-9_-]{1,112}$/.test(value.id)
    )
      throw new Error('fictional_item_ids_required')
    const itemId = value.id
    if (ids.has(itemId)) findings.push({ code: 'DUPLICATE_ID', itemId })
    ids.add(itemId)
    if (
      value.sourceId !== 'manual' ||
      value.demo !== false ||
      !['task', 'event'].includes(String(value.kind))
    )
      findings.push({ code: 'NON_MANUAL_EXPORT_RECORD', itemId })
    if (
      stampFields.some((key) => !validDate(value[key])) ||
      optionalDates.some((key) => value[key] !== undefined && !validDate(value[key]))
    )
      findings.push({ code: 'MISSING_OR_INVALID_SOURCE_TIME', itemId })
    if (
      stampFields.some(
        (key) => validDate(value[key]) && Date.parse(value[key] as string) > now.getTime() + 30_000,
      )
    )
      findings.push({ code: 'FUTURE_SOURCE_TIME', itemId })
    if (value.kind === 'event') {
      if (
        !validDate(value.startAt) ||
        (value.endAt !== undefined &&
          (!validDate(value.endAt) ||
            Date.parse(value.endAt as string) < Date.parse(value.startAt as string)))
      )
        findings.push({ code: 'INVALID_EVENT_RANGE', itemId })
      if (value.allDay === true)
        findings.push({ code: 'ALL_DAY_FLOATING_DATE_UNRECOVERABLE', itemId })
    }
    if (value.revision !== undefined) findings.push({ code: 'UNSUPPORTED_ITEM_REVISION', itemId })
  }
  // Do not invoke V2 normalizer on missing dates: it would invent current timestamps.
  const structurallyBlocked = findings.some((f) =>
    ['MISSING_OR_INVALID_SOURCE_TIME', 'NON_MANUAL_EXPORT_RECORD', 'DUPLICATE_ID'].includes(f.code),
  )
  let candidate: PersistedState | null = null
  if (!structurallyBlocked) {
    const preview = previewBackup(empty, backup)
    candidate = {
      ...preview.value.state,
      theme: state.theme as PersistedState['theme'],
      showSamples: false,
    }
    if (
      preview.invalid ||
      preview.duplicates ||
      preview.excluded ||
      candidate.items.length !== items.length
    )
      findings.push({ code: 'RECORD_LOSS_ON_NORMALIZATION' })
    const normalized = new Map(
      candidate.items.map((item) => [
        item.id,
        JSON.parse(JSON.stringify(item)) as Record<string, unknown>,
      ]),
    )
    for (const value of items as Record<string, unknown>[]) {
      const itemId = value.id as string,
        next = normalized.get(itemId)
      const fields = Object.keys(value).filter(
        (key) => canonical(value[key]) !== canonical(next?.[key]),
      )
      if (fields.length) findings.push({ code: 'LOSSY_NORMALIZATION', itemId, fields })
    }
  }
  return {
    fixtureOnly: true as const,
    mode: 'read_only_dry_run' as const,
    strategy: 'selected_readonly_replica' as const,
    status: findings.length ? ('BLOCKED' as const) : ('DRY_RUN_COMPATIBLE' as const),
    findings,
    sourceArchive: backupJSON, // retain EXACT input bytes; never rewrite a lossy source
    candidateState: findings.length ? null : candidate,
    retainedIds: findings.length ? [] : candidate?.items.map((item: Item) => item.id) || [],
    sourceSchemaVersion: state.version,
    gatewayDomainRevision: null,
    limitations: [
      'Manual V2 export omits provider/OAuth state, Context and queued operations.',
      'V2 export has no per-item target revision; Gateway envelope revision cannot replace it.',
      'All-day UTC instants cannot establish original floating dates.',
      'No migration into a canonical Gateway DB or live Core is performed.',
    ],
  }
}
