import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const url = 'http://127.0.0.1:4180/'
const server = spawn(process.execPath, ['server/index.mjs', '--production', '--port', '4180'], {
  stdio: 'pipe',
})
let browser

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* server starting */
    }
    await delay(100)
  }
  throw new Error('Preview did not start')
}

const localInput = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

try {
  await waitForServer()
  browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const page = await context.newPage()
  const errors = []
  const expectedOfflineErrors = []
  let offlinePhase = false
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (offlinePhase && message.text().includes('ERR_INTERNET_DISCONNECTED'))
        expectedOfflineErrors.push(message.text())
      else errors.push(message.text())
    }
  })

  await page.goto(url)
  await page.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  await page.getByRole('button', { name: /^追加$/ }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('数学プリント金曜まで')
  assert.equal(await page.locator('.capture-preview strong').innerText(), '数学プリント')
  await page.getByRole('button', { name: 'Todayに追加' }).click()
  await page.getByRole('heading', { name: '数学プリント' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '数学プリント' }).waitFor()
  await page.getByRole('button', { name: '完了にする' }).click()
  await page.getByText('完了・整理済み').waitFor()
  await page.getByRole('button', { name: '元に戻す' }).click()
  await page.getByRole('heading', { name: '数学プリント' }).waitFor()
  await page.getByRole('button', { name: /^詳細$/ }).click()
  await page.getByRole('button', { name: '明日まで保留' }).click()
  await page.getByText('あとで見る').waitFor()

  await page.getByRole('button', { name: /^追加$/ }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('病院予約')
  await page.getByRole('button', { name: '予定', exact: true }).click()
  await page
    .getByRole('textbox', { name: '開始時刻' })
    .fill(localInput(new Date(Date.now() + 2 * 3_600_000)))
  await page.getByRole('button', { name: 'Todayに追加' }).click()
  await page.getByRole('heading', { name: '病院予約' }).waitFor()
  await page.getByRole('button', { name: '詳細を見る' }).click()
  await page
    .getByRole('dialog', { name: '病院予約' })
    .getByRole('button', { name: '閉じる' })
    .first()
    .click()

  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.getByRole('button', { name: 'ダーク' }).click()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '書き出す' }).click(),
  ])
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(backup.state.items.filter((item) => !item.demo).length, 2)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'today-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await page.getByText('0件の項目を読み込みました。既存の項目は保持されています。').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '設定' }).waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '設定')
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.getByRole('button', { name: 'サンプルを表示' }).click()
  await page.getByRole('dialog', { name: '設定' }).getByRole('button', { name: '閉じる' }).click()
  await page.getByRole('button', { name: '返信案を作る' }).click()
  assert.equal(await page.getByRole('button', { name: /送信/ }).count(), 0)
  await page
    .getByRole('dialog', { name: '返信が必要なメール' })
    .getByRole('button', { name: '閉じる' })
    .first()
    .click()

  const widths = [320, 375, 390, 430, 768, 1024, 1440]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 })
    const actual = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.equal(actual, width, `Horizontal overflow at ${width}px`)
  }
  const duration = await page
    .locator('.button')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration)
  assert.ok(
    duration.includes('1e-05') || duration.includes('0.00001'),
    `Reduced motion duration: ${duration}`,
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  offlinePhase = true
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('heading', { name: '今日、必要なことだけ。' }).waitFor()
  await page.getByRole('button', { name: /^追加$/ }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('Offline note')
  await page.getByRole('button', { name: 'Todayに追加' }).click()
  await page.getByRole('textbox', { name: 'Todayを検索' }).fill('Offline note')
  await page.getByRole('heading', { name: 'Offline note' }).waitFor()
  await page.reload()
  await page.getByRole('textbox', { name: 'Todayを検索' }).fill('Offline note')
  await page.getByRole('heading', { name: 'Offline note' }).waitFor()
  await context.setOffline(false)
  offlinePhase = false

  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      flows: [
        'launch',
        'capture',
        'persist',
        'complete',
        'undo',
        'snooze',
        'event',
        'backup-round-trip',
        'keyboard-dialog',
        'sample-action-safety',
        'dark-mode',
        'responsive',
        'reduced-motion',
        'offline-startup',
        'offline-capture',
      ],
      widths,
      consoleErrors: errors.length,
    }),
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
