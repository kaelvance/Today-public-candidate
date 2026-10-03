import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative, sep, extname, join } from 'node:path'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { launchBrowser } from './test-browser.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(
  process.argv.slice(2).filter((arg) => arg !== '--')[0] || join(tmpdir(), 'today-web-qa'),
)
const distance = relative(root, output)
assert(distance === '..' || distance.startsWith(`..${sep}`), 'Evidence must be outside source')
await mkdir(output, { recursive: true })
const base = process.env.TODAY_WEB_URL || 'http://127.0.0.1:4197/Today-public-candidate/'
const scope = new URL(base)
assert(base.endsWith('/'))
const record = {
  url: base,
  hosted: !!process.env.TODAY_WEB_URL,
  passed: false,
  flows: [],
  pageErrors: [],
  networkErrors: [],
  consoleErrors: [],
  apiRequests: [],
  externalRequests: [],
  accessibility: [],
}
let server,
  browser,
  offline = false
if (!process.env.TODAY_WEB_URL) {
  const dist = resolve(root, 'dist')
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json',
    '.md': 'text/plain',
  }
  server = createServer(async (request, response) => {
    const path = new URL(request.url, base).pathname
    if (!path.startsWith(scope.pathname)) {
      response.writeHead(404).end()
      return
    }
    const name = decodeURIComponent(path.slice(scope.pathname.length)) || 'index.html'
    const file = resolve(dist, name)
    if (!file.startsWith(dist + sep)) {
      response.writeHead(404).end()
      return
    }
    try {
      const content = await readFile(file)
      response
        .writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' })
        .end(content)
    } catch {
      response.writeHead(404).end()
    }
  })
  server.listen(scope.port, '127.0.0.1')
  await once(server, 'listening')
}
const require = createRequire(import.meta.url)
async function observe(page) {
  page.on('pageerror', (error) => record.pageErrors.push(error.message))
  page.on('console', (message) => {
    if (!offline && message.type() === 'error') record.consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (!offline && response.status() >= 400)
      record.networkErrors.push({ url: response.url(), status: response.status() })
  })
  page.on('request', (request) => {
    const url = request.url()
    if (/\/api\//.test(url)) record.apiRequests.push(url)
    if (/^https?:/.test(url) && !url.startsWith(base)) record.externalRequests.push(url)
  })
}
try {
  const deployment = await (await fetch(new URL('deployment.json', base))).json()
  assert.equal(deployment.mode, 'web')
  record.deployment = deployment
  const manifest = await (await fetch(new URL('manifest.webmanifest', base))).json()
  assert.equal(new URL(manifest.start_url, new URL('manifest.webmanifest', base)).href, base)
  assert.equal(new URL(manifest.scope, new URL('manifest.webmanifest', base)).href, base)
  for (const [path, type] of [
    ['icon.svg', 'image/svg+xml'],
    ['LICENSE', null],
    ['THIRD_PARTY_NOTICES.md', null],
  ]) {
    const response = await fetch(new URL(path, base))
    assert(response.ok, `${path} must be public`)
    if (type) assert(response.headers.get('content-type').includes(type))
  }
  browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  })
  await context.addInitScript({ path: require.resolve('axe-core/axe.min.js') })
  assert.deepEqual(await context.cookies(), [])
  const page = await context.newPage()
  await observe(page)
  const response = await page.goto(base)
  assert.equal(response.status(), 200)
  await page.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  record.flows.push('anonymous-first-load-subpath-assets')
  const title = '公開確認の架空タスク'
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).fill(title)
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
  await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  record.flows.push('capture-confirm-persist-reload')
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' })
  await nav.getByRole('button', { name: 'やること', exact: true }).click()
  await page.getByRole('button', { name: '完了にする', exact: true }).click()
  await nav.getByRole('button', { name: 'ふりかえり', exact: true }).click()
  await page.getByRole('button', { name: `${title}を戻す`, exact: true }).click()
  await nav.getByRole('button', { name: 'やること', exact: true }).click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  record.flows.push('complete-review-restore')
  for (const view of ['Today', 'やること', 'カレンダー', 'ふりかえり']) {
    await nav.getByRole('button', { name: view, exact: true }).click()
    const result = await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const value = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      })
      return {
        violations: value.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        incomplete: value.incomplete.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      }
    })
    record.accessibility.push({ view, ...result })
    assert.deepEqual(result.violations, [])
  }
  record.flows.push('four-views-accessibility')
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page
    .getByText('ブラウザ版ではGoogle Calendar・Gmailに接続しません。', { exact: true })
    .waitFor()
  await page
    .getByText('ブラウザ版はAIを使わずに動作します。タスク・予定の整理はこの端末で処理します。', {
      exact: true,
    })
    .waitFor()
  assert.equal(await page.getByRole('button', { name: 'Gmail に接続する', exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: 'AI アシスト', exact: true }).count(), 0)
  await page.getByText(/公開ブラウザ版は外部AIや連携サービスへ項目を送りません/).waitFor()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '書き出す', exact: true }).click()
  const backup = await readFile(await (await downloadPromise).path())
  assert(JSON.parse(backup).state.items.some((item) => item.title === title))
  await page.keyboard.press('Escape')
  record.flows.push('honest-static-capabilities-backup-export')
  const isolated = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
  })
  const second = await isolated.newPage()
  await observe(second)
  await second.goto(base)
  await second.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  assert.equal(await second.getByRole('heading', { name: title, exact: true }).count(), 0)
  await second.getByRole('button', { name: '設定', exact: true }).click()
  await second
    .getByLabel('バックアップファイル')
    .setInputFiles({ name: 'fixture-backup.json', mimeType: 'application/json', buffer: backup })
  await second.keyboard.press('Escape')
  await second
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: 'やること', exact: true })
    .click()
  await second.getByRole('heading', { name: title, exact: true }).waitFor()
  await second.screenshot({ path: join(output, 'web-mobile.png'), fullPage: true })
  record.flows.push('mobile-isolation-backup-import')
  await isolated.close()
  await nav.getByRole('button', { name: 'やること', exact: true }).click()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  offline = true
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'web-offline.png'), fullPage: true })
  record.flows.push('scoped-service-worker-offline-reload')
  await context.setOffline(false)
  offline = false
  assert.deepEqual(record.pageErrors, [])
  assert.deepEqual(record.consoleErrors, [])
  assert.deepEqual(record.networkErrors, [])
  assert.deepEqual(record.apiRequests, [])
  assert.deepEqual(record.externalRequests, [])
  record.passed = true
} catch (error) {
  record.failure = error.stack || error.message
  throw error
} finally {
  await browser?.close()
  if (server) await new Promise((done) => server.close(done))
  await writeFile(join(output, 'public-browser-smoke.json'), JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify(record, null, 2))
}
