import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeTelegramUpdate, TelegramContractPreview } from './telegram-preview.mjs'
const owner = { chatId: '100', senderId: '100' }
const update = () => ({
  update_id: 1,
  message: {
    date: 1791586800,
    chat: { id: 100, type: 'private' },
    from: { id: 100, is_bot: false },
    text: '架空の質問',
  },
})
test('normalizes only an allowlisted private sender, not names/groups/bots', () => {
  assert.equal(normalizeTelegramUpdate(update(), owner).eventId, '1')
  for (const mutate of [
    (u) => (u.message.chat.type = 'group'),
    (u) => (u.message.from.id = 200),
    (u) => (u.message.from.is_bot = true),
    (u) => (u.message.text = ''),
    (u) => (u.update_id = 0.5),
  ]) {
    const u = update()
    mutate(u)
    assert.throws(() => normalizeTelegramUpdate(u, owner))
  }
})
test('requires an injected fixture and has no external network default', () =>
  assert.throws(() => new TelegramContractPreview()))
test('plain text send contract checks recipient and delivered result; ambiguous ACK stays UNKNOWN', async () => {
  let payload
  const adapter = new TelegramContractPreview(async (p) => {
      payload = p
      return { ok: true, result: { chat: { id: 100, type: 'private' }, message_id: 2 } }
    }),
    message = { adapter: 'telegram', recipient: '100', conversationId: '100', text: '架空返信' }
  assert.equal(await adapter.send(message), 'SENT')
  assert.equal(payload.parse_mode, undefined)
  assert.equal(payload.protect_content, true)
  await assert.rejects(adapter.send({ ...message, recipient: '200' }))
  assert.equal(
    await new TelegramContractPreview(async () => ({
      ok: true,
      result: { chat: { id: 200, type: 'private' } },
    })).send(message),
    'UNKNOWN',
  )
  assert.equal(
    await new TelegramContractPreview(async () => {
      throw new Error('lost ack')
    }).send(message),
    'UNKNOWN',
  )
})
