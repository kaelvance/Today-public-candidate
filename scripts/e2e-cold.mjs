import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const evidence = resolve(
  process.argv.slice(2).filter((arg) => arg !== '--')[0] || join(tmpdir(), 'today-cold-evidence'),
)
const { chromium } = await import('playwright-core')
await mkdir(evidence, { recursive: true })
const results = []
for (let trial = 1; trial <= 3; trial++) {
  const base = 'http://127.0.0.1:5185/'
  await assert.rejects(fetch(base), 'Cold probe port must be unused')
  await rm(join(cwd, 'node_modules/.vite'), { recursive: true, force: true })
  let output = ''
  const server = spawn(process.execPath, ['server/index.mjs', '--port', '5185'], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...(process.env.PNPM_HOME ? { PNPM_HOME: process.env.PNPM_HOME } : {}),
      DEBUG: 'vite:deps,vite:resolve',
    },
    stdio: 'pipe',
  })
  server.stdout.on('data', (data) => {
    output += data.toString()
  })
  server.stderr.on('data', (data) => {
    output += data.toString()
  })
  let browser, page, error
  const pageErrors = [],
    moduleURLs = [],
    consoleLogs = []
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base)).ok) {
          ready = true
          break
        }
      } catch {}
      await delay(100)
    }
    assert(ready, 'Cold development server starts')
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    page.on('pageerror', (value) => pageErrors.push({ message: value.message, stack: value.stack }))
    page.on('console', (value) => consoleLogs.push({ type: value.type(), text: value.text() }))
    page.on('request', (value) => {
      if (/react|vite|@react-refresh/.test(value.url())) moduleURLs.push(value.url())
    })
    await page.goto(`${base}?scenario=NORMAL_DAY`)
    await page
      .getByRole('heading', { name: 'Surveying Practice', exact: true })
      .waitFor({ timeout: 15000 })
    assert.deepEqual(pageErrors, [], 'Any recurrence stops qualification')
    results.push({
      trial,
      passed: true,
      pageErrors: 0,
      optimizerCacheInitiallyAbsent: true,
      moduleURLs,
    })
  } catch (value) {
    error = value
  } finally {
    if (error) {
      let metadata
      try {
        metadata = JSON.parse(
          await readFile(join(cwd, 'node_modules/.vite/deps/_metadata.json'), 'utf8'),
        )
      } catch {}
      const why = execFileSync('pnpm', ['why', 'react', 'react-dom'], { cwd, encoding: 'utf8' })
      let moduleIdentity
      try {
        moduleIdentity = await page.evaluate(
          async (urls) => {
            const identities = await Promise.all(
              urls.map(async (url) => ({ url, module: await import(url) })),
            )
            return identities.map(({ url, module }) => ({
              url,
              version: module.version ?? module.default?.version ?? null,
              sameUseState: identities.every((other) => other.module.useState === module.useState),
              dispatcherType:
                typeof module.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?.H,
            }))
          },
          [...new Set(moduleURLs.filter((url) => /\/react\.js(?:\?|$)/.test(url)))],
        )
      } catch (failure) {
        moduleIdentity = { diagnosticFailure: failure.message }
      }
      const evidenceValue = {
        trial,
        failure: error.stack,
        pageErrors,
        moduleURLs,
        moduleIdentity,
        consoleLogs,
        metadata,
        why,
        serverOutput: output,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      }
      await writeFile(
        join(evidence, `cold-failure-${trial}.json`),
        JSON.stringify(evidenceValue, null, 2),
      )
    }
    await browser?.close()
    if (server.exitCode === null) {
      const ended = once(server, 'exit')
      server.kill('SIGTERM')
      await ended
    }
  }
  if (error) throw error
}
await writeFile(
  join(evidence, 'cold-results.json'),
  JSON.stringify(
    {
      status: 'MITIGATED / NOT REPRODUCED',
      rootCauseProven: false,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      results,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({
    status: 'MITIGATED / NOT REPRODUCED',
    trials: results.length,
    failures: 0,
    rootCauseProven: false,
  }),
)
