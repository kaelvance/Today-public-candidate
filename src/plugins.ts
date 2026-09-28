import type { Item, ItemAction } from './types'

export interface PluginPermissions {
  read: boolean
  write: boolean
  communicate: boolean
}

export interface Plugin {
  id: string
  name: string
  capabilities: readonly string[]
  permissions: PluginPermissions
  connect(): Promise<void>
  disconnect(): Promise<void>
  fetchItems(items: Item[]): Promise<Item[]>
  fetchChanges(since?: string): Promise<Item[]>
  getAvailableActions(item: Item): ItemAction[]
  executeAction(action: ItemAction, item: Item, idempotencyKey: string): Promise<void>
}

export function assertPluginAction(plugin: Plugin | undefined, action: ItemAction): void {
  if (!plugin || action.plugin !== plugin.id) throw new Error('plugin_unavailable')
  if (!plugin.permissions.read) throw new Error('permission_denied')
  if (action.riskLevel >= 3 && !plugin.permissions.communicate) throw new Error('permission_denied')
  if (action.riskLevel >= 2 && action.riskLevel < 3 && !plugin.permissions.write)
    throw new Error('permission_denied')
}

function localPlugin(id: string, name: string): Plugin {
  return {
    id,
    name,
    capabilities: ['read', 'local-actions'],
    permissions: { read: true, write: false, communicate: false },
    async connect() {},
    async disconnect() {},
    async fetchItems(items) {
      return items.filter((item) => item.sourceId === id)
    },
    async fetchChanges() {
      return []
    },
    getAvailableActions(item) {
      return item.actions.filter((action) => action.riskLevel <= 1 && action.plugin === id)
    },
    async executeAction(action) {
      throw new Error(`remote_action_unavailable:${action.id}`)
    },
  }
}

export const plugins: Record<string, Plugin> = {
  manual: localPlugin('manual', '手動で追加'),
  'google-calendar': localPlugin('google-calendar', 'Google Calendar'),
  'mock-classroom': localPlugin('mock-classroom', 'Classroom サンプル'),
  'mock-calendar': localPlugin('mock-calendar', 'Calendar サンプル'),
  'mock-email': localPlugin('mock-email', 'Email サンプル'),
  context: localPlugin('context', '関連する情報'),
  'mail.gmail': localPlugin('mail.gmail', 'メール'),
  'calendar.mock': localPlugin('calendar.mock', '検証用の予定'),
  'mail.mock': localPlugin('mail.mock', '検証用のメール'),
  'sample.reading-club': localPlugin('sample.reading-club', '図書館サンプル'),
}
