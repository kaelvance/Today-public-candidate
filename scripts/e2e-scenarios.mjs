import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const base = 'http://127.0.0.1:5185/'
const server = spawn(process.execPath, ['server/index.mjs', '--port', '5185'], { stdio: 'pipe' })
let browser
try {
  let ready = false
  for (let i = 0; i < 60; i += 1) {
    try {
      ready = (await fetch(base)).ok
      if (ready) break
    } catch {
      /* startup */
    }
    await delay(100)
  }
  if (!ready) throw new Error('Scenario server did not start')
  browser = await launchBrowser()
  const context = await browser.newContext({
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const navigations = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })
  // Fixed 9/25 past and 9/30 future fixtures need a stable 9/28 UI clock; timers run normally.
  await page.clock.setFixedTime(new Date('2026-09-28T07:00:00+09:00'))
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}?scenario=NORMAL_DAY`)
  await page.getByRole('heading', { name: 'Surveying Practice', exact: true }).waitFor()
  assert.equal(await page.locator('.action-item').count(), 1)
  await page.getByRole('button', { name: '詳細を見る' }).click()
  await page
    .getByRole('dialog', { name: 'Surveying Practice' })
    .getByText('持ち物・準備: field notebook、writing materials')
    .waitFor()
  await page.getByRole('button', { name: '関連なし' }).first().click()
  await page.locator('.action-item').nth(1).waitFor()
  assert.equal(await page.locator('.action-item').count(), 2)
  await page.goto(`${base}?scenario=CONFLICT_DAY`)
  await page.getByRole('heading', { name: 'Meeting', exact: true }).waitFor()
  await page.getByRole('button', { name: '詳細を見る' }).click()
  await page.getByRole('button', { name: /10:00 を採用/ }).waitFor()
  await page.getByRole('button', { name: /09:30 を採用/ }).waitFor()
  await page.getByRole('button', { name: /メール.*09:30 を採用/ }).click()
  await page.getByText('確認した時刻を採用しています。元の情報も残しています。').waitFor()
  await page
    .getByRole('dialog', { name: 'Meeting' })
    .getByRole('button', { name: '閉じる' })
    .first()
    .click()
  await page.getByText('9/30 9:30から').waitFor()
  await page.goto(`${base}?scenario=AMBIGUOUS_CONTEXT`)
  await page.getByRole('heading', { name: 'Math assignment due Friday 9/25' }).waitFor()
  await page.getByText('あとで見る').click()
  await page.getByRole('button', { name: /Math class/ }).waitFor()
  await page.goto(`${base}?scenario=GMAIL_FAILURE`)
  await page.getByRole('heading', { name: 'Surveying Practice', exact: true }).waitFor()
  // The calendar fixture is 10:00 JST = 01:00 UTC. Mail input denotes 09:30 local time.
  const utc = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 390, height: 844 } })
  const utcPage = await utc.newPage()
  await utcPage.clock.setFixedTime(new Date('2026-09-28T07:00:00+09:00'))
  utcPage.on('pageerror', (error) => errors.push(error.message))
  await utcPage.goto(`${base}?scenario=CONFLICT_DAY`)
  await utcPage.getByRole('heading', { name: 'Meeting', exact: true }).waitFor()
  await utcPage.getByRole('button', { name: '詳細を見る' }).click()
  await utcPage.getByRole('button', { name: /01:00 を採用/ }).waitFor()
  await utcPage.getByRole('button', { name: /メール.*09:30 を採用/ }).click()
  await utcPage.getByText('確認した時刻を採用しています。元の情報も残しています。').waitFor()
  await utcPage
    .getByRole('dialog', { name: 'Meeting' })
    .getByRole('button', { name: '閉じる' })
    .first()
    .click()
  await utcPage.getByText('9/30 9:30から').waitFor()
  await utc.close()
  assert.deepEqual(
    navigations,
    [
      `${base}?scenario=NORMAL_DAY`,
      `${base}?scenario=CONFLICT_DAY`,
      `${base}?scenario=AMBIGUOUS_CONTEXT`,
      `${base}?scenario=GMAIL_FAILURE`,
    ],
    'Development dependency optimization must not reload an active scenario',
  )
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      flows: [
        'context-compression',
        'source-recovery',
        'user-separation',
        'time-conflict',
        'false-merge-avoidance',
        'provider-failure-isolation',
        'utc-local-clock-correction',
      ],
      consoleErrors: errors.length,
      liveProviders: false,
    }),
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
