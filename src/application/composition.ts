import { GoogleCalendarAdapter } from '../adapters/google-calendar'
import { LazyGmailProvider } from '../adapters/lazy-gmail'
import { NullAIProvider, OpenAIAdapter } from '../adapters/ai-providers'
import { createProviderRegistry } from '../ports/providers'
import { createTodayApplication } from './today'
import { loadState, normalizePersistedState, saveState } from '../storage'
import type { PersistedState } from '../types'
import { recentDiagnostics } from './diagnostics'
import { IntelligenceRouter } from '../intelligence/router'
import { TodayLocalProvider, ConnectedModelProvider } from '../intelligence/providers'
import { LocalResourceGovernor } from '../intelligence/runtime'
import { HttpLocalRuntime } from '../intelligence/http-local-runtime'
import { capabilities, defaultPolicy, type IntelligenceProvider } from '../intelligence/types'
import { HttpRemoteTransport } from '../intelligence/http-remote-transport'
import { HttpOllamaTransport } from '../intelligence/http-ollama-transport'
import { todayModelAlpha } from '../intelligence/registry'

/** Only this module chooses concrete providers for the browser application. */
export const providerRegistry = createProviderRegistry({
  calendar: new GoogleCalendarAdapter(),
  mail: new LazyGmailProvider(),
  ai: new NullAIProvider(),
})
export const localRuntime = new HttpLocalRuntime()
const intelligenceProviders: IntelligenceProvider[] = [
  new TodayLocalProvider(
    'intelligence.today-local',
    todayModelAlpha.id,
    localRuntime,
    new LocalResourceGovernor(),
  ),
]
export const intelligenceRouter = new IntelligenceRouter(intelligenceProviders, {
  ...defaultPolicy,
})
export async function configureOptionalRemoteIntelligence(): Promise<void> {
  if (scenarioActive) return
  if (!intelligenceProviders.some((provider) => provider.id === 'intelligence.local-ollama'))
    try {
      const response = await fetch('/api/ollama-model/status', { credentials: 'same-origin' })
      const status = (await response.json()) as { available?: boolean; modelId?: string }
      if (response.ok && status.available && status.modelId)
        intelligenceProviders.push(
          new ConnectedModelProvider(
            'intelligence.local-ollama',
            status.modelId,
            'LOCAL_BALANCED',
            new HttpOllamaTransport(),
            capabilities,
          ),
        )
    } catch {
      /* Ollama is optional. */
    }
  if (intelligenceProviders.some((provider) => provider.id === 'intelligence.remote-generic'))
    return
  try {
    const response = await fetch('/api/remote-model/status', { credentials: 'same-origin' })
    const status = (await response.json()) as { available?: boolean; modelId?: string }
    if (response.ok && status.available && status.modelId)
      intelligenceProviders.push(
        new ConnectedModelProvider(
          'intelligence.remote-generic',
          status.modelId,
          'CUSTOM',
          new HttpRemoteTransport(),
          capabilities,
        ),
      )
  } catch {
    /* Zero-key operation remains available. */
  }
}
export const todayApp = createTodayApplication(
  providerRegistry,
  { now: () => new Date() },
  intelligenceRouter,
)
const scenarioName = import.meta.env.DEV
  ? new URLSearchParams(location.search).get('scenario')
  : null
const scenarios = new Set([
  'NORMAL_DAY',
  'BUSY_DAY',
  'CONFLICT_DAY',
  'OFFLINE_DAY',
  'AI_FAILURE',
  'GMAIL_FAILURE',
  'AUTH_EXPIRED',
  'AMBIGUOUS_CONTEXT',
])
const scenarioActive = !!scenarioName && scenarios.has(scenarioName)
export const scenarioModeLabel = scenarioActive ? `検証用データ: ${scenarioName}` : null
if (import.meta.env.DEV)
  (window as typeof window & { todayDiagnostics?: typeof recentDiagnostics }).todayDiagnostics =
    recentDiagnostics

export async function loadInitialState(): Promise<PersistedState> {
  if (!scenarioActive) return loadState()
  const { createScenarioApplication } = await import('../evaluation/scenarios')
  const scenario = createScenarioApplication(
    scenarioName as Parameters<typeof createScenarioApplication>[0],
  )
  activeApplication = scenario.app
  let items = scenario.data.local
  try {
    items = (await activeApplication.refreshCalendar(items)).items
  } catch {
    /* Keep local mock items. */
  }
  try {
    items = (await activeApplication.refreshMail(items)).items
  } catch {
    /* Keep unaffected sources. */
  }
  return normalizePersistedState({
    version: 3,
    items,
    contexts: activeApplication.reconcile(items).contexts,
    queuedActions: [],
    theme: 'system',
    showSamples: false,
    aiEnabled: scenarioName === 'AI_FAILURE',
  })
}
export const saveApplicationState = (state: PersistedState) =>
  scenarioActive ? Promise.resolve() : saveState(state)

export async function configureOptionalAI(): Promise<void> {
  if (scenarioActive) return
  // The server capability check selects the adapter without ever exposing credentials.
  try {
    const result = await fetch('/api/ai/status', { credentials: 'same-origin' })
    if (!result.ok || (await result.json())?.configured !== true) return
    const available = createProviderRegistry({
      calendar: providerRegistry.calendar(),
      mail: providerRegistry.mail(),
      ai: new OpenAIAdapter(),
    })
    activeApplication = createTodayApplication(
      available,
      { now: () => new Date() },
      intelligenceRouter,
    )
  } catch {
    /* Null provider remains active. */
  }
}
export let activeApplication = todayApp
