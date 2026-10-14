import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createTodayServer } from '../server/index.mjs'
import { launchBrowser } from './test-browser.mjs'

const output = resolve(process.argv.slice(2).filter((x) => x !== '--')[0] || '../evidence/v3-web')
assert(!output.startsWith(process.cwd() + '/'), 'Evidence must be outside source')
await mkdir(output, { recursive: true })
const require = createRequire(import.meta.url)
const axeFixture = new URL('../dist/__test_axe.js', import.meta.url)
await writeFile(axeFixture, await readFile(require.resolve('axe-core/axe.min.js')))
const record = {
  passed: false,
  flows: [],
  accessibility: [],
  externalRequests: [],
  browser: 'isolated Chromium; no live model or real provider',
}
const app = await createTodayServer({
  port: 43983,
  production: true,
  env: { TODAY_V3_OVERVIEW: '1' },
  fetchImpl: () => {
    throw new Error('external_network_forbidden')
  },
})
const base = await app.listen()
let browser
try {
  browser = await launchBrowser()
  const context = await browser.newContext({ acceptDownloads: true })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== base) {
      record.externalRequests.push(url.origin)
      await route.abort()
      return
    }
    await route.continue()
  })
  const page = await context.newPage()
  await page.goto(base)
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).fill('架空検証 Native契約タスク')
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
  await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await page.getByRole('heading', { name: '架空検証 Native契約タスク', exact: true }).waitFor()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.getByRole('heading', { name: '架空検証 Native契約タスク', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true)
  // Drain startup provider-status writes; compare the entire envelope, including revision.
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByText('接続の準備が必要', { exact: true }).nth(1).waitFor()
  await page.getByText('保存済み（利用可能な保存先）', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  async function readFixtureState() {
    return page.evaluate(async () => {
      const request = indexedDB.open('today-prototype-v1')
      const db = await new Promise((r, j) => {
        request.onsuccess = () => r(request.result)
        request.onerror = () => j(request.error)
      })
      try {
        const req = db.transaction('state').objectStore('state').get('current-v2')
        return await new Promise((r, j) => {
          req.onsuccess = () => r(req.result)
          req.onerror = () => j(req.error)
        })
      } finally {
        db.close()
      }
    })
  }
  const before = await readFixtureState()
  await page.getByRole('button', { name: 'V3 日次サマリー実験', exact: true }).click()
  await page.getByRole('checkbox', { name: '架空検証 Native契約タスク', exact: true }).waitFor()
  const generate = page.getByRole('button', { name: '選択して日次サマリーを生成' })
  assert.equal(await generate.isDisabled(), true)
  record.flows.push('explicit-consent-default-off')
  await page.getByRole('checkbox', { name: '架空検証 Native契約タスク', exact: true }).check()
  await page
    .getByRole('checkbox', { name: '選択した項目をこのMacへ5分間共有することに同意する' })
    .check()
  await generate.click()
  await page.getByRole('region', { name: '日次サマリー結果' }).waitFor()
  assert.equal(await generate.isDisabled(), true)
  record.flows.push('real-browser-origin-policy-and-projection')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'iPhoneプレビュー用JSONを書き出す' }).click()
  const download = await downloadEvent
  await download.saveAs(resolve(output, 'browser-export-fictional.json'))
  const overview = JSON.parse(
    await readFile(resolve(output, 'browser-export-fictional.json'), 'utf8'),
  )
  assert.equal(overview.tasks.length, 1)
  assert.equal(overview.counts.calendarEvents, null)
  assert.equal(overview.counts.mail, null)
  assert.equal(overview.tasks[0].title, '架空検証 Native契約タスク')
  assert.equal('description' in overview.tasks[0], false)
  assert.match(overview.expiresAt, /Z$/)
  record.flows.push('download-real-contract-without-private-fields')
  await page.addScriptTag({ url: `${base}/__test_axe.js` })
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
        })
      ).violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    )
    record.accessibility.push({ width, violations })
    assert.deepEqual(violations, [])
  }
  await page.screenshot({ path: resolve(output, 'overview-web.png'), fullPage: true })
  const keys = await page.evaluate(async () => {
    const found = []
    for (const name of await caches.keys())
      for (const key of await (await caches.open(name)).keys()) found.push(key.url)
    return found
  })
  assert.equal(
    keys.some((url) => url.includes('/v3/overview')),
    false,
  )
  record.flows.push('service-worker-does-not-persist-overview')
  await page.getByRole('button', { name: '共有データを破棄' }).click()
  await page.getByRole('region', { name: '日次サマリー結果' }).waitFor({ state: 'detached' })
  const revoked = await page.evaluate(
    async () =>
      (
        await fetch('/api/v3/overview?date=2026-10-10&tz=UTC', {
          headers: { 'X-Today-Request': '1' },
        })
      ).status,
  )
  assert.equal(revoked, 403)
  assert.deepEqual(await readFixtureState(), before)
  record.flows.push('revoke-and-core-storage-remains-identical')
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('heading', { name: '架空検証 Native契約タスク', exact: true }).waitFor()
  record.flows.push('existing-core-persists-reload')
  assert.deepEqual(record.externalRequests, [])
  record.passed = true
} finally {
  await browser?.close()
  await app.close()
  await writeFile(resolve(output, 'result.json'), JSON.stringify(record, null, 2) + '\n')
}
process.stdout.write(JSON.stringify(record, null, 2) + '\n')
