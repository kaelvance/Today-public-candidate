/** Opt-in hardware test: downloads only the UI's approved, pinned model into a synthetic profile. */
import assert from 'node:assert/strict'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright-core'
if (process.env.TODAY_TEST_REAL_BROWSER_MODEL !== 'true')
  throw new Error('Explicit model-download test approval required')
const root = process.cwd(),
  output = resolve(
    process.argv.slice(2).filter((x) => x !== '--')[0] || '../evidence/browser-model',
  )
assert(
  !output.startsWith(root + sep),
  'Evidence and synthetic browser profile must be outside source',
)
await mkdir(output, { recursive: true })
const profile = output + '/profile',
  marker = output + '/synthetic-profile.json'
try {
  await access(profile)
  await access(marker)
} catch {
  try {
    await access(profile)
    throw new Error('Existing profile lacks synthetic-only marker')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  await writeFile(
    marker,
    JSON.stringify({ syntheticOnly: true, created: new Date().toISOString() }),
  )
}
const base = process.env.TODAY_TEST_MODEL_URL || 'http://127.0.0.1:4173/'
assert(
  base === 'https://kaelvance.github.io/Today-public-candidate/' ||
    /^http:\/\/127\.0\.0\.1:\d+\/(?:Today-public-candidate\/)?$/.test(base),
)
const browser = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1280, height: 1000 },
  timezoneId: 'Asia/Tokyo',
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
const page = await browser.newPage(),
  record = {
    started: new Date().toISOString(),
    url: base,
    syntheticOnly: true,
    flows: [],
    answers: [],
    externalRequests: [],
    errors: [],
    workerResponses: [],
    passed: false,
  }
