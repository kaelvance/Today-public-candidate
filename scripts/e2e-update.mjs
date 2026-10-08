import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, relative, sep } from 'node:path'
import { launchBrowser } from './test-browser.mjs'

const output = resolve(
  process.argv.slice(2).filter((arg) => arg !== '--')[0] || '../evidence/update',
)
assert(relative(process.cwd(), output).startsWith(`..${sep}`), 'Evidence outside source')
await mkdir(output, { recursive: true })
// Byte-for-byte fixture from public commit 25edcf88f28e577919eeb4bdd505722a6d4afdd0.
const oldWorker = await readFile('scripts/fixtures/sw-v2.0.1.js', 'utf8')
const newWorker = await readFile('public/sw.js', 'utf8')
let stage = 'old'
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  response.setHeader('Cache-Control', 'no-store')
  if (path.endsWith('sw.js')) {
    response.setHeader('content-type', 'text/javascript')
    response.end(
      `self.TODAY_BUILD_ID=${JSON.stringify(stage)}; self.TODAY_STATIC_ASSETS=${JSON.stringify(stage === 'broken' ? ['missing.js'] : [])};\n${stage === 'old' ? oldWorker : newWorker}`,
    )
  } else if (path.endsWith('missing.js') || path.endsWith('http-error'))
    response.writeHead(404).end('fixture HTTP error')
  else if (path.endsWith('index.html') || path.endsWith('/')) {
    response.setHeader('content-type', 'text/html')
    response.end(
      `<!doctype html><title>Update fixture ${stage}</title><h1>${stage}</h1><textarea aria-label="fictional draft"></textarea>`,
    )
  } else response.end('fictional asset')
})
await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
const base = `http://127.0.0.1:${server.address().port}/Today-public-candidate/`
const prefix = 'today-v2-static-/Today-public-candidate/-'
let browser
const record = {
  passed: false,
  environment:
    'real isolated browser, actual old/new service workers, synthetic HTML shell; server stopped for network failure',
  browser: process.env.TODAY_TEST_BROWSER || 'chromium',
  flows: [],
}
try {
  browser = await launchBrowser()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(base)
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('sw.js')
    await navigator.serviceWorker.ready
  })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.getByRole('textbox').fill('fictional unsaved draft')
  await page.evaluate(() =>
    localStorage.setItem('fixture-retained-data', 'fictional retained record'),
  )
  const second = await context.newPage()
  await second.goto(base)
  await second.getByRole('textbox').fill('fictional second draft')
  stage = 'new'
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration()).waiting?.state === 'installed',
  )
  assert.equal(await page.getByRole('textbox').inputValue(), 'fictional unsaved draft')
  assert.equal(await second.getByRole('textbox').inputValue(), 'fictional second draft')
  assert((await page.evaluate(() => caches.keys())).includes(prefix + '2.0.1'))
  record.flows.push('new-worker-waits-with-two-old-pages-and-preserves-drafts')
  await page.close()
  assert.equal(await second.getByRole('textbox').inputValue(), 'fictional second draft')
  await second.close()
  const next = await context.newPage()
  await next.goto(base)
  await next.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()).waiting)
  await next.waitForFunction(() => !!navigator.serviceWorker.controller)
  assert.equal(
    await next.evaluate(() => localStorage.getItem('fixture-retained-data')),
    'fictional retained record',
  )
  const keys = await next.evaluate(() => caches.keys())
  assert(keys.includes(prefix + '2.0.3-new'))
  assert(keys.includes(prefix + '2.0.1'))
  record.flows.push('activation-after-old-pages-close-retains-data-and-previous-assets')
  stage = 'broken'
  await next.evaluate(async () => {
    try {
      await (await navigator.serviceWorker.getRegistration()).update()
    } catch {
      /* Failed install must preserve active worker. */
    }
  })
  // Wait for the worker's terminal install result, not a fixed sleep.
  await next.waitForFunction(
    async () => !(await navigator.serviceWorker.getRegistration()).installing,
  )
  assert.equal(
    await next.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state),
    'activated',
  )
  assert(
    !(await next.evaluate(() => caches.keys())).includes(prefix + '2.0.3-broken'),
    'Failed new precache must not survive as a previous working generation',
  )
  record.flows.push('failed-precache-retains-working-active-worker')
  const serverPort = server.address().port
  await new Promise((done) => server.close(done))
  await next.reload()
  await next.getByRole('heading', { name: 'new', exact: true }).waitFor()
  record.flows.push('offline-navigation-uses-complete-new-shell')
  await new Promise((done) => server.listen(serverPort, '127.0.0.1', done))
  const error = await next.goto(base + 'http-error')
  assert.equal(error.status(), 404)
  record.flows.push('http-error-is-not-hidden-by-stale-shell')
  record.passed = true
} catch (error) {
  record.failure = error.stack
  throw error
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  await writeFile(resolve(output, 'update.json'), JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify(record))
}
