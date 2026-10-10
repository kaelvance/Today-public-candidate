/** Inert official-API contract preview. A real token/connection requires separate approval. */
export function normalizeTelegramUpdate(update, owner) {
  const message = update?.message
  if (
    !Number.isSafeInteger(update?.update_id) ||
    !message ||
    message.chat?.type !== 'private' ||
    message.from?.is_bot !== false ||
    String(message.chat.id) !== owner.chatId ||
    String(message.from.id) !== owner.senderId ||
    typeof message.text !== 'string' ||
    !message.text.trim() ||
    message.text.length > 2000 ||
    !Number.isSafeInteger(message.date)
  )
    throw new Error('telegram_denied')
  return {
    adapter: 'telegram',
    eventId: String(update.update_id),
    conversationId: String(message.chat.id),
    senderId: String(message.from.id),
    text: message.text,
    fromSelf: false,
    hops: 0,
    receivedAt: message.date * 1000,
  }
}
export class TelegramContractPreview {
  constructor(fetchFixture) {
    if (typeof fetchFixture !== 'function') throw new Error('fixture_required')
    this.fetchFixture = fetchFixture // deliberately has no real fetch default, account, or token
  }
  async send(message) {
    if (
      message.adapter !== 'telegram' ||
      !/^\d+$/.test(message.recipient) ||
      message.conversationId !== message.recipient ||
      typeof message.text !== 'string' ||
      !message.text.trim() ||
      message.text.length > 4000
    )
      throw new Error('telegram_denied')
    try {
      const response = await this.fetchFixture({
        method: 'sendMessage',
        chat_id: message.recipient,
        text: message.text,
        protect_content: true,
        disable_notification: true,
      })
      if (response.ok === false) return 'FAILED'
      if (
        response.ok === true &&
        response.result?.chat?.type === 'private' &&
        String(response.result.chat.id) === message.recipient &&
        Number.isSafeInteger(response.result.message_id)
      )
        return 'SENT'
      return 'UNKNOWN'
    } catch {
      return 'UNKNOWN'
    }
  }
}
