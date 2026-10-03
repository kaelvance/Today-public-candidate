import { ProviderFailure, type CalendarProvider, type MailProvider } from '../ports/providers'

const unavailable = async (): Promise<never> => {
  throw new ProviderFailure('CONFIGURATION_MISSING')
}
const common = {
  capabilities: () => ({ read: false, write: false, incrementalSync: false }),
  connectionState: async () => ({ state: 'UNCONFIGURED' as const, configured: false }),
  connect: unavailable,
  disconnect: unavailable,
}

export const browserCalendar: CalendarProvider = {
  ...common,
  id: 'calendar.google',
  fetchEvents: unavailable,
}
export const browserMail: MailProvider = {
  ...common,
  id: 'mail.gmail',
  fetchChanges: unavailable,
  fetchMessage: unavailable,
}
