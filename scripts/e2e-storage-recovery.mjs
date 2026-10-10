import fs from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, relative, extname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { launchBrowser } from './test-browser.mjs'
import assert from 'node:assert/strict'

const require = createRequire(new URL('../package.json', import.meta.url))
const ts = require('typescript')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(
  process.argv.slice(2).filter((arg) => arg !== '--')[0] ||
    resolve(tmpdir(), 'today-storage-recovery'),
)
assert(relative(root, output).startsWith(`..${sep}`), 'Evidence outside source')
await fs.mkdir(output, { recursive: true })
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const compiled = ts.transpileModule(
  await fs.readFile(new URL('../src/storage.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  },
).outputText
const deployment = JSON.parse(await fs.readFile(resolve(dist, 'deployment.json'), 'utf8'))
assert.equal(
  deployment.version,
  JSON.parse(await fs.readFile(resolve(root, 'package.json'), 'utf8')).version,
)

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    response.setHeader('Cache-Control', 'no-store')
    if (pathname === '/__probe') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Fictional storage QA</title>')
      return
    }
    if (pathname === '/candidate-storage.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(compiled)
      return
    }
    if (pathname === '/data') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end('export const demoItems=()=>[]')
      return
    }
    const relative =
      decodeURIComponent(pathname).replace(/^\/Today-public-candidate\//, '') || 'index.html'
    const path = resolve(dist, relative)
    if (!path.startsWith(dist + sep)) {
      response.writeHead(403)
      response.end()
      return
    }
    const data = await fs.readFile(path)
    response.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
      }[extname(path)] || 'application/octet-stream',
    )
    response.end(data)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((ready, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', ready)
})
let browser
const results = []
const externalRequests = []
const base = `http://127.0.0.1:${server.address().port}`
const original = {
  version: 3,
  items: [
    { id: 'fixture-browser-1', kind: 'task', title: '架空検証 保持すべき項目', sourceId: 'manual' },
  ],
  theme: 'system',
  showSamples: false,
  queuedActions: [],
}
async function context() {
  const context = await browser.newContext()
  await context.route('**/*', (route) => {
    const u = route.request().url()
    if (u.startsWith(base + '/')) return route.continue()
    externalRequests.push(u)
    return route.abort()
  })
  return context
}
async function seed(page, mirror) {
  await page.goto(base + '/__probe')
  await page.evaluate(
    async ({ state, mirror }) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('today-prototype-v1', 1)
        open.onupgradeneeded = () => open.result.createObjectStore('state')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('state', 'readwrite')
          tx.objectStore('state').put(state, 'current-v2')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      })
      if (mirror !== null) localStorage.setItem('today-prototype-state-v2', mirror)
    },
    { state: original, mirror },
  )
}
const read = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('today-prototype-v1', 1)
        open.onsuccess = () => {
          const db = open.result
          const get = db.transaction('state').objectStore('state').get('current-v2')
          get.onsuccess = () => {
            db.close()
            resolve(get.result)
          }
          get.onerror = () => reject(get.error)
        }
        open.onerror = () => reject(open.error)
      }),
  )
