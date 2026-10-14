import type { PersistedState } from '../types'
import {
  PORTABLE_FORMAT,
  validatePortable,
  type PortableArchive,
} from '../../shared/v3-portable.mjs'

/** Preserve records as an archive; never normalize or apply unknown revisions to Core. */
export function makePortableArchive(state: PersistedState, now = new Date()): PortableArchive {
  const manual = state.items.filter(
    (i) => i.sourceId === 'manual' && !i.demo && ['task', 'event'].includes(i.kind),
  )
  const ids = new Set(manual.map((i) => i.id))
  const contexts = (state.contexts || []).filter(
    (c) => c.itemRefs.length >= 2 && c.itemRefs.every((id) => ids.has(id)),
  )
  return validatePortable({
    format: PORTABLE_FORMAT,
    createdAt: now.toISOString(),
    sourceSchemaVersion: 3,
    scope: 'manual_readonly_archive',
    records: manual.map((record) => ({
      id: record.id,
      sourceRevision: null,
      allDayDates: record.kind === 'event' && record.allDay ? 'unknown_v2' : 'not_applicable',
      record,
    })),
    contexts,
    contextCorrections: (state.contextCorrections || []).filter(
      (c) => ids.has(c.leftId) && ids.has(c.rightId),
    ),
    excluded: {
      items: state.items.length - manual.length,
      contexts: (state.contexts || []).length - contexts.length,
      queuedActions: state.queuedActions.length,
    },
  })
}
export function previewPortable(input: unknown) {
  const archive = validatePortable(input)
  return {
    archive,
    manualRecords: archive.records.length,
    contexts: archive.contexts.length,
    unknownRevisions: archive.records.length,
    unresolvedAllDay: archive.records.filter((r) => r.allDayDates === 'unknown_v2').length,
    coreRestoreReady: false as const,
  }
}
