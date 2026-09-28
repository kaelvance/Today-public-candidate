import { calendarApi, normalizeCalendarEvents } from '../calendar'
import type {
  CalendarProvider,
  ConnectionState,
  ProviderCapabilities,
  ProviderPage,
} from '../ports/providers'
import { ProviderFailure } from '../ports/providers'

const mapError = (error: unknown): ProviderFailure => {
  const message = error instanceof Error ? error.message : ''
  return new ProviderFailure(
    message === 'auth_expired'
      ? 'AUTH_EXPIRED'
      : message === 'not_connected'
        ? 'AUTH_REQUIRED'
        : message === 'not_configured'
          ? 'CONFIGURATION_MISSING'
          : message === 'provider_unavailable'
            ? 'PROVIDER_UNAVAILABLE'
            : message === 'invalid_provider_response'
              ? 'INVALID_RESPONSE'
              : 'NETWORK_UNAVAILABLE',
  )
}
export class GoogleCalendarAdapter implements CalendarProvider {
  readonly id = 'calendar.google'
  capabilities(): ProviderCapabilities {
    return { read: true, incrementalSync: false, write: false }
  }
  async connectionState(): Promise<ConnectionState> {
    try {
      const status = await calendarApi.status()
      return {
        configured: status.configured,
        state: !status.configured
          ? 'UNCONFIGURED'
          : status.connection === 'expired'
            ? 'AUTH_EXPIRED'
            : status.connection === 'connected'
              ? 'CONNECTED'
              : 'DISCONNECTED',
      }
    } catch (error) {
      throw mapError(error)
    }
  }
  async connect() {
    try {
      return await calendarApi.connect()
    } catch (error) {
      throw mapError(error)
    }
  }
  async disconnect() {
    try {
      return await calendarApi.disconnect()
    } catch (error) {
      throw mapError(error)
    }
  }
  async fetchEvents(): Promise<ProviderPage> {
    try {
      const result = await calendarApi.events()
      return {
        items: normalizeCalendarEvents(result.events, result.fetchedAt),
        fetchedAt: result.fetchedAt,
        truncated: result.truncated,
      }
    } catch (error) {
      throw mapError(error)
    }
  }
}
