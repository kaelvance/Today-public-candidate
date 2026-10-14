export const PORTABLE_FORMAT: 'today.v3.portable.v1'
export const PORTABLE_BYTES: number
export interface PortableArchive {
  format: typeof PORTABLE_FORMAT
  createdAt: string
  sourceSchemaVersion: 3
  scope: 'manual_readonly_archive'
  records: {
    id: string
    sourceRevision: null
    allDayDates: 'not_applicable' | 'unknown_v2'
    record: import('../src/types.js').Item
  }[]
  contexts: import('../src/domain/model.js').Context[]
  contextCorrections: import('../src/domain/model.js').ContextCorrection[]
  excluded: { items: number; contexts: number; queuedActions: number }
}
export function failPortable(code?: string): never
export function canonicalPortable(value: unknown): string
export function validatePortable(value: unknown): PortableArchive
