import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTodayServer } from '../server/index.mjs'
import { launchBrowser } from './test-browser.mjs'
const output = resolve(
  process.argv.slice(2).filter((x) => x !== '--')[0] || '../evidence/vault-browser',
)
assert(!output.startsWith(process.cwd() + '/'))
await mkdir(output, { recursive: true })
const parent = await mkdtemp(join(tmpdir(), 'today-vault-browser-')),
  directory = join(parent, 'private'),
  phrase = 'fixture-only-browser-long-passphrase'
const require = createRequire(import.meta.url),
  axePath = resolve('dist/__test_axe_vault.js')
await writeFile(axePath, await readFile(require.resolve('axe-core/axe.min.js')))
let browser, app
let page
const receipt = {
  passed: false,
  syntheticOnly: true,
  flows: [],
  accessibility: [],
  externalRequests: [],
  pageErrors: [],
}
try {
  app = await createTodayServer({
    port: 44281,
    production: true,
    env: { TODAY_V3_VAULT_DIR: directory },
    fetchImpl: () => {
      throw new Error('external_network_forbidden')
    },
  })
  const base = await app.listen()
  browser = await launchBrowser()
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== base) {
      receipt.externalRequests.push(url.origin)
      await route.abort()
    } else await route.continue()
  })
  page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (e) => receipt.pageErrors.push(e.message))
  await page.goto(base)
  const input = page.getByRole('textbox', { name: 'Todayに追加すること' })
  await input.fill('架空RC保存庫タスク')
  await input.press('Enter')
  await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await page.getByRole('heading', { name: '架空RC保存庫タスク', exact: true }).waitFor()
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByText('保存済み（利用可能な保存先）', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  const before = await page.evaluate(() => localStorage.getItem('today-prototype-state-v2'))
  await page.getByRole('button', { name: 'V3 日次サマリー実験', exact: true }).click()
  const vault = page.getByRole('region', { name: 'Mac保存庫' })
  await vault.getByText('ロック中', { exact: true }).waitFor()
  const setup = vault.getByRole('button', { name: '暗号化保存庫を作成する', exact: true })
  assert.equal(await setup.isDisabled(), true)
  await vault.getByLabel('保存庫のパスフレーズ', { exact: true }).fill(phrase)
  await vault.getByLabel('パスフレーズを再入力', { exact: true }).fill(phrase)
  await vault.getByRole('checkbox', { name: 'このMacの保存庫を使用することに同意する' }).check()
  await setup.click()
  await vault.getByRole('button', { name: 'Macへ選択共有する' }).waitFor()
  receipt.flows.push('explicit-setup-consent-and-unlock')
  await vault.getByRole('checkbox', { name: '架空RC保存庫タスク', exact: true }).check()
  await vault
    .getByRole('checkbox', { name: '選択した項目をMacへ保存し、5分間の照会に使うことに同意する' })
    .check()
  await vault.getByRole('button', { name: 'Macへ選択共有する' }).click()
  await vault.getByRole('region', { name: 'Mac日次サマリー' }).waitFor()
  receipt.flows.push('real-web-http-encrypted-publish-overview')
  const nativeDownload = page.waitForEvent('download')
  await vault.getByRole('button', { name: 'MacのサマリーJSONを書き出す' }).click()
  await (await nativeDownload).saveAs(join(output, 'native-overview.json'))
  await vault
    .getByRole('checkbox', {
      name: '手動データと関連Contextを、このMacへバックアップすることに同意する',
    })
    .check()
  await vault.getByRole('button', { name: 'V3バックアップをMacに保存する' }).click()
  await vault.getByText(/解除中 · 保存版 2/).waitFor()
  receipt.flows.push('portable-archive-separate-explicit-consent')
  const downloading = page.waitForEvent('download')
  await vault.getByRole('button', { name: '暗号化バックアップを書き出す' }).click()
  await (await downloading).saveAs(join(output, 'encrypted-backup.json'))
  const exported = await readFile(join(output, 'encrypted-backup.json'), 'utf8')
  assert.equal(exported.includes('架空RC保存庫タスク'), false)
  assert.equal(exported.includes(phrase), false)
  await vault
    .getByLabel('暗号化バックアップのプレビュー')
    .setInputFiles(join(output, 'encrypted-backup.json'))
  await vault.getByLabel('バックアップのパスフレーズ').fill(phrase)
  await vault.getByRole('button', { name: '復元内容を確認する' }).click()
  await vault.getByText(/プレビューのみ：手動データ 1件/).waitFor()
  receipt.flows.push('encrypted-export-preview-no-core-write')
  await page.addScriptTag({ url: base + '/__test_axe_vault.js' })
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
        targets: v.nodes.map((n) => n.target),
      })),
    )
    receipt.accessibility.push({ width, violations })
    assert.deepEqual(violations, [])
  }
  await page.screenshot({ path: join(output, 'vault-web.png'), fullPage: true })
  await vault.getByRole('button', { name: '保存庫のコピーを消去…' }).click()
  await vault.getByRole('button', { name: '消去を取り消す' }).click()
  await vault.getByRole('group', { name: '保存庫の消去確認' }).waitFor({ state: 'detached' })
  await vault.getByRole('button', { name: '保存庫のコピーを消去…' }).click()
  await vault.getByRole('button', { name: '確認して保存庫のコピーを消去する' }).click()
  await vault.getByText(/解除中 · 保存版 3/).waitFor()
  assert.equal(
    await vault.getByRole('button', { name: '暗号化バックアップを書き出す' }).isDisabled(),
    true,
  )
  receipt.flows.push('cancel-and-confirm-delete-only-vault-copies')
  await vault
    .getByLabel('暗号化バックアップのプレビュー')
    .setInputFiles(join(output, 'encrypted-backup.json'))
  await vault.getByLabel('バックアップのパスフレーズ').fill(phrase)
  await vault.getByRole('button', { name: '復元内容を確認する' }).click()
  await vault.getByRole('button', { name: '確認してMac保存庫に復元する' }).waitFor()
  await vault.getByRole('button', { name: '確認してMac保存庫に復元する' }).click()
  await vault.getByText(/解除中 · 保存版 4/).waitFor()
  const archiveDownload = page.waitForEvent('download')
  await vault.getByRole('button', { name: 'V3アーカイブJSONを書き出す（暗号化なし）' }).click()
  await (await archiveDownload).saveAs(join(output, 'restored-portable.json'))
  const restored = JSON.parse(await readFile(join(output, 'restored-portable.json'), 'utf8'))
  assert.equal(restored.records[0].record.title, '架空RC保存庫タスク')
  assert.equal(restored.records[0].sourceRevision, null)
  receipt.flows.push('confirmed-vault-restore-and-explicit-plaintext-archive-recovery')
  await vault.getByRole('button', { name: '保存庫をロックする' }).click()
  await vault.getByText('ロック中', { exact: true }).waitFor()
  receipt.flows.push('lock-revokes-read-and-ui-state')
  assert.equal(await page.evaluate(() => localStorage.getItem('today-prototype-state-v2')), before)
  const cacheURLs = await page.evaluate(async () => {
    const urls = []
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url)
    return urls
  })
  assert.equal(
    cacheURLs.some((url) => url.includes('/api/v3/vault/')),
    false,
  )
  receipt.flows.push('core-unchanged-and-vault-api-not-in-service-worker-cache')
  assert.deepEqual(receipt.pageErrors, [])
  assert.deepEqual(receipt.externalRequests, [])
  receipt.passed = true
} catch (error) {
  receipt.failure = String(error)
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
    await writeFile(join(output, 'failure-dom.txt'), await page.locator('body').innerText())
  }
  throw error
} finally {
  await browser?.close()
  await app?.close()
  await rm(axePath, { force: true })
  await rm(parent, { recursive: true, force: true })
  await writeFile(join(output, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
}
process.stdout.write(JSON.stringify(receipt, null, 2) + '\n')
