import {
  GATEWAY_LIMITS,
  boundedJSON,
  reject,
  revision,
  stableJSON,
  storedWorkspace,
  workspaceId,
} from './gateway-contract.mjs'

// Test-only storage. It survives a Mock Runtime restart while this object lives, not process exit.
export function createMockWorkspaceStore({ fixtureOnly } = {}) {
  if (fixtureOnly !== true) reject('mock_opt_in_required')
  const entries = new Map()
  const readFaults = new Map()
  let writer = null
  let writing = false
  let nextFailure = null
  let nextPause = null
  let writeCount = 0

  const load = async (id, nowMs) => {
    workspaceId(id)
    if (readFaults.get(id) === 'unavailable') return { state: 'UNAVAILABLE' }
    if (readFaults.get(id) === 'corrupt') return { state: 'CORRUPT' }
    const encoded = entries.get(id)
    if (encoded === undefined) return { state: 'FIRST_USE' }
    try {
      return { state: 'PRESENT', workspace: storedWorkspace(boundedJSON(encoded), id, nowMs) }
    } catch {
      return { state: 'CORRUPT' }
    }
  }
  return {
    async claimWriter() {
      if (writer) reject('writer_already_active', 409)
      writer = Object.freeze({})
      return writer
    },
    async releaseWriter(lease) {
      if (lease !== writer || writing) reject('writer_not_drained', 409)
      writer = null
    },
    load,
    async compareAndSwap(lease, id, expectedRevision, next, nowMs) {
      if (lease !== writer || !writer) reject('writer_required', 403)
      if (writing) reject('concurrent_store_write', 409)
      writing = true
      try {
        const current = await load(id, nowMs)
        if (current.state === 'UNAVAILABLE') reject('storage_unavailable', 503)
        if (current.state === 'CORRUPT') reject('storage_corrupt', 503)
        if (current.state === 'FIRST_USE' && entries.size >= GATEWAY_LIMITS.workspaces)
          reject('workspace_capacity_reached', 429)
        const actualRevision = current.state === 'FIRST_USE' ? 0 : current.workspace.revision
        if (revision(expectedRevision) !== actualRevision) reject('revision_conflict', 409)
        const validated = storedWorkspace(next, id, nowMs)
        if (validated.revision <= actualRevision) reject('revision_conflict', 409)
        const encoded = stableJSON(validated)
        if (Buffer.byteLength(encoded) > GATEWAY_LIMITS.backupBytes) reject('input_too_large', 413)
        const pause = nextPause
        nextPause = null
        if (pause) {
          pause.started()
          await pause.wait
        }
        const failure = nextFailure
        nextFailure = null
        if (failure === 'before') reject('storage_write_failed', 503)
        // The workspace and idempotency receipts are one atomic entry in this Mock.
        entries.set(id, encoded)
        writeCount += 1
        if (failure === 'after') reject('commit_outcome_unknown', 503)
        return validated.revision
      } finally {
        writing = false
      }
    },
    // Fault injection controls are never exposed as a device or HTTP interface.
    faults: {
      injectRawEntry(id, text) {
        workspaceId(id)
        if (writer && writing) reject('fixture_write_in_progress', 409)
        if (typeof text !== 'string' || Buffer.byteLength(text) > GATEWAY_LIMITS.backupBytes)
          reject('input_too_large', 413)
        if (!entries.has(id) && entries.size >= GATEWAY_LIMITS.workspaces)
          reject('workspace_capacity_reached', 429)
        entries.set(id, text)
      },
      setReadFault(id, fault) {
        workspaceId(id)
        if (![null, 'unavailable', 'corrupt'].includes(fault)) reject('invalid_input')
        if (fault === null) readFaults.delete(id)
        else readFaults.set(id, fault)
      },
      failNextWrite(point) {
        if (!['before', 'after'].includes(point)) reject('invalid_input')
        nextFailure = point
      },
      pauseNextWrite() {
        if (nextPause) reject('pause_already_pending')
        let start, release
        const started = new Promise((resolve) => {
          start = resolve
        })
        const wait = new Promise((resolve) => {
          release = resolve
        })
        nextPause = { started: start, wait }
        return { started, release }
      },
    },
    diagnostics: () => ({ entries: entries.size, writeCount, writing, writerActive: !!writer }),
  }
}
