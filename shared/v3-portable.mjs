export const PORTABLE_FORMAT = 'today.v3.portable.v1'
export const PORTABLE_BYTES = 2_097_152
export function failPortable(code = 'invalid_portable') {
  throw new Error(code)
}
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v, keys) =>
  object(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
export function canonicalPortable(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalPortable).join(',')}]`
  if (object(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalPortable(v[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}
const instant = (s) =>
  typeof s === 'string' && /^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s))
const id = (s) => typeof s === 'string' && /^[A-Za-z0-9_.:@/-]{1,160}$/.test(s)
function boundedTree(value, depth = 0, budget = { n: 0 }) {
  if (++budget.n > 20_000 || depth > 24) failPortable('portable_too_complex')
  if (object(value)) {
    if (Object.getPrototypeOf(value) !== Object.prototype) failPortable()
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) failPortable()
      boundedTree(v, depth + 1, budget)
    }
  } else if (Array.isArray(value)) value.forEach((v) => boundedTree(v, depth + 1, budget))
  else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) failPortable()
  else if (typeof value === 'number' && !Number.isFinite(value)) failPortable()
}
export function validatePortable(input) {
  const text = JSON.stringify(input)
  if (!text || new TextEncoder().encode(text).length > PORTABLE_BYTES)
    failPortable('portable_too_large')
  input = JSON.parse(text)
  boundedTree(input)
  if (
    !exact(input, [
      'format',
      'createdAt',
      'sourceSchemaVersion',
      'scope',
      'records',
      'contexts',
      'contextCorrections',
      'excluded',
    ]) ||
    input.format !== PORTABLE_FORMAT ||
    input.sourceSchemaVersion !== 3 ||
    input.scope !== 'manual_readonly_archive' ||
    !instant(input.createdAt) ||
    !Array.isArray(input.records) ||
    input.records.length > 500 ||
    !Array.isArray(input.contexts) ||
    input.contexts.length > 250 ||
    !Array.isArray(input.contextCorrections) ||
    input.contextCorrections.length > 500 ||
    !exact(input.excluded, ['items', 'contexts', 'queuedActions']) ||
    Object.values(input.excluded).some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    failPortable()
  const seen = new Set()
  for (const entry of input.records) {
    if (
      !exact(entry, ['id', 'sourceRevision', 'allDayDates', 'record']) ||
      !id(entry.id) ||
      seen.has(entry.id) ||
      entry.sourceRevision !== null ||
      !['not_applicable', 'unknown_v2'].includes(entry.allDayDates) ||
      !object(entry.record)
    )
      failPortable()
    seen.add(entry.id)
    const r = entry.record
    const allowed = [
      'id',
      'externalId',
      'conversationId',
      'observedAt',
      'extractionMethod',
      'mailClassification',
      'kind',
      'title',
      'description',
      'originalInput',
      'source',
      'sourceId',
      'createdAt',
      'startAt',
      'endAt',
      'allDay',
      'conflict',
      'deadline',
      'importance',
      'pinned',
      'snoozedUntil',
      'requiresAction',
      'unread',
      'dependsOn',
      'confidence',
      'status',
      'syncStatus',
      'lastUpdated',
      'sourceUpdatedAt',
      'demo',
      'actions',
      'contextId',
    ]
    if (Object.keys(r).some((k) => !allowed.includes(k))) failPortable()
    if (
      r.id !== entry.id ||
      r.sourceId !== 'manual' ||
      r.demo !== false ||
      !['task', 'event'].includes(r.kind) ||
      typeof r.title !== 'string' ||
      !r.title.trim() ||
      r.title.length > 200 ||
      !['active', 'done', 'dismissed'].includes(r.status) ||
      ![1, 2, 3].includes(r.importance) ||
      !['createdAt', 'lastUpdated', 'sourceUpdatedAt'].every((k) => instant(r[k])) ||
      ['startAt', 'endAt', 'deadline', 'snoozedUntil', 'observedAt'].some(
        (k) => r[k] !== undefined && !instant(r[k]),
      ) ||
      entry.allDayDates !==
        (r.kind === 'event' && r.allDay === true ? 'unknown_v2' : 'not_applicable')
    )
      failPortable()
  }
  const contextIds = new Set()
  for (const c of input.contexts) {
    if (
      !object(c) ||
      typeof c.id !== 'string' ||
      !c.id.startsWith('context:') ||
      contextIds.has(c.id) ||
      !Array.isArray(c.itemRefs) ||
      c.itemRefs.length < 2 ||
      new Set(c.itemRefs).size !== c.itemRefs.length ||
      c.itemRefs.some((v) => !seen.has(v))
    )
      failPortable()
    contextIds.add(c.id)
  }
  for (const c of input.contextCorrections)
    if (
      !exact(c, ['leftId', 'rightId', 'decision', 'updatedAt']) ||
      !seen.has(c.leftId) ||
      !seen.has(c.rightId) ||
      c.leftId === c.rightId ||
      !['link', 'separate'].includes(c.decision) ||
      !instant(c.updatedAt)
    )
      failPortable()
  return JSON.parse(text)
}
