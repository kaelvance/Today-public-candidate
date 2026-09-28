import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const url = 'http://127.0.0.1:4185/'
const server = spawn(process.execPath, ['server/index.mjs', '--production', '--port', '4185'], {
  stdio: 'pipe',
})
let browser
try {
  let ready = false
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) {
        ready = true
        break
      }
    } catch {
      /* Starting. */
    }
    await delay(100)
  }
  assert(ready, 'Production server started')
  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const errors = [],
    external = [],
    inference = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (!request.url().startsWith(url) && !request.url().startsWith('data:'))
      external.push(request.url())
    if (/\/api\/(?:ai\/interpret|.*model\/(?:load|complete))/.test(request.url()))
      inference.push(request.url())
  })
  await page.goto(url)
  await page.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    await caches.open('unrelated-example-app')
    await caches.open('today-v1-8-static-1')
  })
  // Force re-activation in a fresh worker, proving the cache deletion predicate.
  await page.evaluate(async () => {
    for (const worker of await navigator.serviceWorker.getRegistrations()) await worker.unregister()
  })
  await page.reload()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.waitForFunction(async () => !(await caches.keys()).includes('today-v1-8-static-1'))
  assert((await page.evaluate(() => caches.keys())).includes('unrelated-example-app'))
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.getByRole('combobox', { name: '処理方法' }).selectOption('DISABLED')
  await page.getByText('AIは無効です。通常のTodayは引き続き利用できます。').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^追加$/ }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('Release fixture task')
  await page.getByRole('button', { name: 'Todayに追加' }).click()
  await page.getByRole('heading', { name: 'Release fixture task' }).waitFor()
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('today-prototype-v1', 1)
        request.onsuccess = () => {
          const db = request.result
          const get = db.transaction('state').objectStore('state').get('current')
          get.onsuccess = () => {
            resolve(get.result?.items?.some((item) => item.title === 'Release fixture task'))
            db.close()
          }
        }
        request.onerror = () => resolve(false)
      }),
  )
  await page.evaluate(() => localStorage.setItem('today-prototype-state-v1', '{broken'))
  await page.reload()
  await page.getByRole('heading', { name: 'Release fixture task' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('today-prototype-state-v1')).intelligenceMode,
    ),
    'DISABLED',
  )
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not-json'),
  })
  await page.getByText('バックアップを読み込めませんでした。データは変更していません。').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: 'Release fixture task' }).waitFor()
  // Online navigation must replace a corrupt cached shell.
  await page.evaluate(async () => {
    const cache = await caches.open('today-v1-9-static-1')
    await cache.put(
      '/index.html',
      new Response('<html><body>corrupt shell</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    )
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Release fixture task' }).waitFor()
  await page.waitForFunction(async () =>
    (await (await caches.match('/index.html')).text()).includes('/assets/'),
  )
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('heading', { name: 'Release fixture task' }).waitFor()
  await context.setOffline(false)
  await page.reload()
  await page.getByRole('heading', { name: 'Release fixture task' }).waitFor()
  await page.evaluate(async () => {
    for (const worker of await navigator.serviceWorker.getRegistrations()) await worker.unregister()
    for (const key of await caches.keys()) if (key.startsWith('today-v1-')) await caches.delete(key)
    localStorage.clear()
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('today-prototype-v1')
      request.onsuccess = resolve
      request.onerror = reject
      request.onblocked = reject
    })
  })
  await page.reload()
  await page.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Release fixture task' }).count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  assert.deepEqual(inference, [])
  console.log(
    JSON.stringify({
      passed: true,
      flows: [
        'empty-zero-key-no-model',
        'unrelated-cache-preserved',
        'old-cache-removed',
        'ai-disabled-no-inference',
        'corrupt-mirror-idb-recovery',
        'invalid-backup-preserves-state',
        'corrupt-shell-online-recovery',
        'offline-reconnect',
        'documented-browser-reset',
      ],
      externalRequests: 0,
      inferenceCalls: 0,
      pageErrors: 0,
    }),
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