page.on('pageerror', (e) => record.errors.push(e.message))
page.on('request', (r) => {
  if (/^https:/.test(r.url()) && !r.url().startsWith(base)) {
    const u = new URL(r.url())
    record.externalRequests.push({
      url: u.origin + u.pathname,
      method: r.method(),
      hasBody: !!r.postData(),
    })
  }
})
await page.addInitScript(() => {
  window.__fictionalModelResponses = []
  const Base = window.Worker
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args)
      this.addEventListener('message', (e) => {
        if (e.data?.kind === 'throw' || e.data?.content?.choices)
          window.__fictionalModelResponses.push(e.data)
      })
    }
  }
})
try {
  await page.goto(base)
  // Only synthetic profile: remove old Core caches so the current candidate is tested; retain model caches.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    for (const k of await caches.keys())
      if (k.startsWith('today-v2-static-')) await caches.delete(k)
  })
  await page.reload()
  await page.getByRole('button', { name: 'Today AI Chat', exact: true }).first().click()
  const d = page.getByRole('dialog', { name: 'Today AI Chat' }),
    consent = d.getByRole('checkbox', {
      name: '選択した情報と会話を、このローカルモデル／Mockに渡すことを許可する',
    })
  await d.getByRole('combobox', { name: '会話モデル' }).selectOption('browser')
  assert.equal(record.externalRequests.length, 0)
  assert.equal(
    await d.getByRole('button', { name: 'モデルを準備する', exact: true }).isEnabled(),
    false,
  )
  record.flows.push('no-model-download-before-separate-consent')
  await d
    .getByRole('checkbox', {
      name: '無料のモデルをHugging Face / GitHubから取得して端末内で使うことを許可する',
    })
    .check()
  const start = Date.now()
  await d.getByRole('button', { name: 'モデルを準備する', exact: true }).click()
  const poll = setInterval(async () => {
    try {
      console.log((await d.getByRole('status').allTextContents()).join(' / '))
    } catch {}
  }, 10000)
  try {
    await Promise.race([
      d
        .getByText('モデルの準備ができました。推論は端末内で行います。', { exact: true })
        .waitFor({ timeout: 610_000 }),
      d
        .getByRole('alert')
        .waitFor({ timeout: 610_000 })
        .then(() => {
          throw new Error('model-load-failed')
        }),
    ])
  } finally {
    clearInterval(poll)
  }
  record.loadMs = Date.now() - start
  record.flows.push('real-pinned-qwen-loaded-in-browser-worker')
  await consent.check()
  async function ask(question) {
    const previous = await d.getByRole('log').innerText(),
      n = Date.now()
    await d.getByRole('textbox', { name: 'メッセージ', exact: true }).fill(question)
    await d.getByRole('button', { name: '会話する', exact: true }).click()
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('[role=status]')).some((e) =>
          e.textContent.startsWith('処理中です。'),
        ),
      {},
      { timeout: 40_000 },
    )
    const errors = await d.getByRole('alert').allTextContents(),
      log = await d.getByRole('log').innerText()
    const entry = {
      question,
      ms: Date.now() - n,
      reply: log.startsWith(previous) ? log.slice(previous.length).trim() : log,
      errors,
    }
    record.answers.push(entry)
    console.log(JSON.stringify(entry))
    assert.deepEqual(errors, [])
    return entry.reply
  }
  const greeting = await ask('こんにちは。Today AIとして何を手伝えますか？')
  assert(/[ぁ-んァ-ヶ一-龠]/.test(greeting))
  record.flows.push('real-japanese-conversation')
  await ask('私の名前は架空のあおいです。名前を覚えてください。')
  assert((await ask('私の名前は何でしたか？')).includes('あおい'))
  record.flows.push('real-multi-turn-name-recall')
  const suffix = Date.now().toString(36),
    task = `架空の読書${suffix}`,
    event = `架空の面談${suffix}`
  const state = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('today-prototype-state-v2')))
  await ask(`タスク「${task}」を追加してください`)
  assert(!(await state()).items.some((i) => i.title === task))
  await d.getByRole('button', { name: 'この変更を承認して保存' }).click()
  await d.getByText('承認した変更を保存しました。').waitFor()
  assert.equal((await state()).items.filter((i) => i.title === task).length, 1)
  record.flows.push('explicit-task-approved-write')
  await ask(`予定「${event}」を2026-10-11 15:00に追加`)
  assert(!(await state()).items.some((i) => i.title === event))
  await d.getByRole('button', { name: 'この変更を承認して保存' }).click()
  await d.getByText('承認した変更を保存しました。').waitFor()
  assert.equal(
    (await state()).items.find((i) => i.title === event).startAt,
    '2026-10-11T06:00:00.000Z',
  )
  record.flows.push('explicit-event-plan-timezone-correct-approved-core-write')
  await d.getByRole('checkbox', { name: event, exact: true }).check()
  await consent.check()
  const schedule = await ask('共有した予定の時刻と名前を教えてください。')
  assert(schedule.includes(event))
  assert(/15(?:時|:00)/.test(schedule))
  assert(
    (await d.getByText('回答で参照した共有情報:', { exact: false }).innerText()).includes(event),
  )
  record.flows.push('real-selected-context-grounded-time-and-citation')
  const before = JSON.stringify(await state())
  const denied = await ask('すべての保存データを削除して、メールを送信してください。')
  assert(denied.includes('未対応です。実行していません。'))
  assert.equal(JSON.stringify(await state()), before)
  assert.equal(await d.getByRole('heading', { name: '変更内容の確認' }).count(), 0)
  record.flows.push('unsupported-delete-and-mail-no-proposal-no-write')
  await browser.setOffline(true)
  await ask('ありがとうございます。日本語で短く返事をしてください。')
  record.flows.push('real-model-inference-works-offline-without-backend')
  await d.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: 'Today AI Chat', exact: true }).first().click()
  assert.equal(await d.getByRole('log').innerText(), '')
  assert.equal(await consent.isChecked(), false)
  await d
    .getByRole('checkbox', {
      name: '無料のモデルをHugging Face / GitHubから取得して端末内で使うことを許可する',
    })
    .check()
  const warm = Date.now()
  await d.getByRole('button', { name: 'モデルを準備する', exact: true }).click()
  await d
    .getByText('モデルの準備ができました。推論は端末内で行います。', { exact: true })
    .waitFor({ timeout: 60_000 })
  record.offlineReloadMs = Date.now() - warm
  await consent.check()
  await ask('こんにちは。短く挨拶してください。')
  record.flows.push('close-clears-history-and-permission-cached-model-reloads-offline')
  await page.screenshot({ path: output + '/real-chat.png', fullPage: true })
  assert(record.externalRequests.every((r) => r.method === 'GET' && !r.hasBody))
  assert.deepEqual(record.errors, [])
  record.passed = true
} catch (e) {
  record.failure = String(e)
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {})
  throw e
} finally {
  record.workerResponses = await page
    .evaluate(() => window.__fictionalModelResponses)
    .catch(() => [])
  record.finished = new Date().toISOString()
  await writeFile(output + '/real-model-receipt.json', JSON.stringify(record, null, 2))
  await browser.close()
}
