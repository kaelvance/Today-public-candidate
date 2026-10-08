export interface DiagnosticEvent {
  event:
    | 'context.reconcile.completed'
    | 'provider.refresh.completed'
    | 'provider.refresh.failed'
    | 'provider.sync.committed'
    | 'ai.interpret.completed'
    | 'ai.interpret.failed'
  at: string
  provider?: string
  items?: number
  examined?: number
  accepted?: number
  contexts?: number
  contextsCreated?: number
  contextsEnriched?: number
  itemsShown?: number
  candidates?: number
  conflicts?: number
  durationMs?: number
  failure?: string
}
const events: DiagnosticEvent[] = []
export function recordDiagnostic(event: DiagnosticEvent): void {
  events.push(event)
  if (events.length > 100) events.shift()
}
export function recentDiagnostics(): DiagnosticEvent[] {
  return events.map((event) => ({ ...event }))
}

/** Export an explicit allowlist, never runtime events, state, URLs or exception messages. */
export function makeSafeDiagnostics(value: {
  version: string
  storage: 'FAILED' | 'SAVING' | 'AVAILABLE'
  load: import('../storage').StorageLoadStatus
  online: boolean
  mode: 'web' | 'local'
  serviceWorker: boolean
}): string {
  return JSON.stringify(
    {
      app: 'Today',
      version: value.version,
      storage: value.storage,
      load: value.load,
      online: value.online,
      mode: value.mode,
      serviceWorker: value.serviceWorker,
    },
    null,
    2,
  )
}
