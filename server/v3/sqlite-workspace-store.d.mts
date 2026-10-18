import type { FixtureWorkspaceDocument } from '../../src/v3/gateway-contracts.js'

export type FixtureSQLiteLoadResult =
  | { state: 'FIRST_USE' | 'UNAVAILABLE' | 'CORRUPT' }
  | { state: 'PRESENT'; workspace: FixtureWorkspaceDocument }

export interface FixtureSQLiteStore {
  load(id: string, nowMs: number): Promise<FixtureSQLiteLoadResult>
  claimWriter(): Promise<object>
  releaseWriter(lease: object): Promise<void>
  compareAndSwap(
    lease: object,
    id: string,
    expectedRevision: number,
    next: FixtureWorkspaceDocument,
    nowMs: number,
  ): Promise<number>
  close(): Promise<void>
  diagnostics(): {
    mode: 'sqlite_fixture_only'
    closed: boolean
    writing: boolean
    writerActive: boolean
    writeCount: number
  }
}
export function createFixtureStoreDirectory(options: { fixtureOnly: true; parent?: string }): string
export function openFixtureSQLiteStore(options: {
  fixtureOnly: true
  directory: string
  checkpoint?: (phase: 'before_write' | 'after_write' | 'after_commit') => void | Promise<void>
}): FixtureSQLiteStore
