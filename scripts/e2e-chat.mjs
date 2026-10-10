import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { launchBrowser } from './test-browser.mjs'
const root = process.cwd(),
  output = resolve(
    process.argv.slice(2).filter((arg) => arg !== '--')[0] || '../evidence/chat-browser',
  )
assert(!output.startsWith(root + '/'), 'Evidence must be outside source')
await mkdir(output, { recursive: true })
const require = createRequire(import.meta.url)
const axeFixture = root + '/dist/__test_axe_chat.js'
await writeFile(axeFixture, await readFile(require.resolve('axe-core/axe.min.js')))
const port = 4281,
  base = `http://127.0.0.1:${port}`
const child = spawn(
  process.execPath,
  ['server/index.mjs', '--production', '--port', String(port)],
  { stdio: 'pipe', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
)
let browser
const receipt = {
  passed: false,
  flows: [],
  accessibility: [],
  pageErrors: [],
  externalRequests: [],
  syntheticOnly: true,
  browser: process.env.TODAY_TEST_BROWSER || 'chromium',
}
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + '/api/chat/status')).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (e) => receipt.pageErrors.push(e.message))
  page.on('request', (req) => {
    if (!req.url().startsWith(base) && !req.url().startsWith('data:'))
      receipt.externalRequests.push(req.url())
  })
  const state = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('today-prototype-state-v2')))
  await page.goto(base)
  await page.getByRole('button', { name: 'Today AI Chat', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Today AI Chat' })
  await dialog.getByText('V2.1.0。', { exact: false }).waitFor()
  await dialog.getByRole('combobox', { name: '会話モデル' }).selectOption('mock')
  assert.equal(
    await dialog.getByRole('button', { name: '会話する', exact: true }).isEnabled(),
    false,
  )
  const consent = dialog.getByRole('checkbox', {
    name: '選択した情報と会話を、このローカルモデル／Mockに渡すことを許可する',
  })
  await consent.check()
  await dialog
    .getByRole('textbox', { name: 'メッセージ', exact: true })
    .fill('タスク「架空のV2.1検証」を追加')
  await dialog.getByRole('button', { name: '会話する', exact: true }).click()
  await dialog.getByRole('heading', { name: '変更内容の確認' }).waitFor()
  assert(!(await state()).items.some((i) => i.title === '架空のV2.1検証'))
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('consent-required-and-no-write-before-approval')
  await dialog.getByRole('button', { name: 'この変更を承認して保存' }).click()
  await dialog.getByText('承認した変更を保存しました。').waitFor()
  assert.equal((await state()).items.filter((i) => i.title === '架空のV2.1検証').length, 1)
  assert.equal((await state()).version, 3)
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('approved-create-durable-version3-no-duplicate')
  await dialog.getByRole('checkbox', { name: '架空のV2.1検証', exact: true }).check()
  await consent.check()
  await dialog
    .getByRole('textbox', { name: 'メッセージ', exact: true })
    .fill('「架空のV2.1検証」を完了')
  await dialog.getByRole('button', { name: '会話する', exact: true }).click()
  await dialog.getByRole('button', { name: 'この変更を承認して保存' }).waitFor()
  await dialog.getByRole('button', { name: '却下', exact: true }).click()
  assert.equal((await state()).items.find((i) => i.title === '架空のV2.1検証').status, 'active')
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('rejected-proposal-never-executes')
  await dialog
    .getByRole('textbox', { name: 'メッセージ', exact: true })
    .fill('「架空のV2.1検証」を完了')
  await dialog.getByRole('button', { name: '会話する', exact: true }).click()
  await dialog.getByRole('button', { name: 'この変更を承認して保存' }).click()
  await dialog.getByText('承認した変更を保存しました。').waitFor()
  assert.equal((await state()).items.find((i) => i.title === '架空のV2.1検証').status, 'done')
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('approved-update-through-application-core')
  await dialog.getByRole('textbox', { name: 'メッセージ', exact: true }).fill('選択情報を確認')
  await dialog.getByRole('button', { name: 'Mockメッセージを受信' }).click()
  await dialog.getByRole('heading', { name: 'Mock返信案（宛先: 架空の本人）' }).waitFor()
  await dialog.getByText('送信状態: DRAFT', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Mock返信を承認して送信' }).click()
  await dialog.getByText('送信状態: SENT', { exact: true }).waitFor()
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('mock-receive-infer-manual-reply-outbox-no-external-message')
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    await page.addScriptTag({ url: base + '/__test_axe_chat.js' })
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
        targets: v.nodes.map((n) => n.target),
      })),
    )
    receipt.accessibility.push({ width, violations })
    assert.deepEqual(violations, [])
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    )
  }
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('chat-axe-3-widths-no-horizontal-overflow')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await page.addScriptTag({ url: base + '/__test_axe_chat.js' })
  const darkViolations = await page.evaluate(async () =>
    (
      await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      })
    ).violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    })),
  )
  receipt.accessibility.push({ width: 1440, theme: 'dark', violations: darkViolations })
  assert.deepEqual(darkViolations, [])
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  const deviceOption = dialog.locator('option[value="browser"]')
  if (!(await deviceOption.isDisabled())) {
    await dialog.getByRole('combobox', { name: '会話モデル' }).selectOption('browser')
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 950 })
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
          targets: v.nodes.map((n) => n.target),
        })),
      )
      receipt.accessibility.push({ width, mode: 'on-device-before-download', violations })
      assert.deepEqual(violations, [])
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
      )
    }
    await dialog.getByRole('combobox', { name: '会話モデル' }).selectOption('mock')
  }
  await page.screenshot({ path: output + '/chat.png', fullPage: true })
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Today AI Chat', exact: true }).first().click()
  assert.equal(await dialog.getByRole('log').innerText(), '')
  assert.equal(await consent.isChecked(), false)
  await dialog.getByRole('combobox', { name: '会話モデル' }).selectOption('mock')
  assert.equal((await state()).items.find((i) => i.title === '架空のV2.1検証').status, 'done')
  assert(!JSON.stringify(await state()).includes('試験用Mockが'))
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('reload-retains-core-but-not-chat-history-or-consent')
  const second = await context.newPage()
  second.setDefaultTimeout(15_000)
  await second.goto(base)
  await second.getByText('Todayの編集タブを確認しています', { exact: false }).waitFor()
  assert.equal(await second.getByRole('button', { name: 'Today AI Chat', exact: true }).count(), 0)
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('second-tab-cannot-run-ai-commands-without-writer')
  await second.close()
  await context.setOffline(true)
  await consent.check()
  await dialog
    .getByRole('textbox', { name: 'メッセージ', exact: true })
    .fill('タスク「架空の保存失敗」を追加')
  await dialog.getByRole('button', { name: '会話する', exact: true }).click()
  await dialog.getByRole('button', { name: 'この変更を承認して保存' }).waitFor()
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem,
      originalTransaction = IDBDatabase.prototype.transaction
    window.restoreFixtureStorage = () => {
      Storage.prototype.setItem = originalSet
      IDBDatabase.prototype.transaction = originalTransaction
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'today-prototype-state-v2') throw new Error('fixture quota')
      return originalSet.call(this, key, value)
    }
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === 'readwrite') throw new Error('fixture idb write failure')
      return originalTransaction.apply(this, args)
    }
  })
  await dialog.getByRole('button', { name: 'この変更を承認して保存' }).click()
  await dialog
    .getByRole('alert')
    .getByText('変更を保存できませんでした。', { exact: false })
    .waitFor()
  assert(!(await state()).items.some((i) => i.title === '架空の保存失敗'))
  assert.equal(await dialog.getByText('承認した変更を保存しました。').count(), 0)
  await page.evaluate(() => window.restoreFixtureStorage())
  process.stdout.write('flow checkpoint\n')
  receipt.flows.push('failed-durable-write-no-success-no-state-mutation-offline')
  assert.deepEqual(receipt.pageErrors, [])
  assert.deepEqual(receipt.externalRequests, [])
  receipt.passed = true
} catch (error) {
  receipt.failure = String(error)
  throw error
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  await rm(axeFixture, { force: true })
  await writeFile(output + '/receipt.json', JSON.stringify(receipt, null, 2))
}
