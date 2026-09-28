import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(process.argv.slice(2).filter((arg) => arg !== '--')[0] || tmpdir())
const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
const { chromium } = await import('playwright-core')
const base = 'http://127.0.0.1:4173/'
const profile = await mkdtemp(join(tmpdir(), 'today-stranger-'))
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: tmpdir(),
  // Keep pnpm start on the store used by the archive installation.
  ...(process.env.PNPM_HOME ? { PNPM_HOME: process.env.PNPM_HOME } : {}),
}
let server, context
const errors = [],
  external = [],
  inference = [],
  status = {}
async function start() {
  await assert.rejects(fetch(base), 'No prior server may impersonate this startup')
  server = spawn('pnpm', ['start'], { cwd, env, stdio: 'pipe', detached: true })
  let output = ''
  server.stdout.on('data', (data) => {
    output += data.toString()
  })
  server.stderr.on('data', (data) => {
    output += data.toString()
  })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Startup failed: ${output}`)
    try {
      if ((await fetch(base)).ok && output.includes(`Today: ${base}`)) return
    } catch {}
    await delay(100)
  }
  throw new Error(`README startup timeout: ${output}`)
}
async function stop() {
  if (!server || server.exitCode !== null) return
  const ended = once(server, 'exit')
  process.kill(-server.pid, 'SIGTERM')
  await Promise.race([
    ended,
    delay(3000).then(() => {
      throw new Error('Server did not stop')
    }),
  ])
}
async function open() {
  context = await chromium.launchPersistentContext(profile, { headless: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  page.on('request', (request) => {
    if (!request.url().startsWith(base) && !request.url().startsWith('data:'))
      external.push(request.url())
    if (/\/api\/(?:ai\/interpret|.*model\/(?:load|complete))/.test(request.url()))
      inference.push(request.url())
  })
  await page.goto(base)
  return page
}
try {
  await start()
  for (const name of ['calendar', 'gmail', 'ai', 'local-model', 'remote-model', 'ollama-model']) {
    const value = await (await fetch(`${base}api/${name}/status`)).json()
    assert(value.configured !== true && value.available !== true)
    status[name] = {
      configured: value.configured ?? null,
      available: value.available ?? null,
      state: value.state ?? null,
    }
  }
  let page = await open()
  await page.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  await page.getByRole('button', { name: /^追加(?:する)?$/ }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('Stranger fixture task')
  await page.getByRole('button', { name: 'Todayに追加' }).click()
  await page.getByRole('heading', { name: 'Stranger fixture task' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Stranger fixture task' }).waitFor()
  await page.getByRole('button', { name: '完了にする' }).click()
  await page.getByText('完了・整理済み').waitFor()
  await page.getByRole('button', { name: '元に戻す' }).click()
  await page.getByRole('heading', { name: 'Stranger fixture task' }).waitFor()
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page
    .getByRole('group', { name: 'AI アシスト', exact: true })
    .getByRole('button', { name: 'オフ', exact: true })
    .click()
  await page.getByRole('combobox', { name: '処理方法' }).selectOption('DISABLED')
  await page.keyboard.press('Escape')
  await context.close()
  context = undefined
  await stop()
  await start()
  page = await open()
  await page.getByRole('heading', { name: 'Stranger fixture task' }).waitFor()
  await page.getByRole('button', { name: /^設定$/ }).click()
  assert.equal(await page.getByRole('combobox', { name: '処理方法' }).inputValue(), 'DISABLED')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: join(output, 'stranger-test.png') })
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  assert.deepEqual(inference, [])
  console.log(
    JSON.stringify(
      {
        passed: true,
        command: 'pnpm start',
        version: manifest.version,
        flows: [
          'first-item',
          'persist',
          'complete',
          'undo',
          'browser-and-server-restart',
          'ai-disabled-core',
        ],
        externalRequests: 0,
        inferenceCalls: 0,
        pageErrors: 0,
        status,
        undocumentedMandatoryAssumptions: [],
      },
      null,
      2,
    ),
  )
} finally {
  await context?.close()
  await stop()
}