try {
  browser = await launchBrowser()
  {
    const c = await context()
    const page = await c.newPage()
    await seed(page, '[]')
    assert.equal((await read(page)).items[0].title, original.items[0].title)
    await page.goto(base + '/Today-public-candidate/')
    await page.getByRole('heading', { name: original.items[0].title, exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('today-prototype-v1', 1)
          open.onsuccess = () => {
            const db = open.result
            const get = db.transaction('state').objectStore('state').get('current-v2')
            get.onsuccess = () => {
              db.close()
              resolve(get.result?.items?.length === 1)
            }
          }
        }),
    )
    const after = await read(page)
    assert.equal(after.items.length, 1)
    results.push({
      id: 'B05',
      result: 'FIX_VERIFIED_REAL_BROWSER_APP',
      fault: 'JSON-valid [] mirror',
      beforeItems: 1,
      afterItems: 1,
      desiredGatePassed: true,
    })
    await page.screenshot({ path: resolve(output, 'wrong-shape-mirror-recovered.png') })
    await c.close()
  }
  {
    const c = await context()
    const page = await c.newPage()
    await seed(page, null)
    await c.addInitScript(() => {
      if (!location.pathname.startsWith('/Today-public-candidate/')) return
      const get = Storage.prototype.getItem
      const open = IDBFactory.prototype.open
      globalThis.__restoreFictionalFault = () => {
        Storage.prototype.getItem = get
        IDBFactory.prototype.open = open
      }
      Storage.prototype.getItem = function () {
        throw new DOMException('Fictional storage read denied', 'SecurityError')
      }
      IDBFactory.prototype.open = function () {
        throw new DOMException('Fictional IDB read denied', 'SecurityError')
      }
    })
    await page.goto(base + '/Today-public-candidate/')
    await page.getByRole('heading', { name: '保存内容を読み込めませんでした' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Todayに追加すること' }).count(), 0)
    await page.evaluate(() => globalThis.__restoreFictionalFault())
    await page.getByRole('button', { name: '読み込みを再試行', exact: true }).click()
    await page.getByRole('heading', { name: original.items[0].title, exact: true }).waitFor()
    const input = page.getByRole('textbox', { name: 'Todayに追加すること' })
    await input.fill('架空検証 一時障害後の追加')
    await input.press('Enter')
    await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
    await page.getByRole('heading', { name: '架空検証 一時障害後の追加', exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('today-prototype-v1', 1)
          open.onsuccess = () => {
            const db = open.result
            const get = db.transaction('state').objectStore('state').get('current-v2')
            get.onsuccess = () => {
              db.close()
              resolve(get.result?.items?.some((i) => i.title === '架空検証 一時障害後の追加'))
            }
          }
        }),
    )
    const after = await read(page)
    assert.ok(after.items.some((i) => i.title === original.items[0].title))
    results.push({
      id: 'B06',
      result: 'FIX_VERIFIED_REAL_BROWSER_APP',
      fault: 'Transient mirror and IDB read failure',
      originalRecordRetained: true,
      afterTitles: after.items.map((i) => i.title),
      desiredGatePassed: true,
    })
    await c.close()
  }
  {
    const c = await context()
    const page = await c.newPage()
    await page.goto(base + '/__probe')
    const observed = await page.evaluate(async (state) => {
      const storage = await import('/candidate-storage.js')
      const controller = new AbortController()
      let acquire
      const ready = new Promise((resolve) => {
        acquire = resolve
      })
      const held = storage.holdStateWriter(controller.signal, acquire)
      await ready
      await storage.loadState()
      let abortEvents = 0
      let putCalls = 0
      let injectionError
      let observedAbort
      const abortObserved = new Promise((resolve) => {
        observedAbort = resolve
      })
      IDBObjectStore.prototype.put = function () {
        putCalls++
        try {
          this.transaction.addEventListener('abort', () => {
            abortEvents++
            observedAbort()
          })
          this.transaction.abort()
        } catch (error) {
          injectionError = error.message
          throw error
        }
        return {}
      }
      Storage.prototype.setItem = function () {
        throw new DOMException('Fictional quota', 'QuotaExceededError')
      }
      let failure
      const saved = storage.saveState(state).then(
        () => 'resolved',
        (error) => {
          failure = error.message
          return 'rejected'
        },
      )
      const outcome = await Promise.race([
        saved,
        new Promise((resolve) => setTimeout(() => resolve('pending-after-200ms'), 200)),
      ])
      // The storage onabort listener settles the promise before our later event
      // listener runs. Wait for the observed event, not a microtask ordering guess.
      await Promise.race([abortObserved, new Promise((resolve) => setTimeout(resolve, 200))])
      controller.abort()
      const ownership = await Promise.race([
        held.then(() => 'released'),
        new Promise((resolve) => setTimeout(() => resolve('held-after-200ms'), 200)),
      ])
      return { outcome, abortEvents, ownership, putCalls, failure, injectionError }
    }, original)
    console.log(JSON.stringify({ probe: 'B08', observed }))
    assert.equal(observed.abortEvents, 1)
    assert.equal(observed.outcome, 'rejected')
    assert.equal(observed.ownership, 'released')
    results.push({
      id: 'B08',
      result: 'FIX_VERIFIED_REAL_IDB_ABORT_EVENT',
      actualCandidateStorage: true,
      ...observed,
      desiredGatePassed: true,
    })
    await c.close()
  }
  for (const scenario of [
    'null',
    'array',
    'wrong-object',
    'future-version',
    'first-use',
    'mirror-only',
    'idb-only',
    'newer-idb',
    'newer-mirror',
    'failed-mirror-write',
    'both-writes-fail',
    'read-abort',
  ]) {
    const c = await context()
    const page = await c.newPage()
    await page.goto(base + '/__probe')
    const observed = await page.evaluate(
      async ({ scenario, original }) => {
        const storage = await import('/candidate-storage.js')
        const put = (state) =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('today-prototype-v1', 1)
            open.onupgradeneeded = () => open.result.createObjectStore('state')
            open.onsuccess = () => {
              const db = open.result
              const tx = db.transaction('state', 'readwrite')
              tx.objectStore('state').put(state, 'current-v2')
              tx.oncomplete = () => {
                db.close()
                resolve()
              }
              tx.onabort = () => {
                db.close()
                reject(tx.error)
              }
            }
            open.onerror = () => reject(open.error)
          })
        const bad = {
          null: 'null',
          array: '[]',
          'wrong-object': '{}',
          'future-version': JSON.stringify({ ...original, version: 99 }),
        }
        if (scenario in bad) {
          localStorage.setItem('today-prototype-state-v2', bad[scenario])
          try {
            await storage.loadState()
            return { rejected: false }
          } catch (error) {
            return { rejected: true, status: error.status }
          }
        }
        if (scenario === 'first-use') {
          const state = await storage.loadState()
          return { status: storage.storageLoadStatus(), items: state.items.length }
        }
        await put({ ...original, persistenceRevision: scenario === 'newer-idb' ? 3 : 1 })
        if (scenario !== 'idb-only' && scenario !== 'read-abort')
          localStorage.setItem(
            'today-prototype-state-v2',
            JSON.stringify({
              ...original,
              items: [{ ...original.items[0], title: 'fictional mirror' }],
              persistenceRevision: scenario === 'newer-mirror' ? 3 : 1,
            }),
          )
        if (scenario === 'mirror-only')
          IDBFactory.prototype.open = function () {
            throw new Error('Fictional IDB unavailable')
          }
        if (scenario === 'idb-only')
          Storage.prototype.getItem = function () {
            throw new Error('Fictional mirror unavailable')
          }
        if (scenario === 'read-abort')
          IDBObjectStore.prototype.get = function () {
            this.transaction.abort()
            return {}
          }
        if (scenario === 'read-abort') {
          try {
            await storage.loadState()
            return { rejected: false }
          } catch (error) {
            return { rejected: true, status: error.status }
          }
        }
        if (!['failed-mirror-write', 'both-writes-fail'].includes(scenario)) {
          const state = await storage.loadState()
          return { title: state.items[0].title, status: storage.storageLoadStatus() }
        }
        const controller = new AbortController()
        let acquire
        const ready = new Promise((resolve) => {
          acquire = resolve
        })
        const held = storage.holdStateWriter(controller.signal, acquire)
        await ready
        const state = await storage.loadState()
        const prior = localStorage.getItem('today-prototype-state-v2')
        Storage.prototype.setItem = function () {
          throw new Error('Fictional mirror write quota')
        }
        if (scenario === 'both-writes-fail')
          IDBObjectStore.prototype.put = function () {
            this.transaction.abort()
            return {}
          }
        let rejected = false
        try {
          await storage.saveState({
            ...state,
            items: [{ ...state.items[0], title: 'fictional newer write' }],
          })
        } catch {
          rejected = true
        }
        const oldCopyRetained = localStorage.getItem('today-prototype-state-v2') === prior
        const reloaded = await storage.loadState()
        controller.abort()
        await held
        return { rejected, oldCopyRetained, title: reloaded.items[0].title }
      },
      { scenario, original },
    )
    if (['null', 'array', 'wrong-object', 'future-version'].includes(scenario))
      assert.deepEqual(observed, { rejected: true, status: 'CORRUPT' })
    else if (scenario === 'read-abort')
      assert.deepEqual(observed, { rejected: true, status: 'UNAVAILABLE' })
    else if (scenario === 'first-use') assert.deepEqual(observed, { status: 'FIRST_USE', items: 0 })
    else if (scenario === 'failed-mirror-write')
      assert.deepEqual(observed, {
        rejected: false,
        oldCopyRetained: true,
        title: 'fictional newer write',
      })
    else if (scenario === 'both-writes-fail')
      assert.deepEqual(observed, {
        rejected: true,
        oldCopyRetained: true,
        title: 'fictional mirror',
      })
    else
      assert.equal(
        observed.title,
        ['mirror-only', 'newer-mirror'].includes(scenario)
          ? 'fictional mirror'
          : original.items[0].title,
      )
    results.push({ id: scenario, desiredGatePassed: true, ...observed })
    await c.close()
  }
  assert.deepEqual(externalRequests, [])
  const report = {
    commit: deployment.commit,
    storageSourceSha256: createHash('sha256')
      .update(await fs.readFile(new URL('../src/storage.ts', import.meta.url)))
      .digest('hex'),
    deployedVersionUnderTest: deployment.version,
    browser: process.env.TODAY_TEST_BROWSER || 'chromium',

    fictionalContextsOnly: true,
    externalRequests,
    gatePassed: true,
    results,
  }
  await fs.writeFile(
    resolve(output, 'browser-storage-fault-probes.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
