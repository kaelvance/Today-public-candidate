import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const url = 'http://127.0.0.1:4181/'
const server = spawn(process.execPath, ['server/index.mjs', '--production', '--port', '4181'], {
  stdio: 'pipe',
})
let browser
async function ready() {
  for (let index = 0; index < 50; index++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* starting */
    }
    await delay(100)
  }
  throw new Error('Integration preview did not start')
}

try {
  await ready()
  browser = await launchBrowser()
  const calendarContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const calendarPage = await calendarContext.newPage()
  const pageErrors = []
  calendarPage.on('pageerror', (error) => pageErrors.push(error.message))
  let connection = 'connected'
  let calendarFails = false
  await calendarPage.route('**/api/calendar/status', (route) =>
    route.fulfill({ json: { configured: true, connection } }),
  )
  await calendarPage.route('**/api/calendar/events', (route) =>
    calendarFails
      ? route.fulfill({ status: 503, json: { error: 'provider_unavailable' } })
      : route.fulfill({
          json: {
            events: [
              {
                id: 'real-event-1',
                status: 'confirmed',
                summary: '歯医者',
                start: { dateTime: new Date(Date.now() + 2 * 3_600_000).toISOString() },
                end: { dateTime: new Date(Date.now() + 3 * 3_600_000).toISOString() },
              },
            ],
            fetchedAt: new Date().toISOString(),
            truncated: false,
          },
        }),
  )
  await calendarPage.route('**/api/calendar/disconnect', (route) => {
    connection = 'disconnected'
    return route.fulfill({ json: { revoked: true } })
  })
  await calendarPage.goto(url)
  await calendarPage.getByRole('heading', { name: '歯医者' }).waitFor()
  await calendarPage.getByRole('button', { name: /^追加$/ }).click()
  await calendarPage.getByRole('textbox', { name: 'やること・予定' }).fill('ノートを買う')
  await calendarPage.getByRole('button', { name: 'Todayに追加' }).click()
  await calendarPage.getByRole('heading', { name: 'ノートを買う' }).waitFor()
  calendarFails = true
  await calendarPage.reload()
  await calendarPage.locator('.calendar-notice').waitFor()
  await calendarPage.getByRole('heading', { name: '歯医者' }).waitFor()
  await calendarPage.getByRole('heading', { name: 'ノートを買う' }).waitFor()
  await calendarPage.getByRole('button', { name: /^設定$/ }).click()
  await calendarPage.getByRole('button', { name: '接続を解除' }).click()
  await calendarPage
    .getByRole('dialog', { name: '設定' })
    .getByRole('button', { name: '閉じる' })
    .click()
  await calendarPage.getByRole('heading', { name: '歯医者' }).waitFor({ state: 'hidden' })
  await calendarPage.getByRole('heading', { name: 'ノートを買う' }).waitFor()
  assert.deepEqual(pageErrors, [])
  await calendarContext.close()

  const aiContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const aiPage = await aiContext.newPage()
  const aiErrors = []
  aiPage.on('pageerror', (error) => aiErrors.push(error.message))
  let aiCalls = 0
  let aiResponse = {
    intent: 'task',
    title: 'レポート提出',
    date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    importance: 2,
    confidence: 'medium',
  }
  await aiPage.route('**/api/ai/status', (route) => route.fulfill({ json: { configured: true } }))
  await aiPage.route('**/api/ai/interpret', (route) => {
    aiCalls += 1
    return route.fulfill({ json: aiResponse })
  })
  await aiPage.goto(url)
  await aiPage.getByRole('button', { name: /^設定$/ }).click()
  await aiPage.getByRole('button', { name: 'オン' }).click()
  await aiPage.getByRole('dialog', { name: '設定' }).getByRole('button', { name: '閉じる' }).click()
  await aiPage.getByRole('button', { name: /^追加$/ }).click()
  await aiPage.getByRole('textbox', { name: 'やること・予定' }).fill('来週までにレポート')
  await aiPage.locator('.capture-preview strong').getByText('レポート提出').waitFor()
  assert.equal(aiCalls, 1)
  await aiPage.getByRole('button', { name: 'Todayに追加' }).click()
  await aiPage.getByRole('heading', { name: 'レポート提出' }).waitFor()

  aiResponse = {
    intent: 'task',
    title: 'Bad',
    date: 'next week',
    importance: 2,
    confidence: 'high',
  }
  await aiPage.getByRole('button', { name: /^追加$/ }).click()
  await aiPage.getByRole('textbox', { name: 'やること・予定' }).fill('来月に企画書提出')
  await aiPage.getByText('通常の入力解析で追加できます').waitFor()
  assert.equal(
    await aiPage.getByRole('textbox', { name: 'やること・予定' }).inputValue(),
    '来月に企画書提出',
  )
  await aiPage.getByRole('button', { name: 'Todayに追加' }).click()
  await aiPage.getByRole('heading', { name: '来月に企画書提出' }).waitFor()
  assert.equal(aiCalls, 2)

  await aiPage.getByRole('button', { name: /^設定$/ }).click()
  await aiPage.getByRole('button', { name: 'オフ' }).click()
  await aiPage.getByRole('dialog', { name: '設定' }).getByRole('button', { name: '閉じる' }).click()
  await aiPage.getByRole('button', { name: /^追加$/ }).click()
  await aiPage.getByRole('textbox', { name: 'やること・予定' }).fill('来月に買い物')
  await aiPage.waitForTimeout(400)
  assert.equal(aiCalls, 2)
  assert.deepEqual(aiErrors, [])
  await aiContext.close()
  console.log(
    JSON.stringify({
      passed: true,
      flows: [
        'calendar-connected',
        'calendar-stale-cache',
        'calendar-disconnect-preserves-local',
        'ai-enabled',
        'malformed-ai-fallback',
        'ai-disabled',
      ],
      liveGoogleAccount: false,
      liveAIProvider: false,
    }),
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
