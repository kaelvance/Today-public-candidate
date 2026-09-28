import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const url = 'http://127.0.0.1:4184/'
const server = spawn(process.execPath, ['server/index.mjs', '--production', '--port', '4184'], {
  stdio: 'pipe',
})
let browser
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) break
    } catch {
      /* starting */
    }
    await delay(100)
  }
  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let connected = true
  let unavailable = false
  let requests = 0
  await page.route('**/api/calendar/status', (route) =>
    route.fulfill({ json: { configured: true, connection: 'connected' } }),
  )
  await page.route('**/api/calendar/events', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'survey',
            summary: 'Surveying Practice',
            status: 'confirmed',
            start: { dateTime: '2026-09-30T13:30:00+09:00' },
            end: { dateTime: '2026-09-30T15:00:00+09:00' },
          },
        ],
        fetchedAt: new Date().toISOString(),
        truncated: false,
      },
    }),
  )
  await page.route('**/api/gmail/status', (route) =>
    route.fulfill({
      json: { configured: true, connection: connected ? 'connected' : 'disconnected' },
    }),
  )
  await page.route('**/api/gmail/changes**', (route) => {
    requests += 1
    if (unavailable) return route.fulfill({ status: 503, json: { error: 'provider_unavailable' } })
    if (new URL(route.request().url()).searchParams.has('cursor'))
      return route.fulfill({
        json: { messages: [], deletedIds: [], nextCursor: '101', reset: false },
      })
    return route.fulfill({
      json: {
        messages: [
          {
            id: 'mail1',
            threadId: 'thread1',
            subject: 'Regarding 9/30 Surveying Practice',
            sender: 'Teacher <t@example.edu>',
            snippet: 'Bring field notebook',
            receivedAt: '2026-09-25T00:00:00.000Z',
            labels: ['INBOX'],
          },
        ],
        deletedIds: [],
        nextCursor: '100',
        reset: true,
      },
    })
  })
  await page.route('**/api/gmail/message**', (route) =>
    route.fulfill({
      json: {
        id: 'mail1',
        threadId: 'thread1',
        subject: 'Regarding 9/30 Surveying Practice',
        sender: 'Teacher <t@example.edu>',
        snippet: 'Bring field notebook',
        receivedAt: '2026-09-25T00:00:00.000Z',
        body: 'Bring your field notebook and writing materials.',
      },
    }),
  )
  await page.route('**/api/gmail/disconnect', (route) => {
    connected = false
    return route.fulfill({ json: { revoked: true } })
  })
  await page.goto(url)
  await page.getByRole('heading', { name: 'Surveying Practice' }).waitFor()
  await page
    .getByText('Bring your field notebook and writing materials.')
    .waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.getByText('Gmail の最終更新:').waitFor()
  await page.getByRole('dialog', { name: '設定' }).getByRole('button', { name: '閉じる' }).click()
  unavailable = true
  await page.reload()
  await page.getByText('Gmail 由来の情報は前回取得した内容です。').waitFor()
  await page.getByRole('heading', { name: 'Surveying Practice' }).waitFor()
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.getByRole('button', { name: 'Gmail の接続を解除' }).click()
  await page.getByRole('dialog', { name: '設定' }).getByRole('button', { name: '閉じる' }).click()
  await page.getByRole('heading', { name: 'Surveying Practice' }).waitFor()
  assert.ok(requests >= 2)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      flows: [
        'gmail-metadata-first',
        'gmail-calendar-context',
        'gmail-stale-cache',
        'gmail-disconnect-keeps-calendar',
      ],
      liveGoogleAccount: false,
    }),
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
