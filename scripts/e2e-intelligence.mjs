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
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) break
    } catch {
      await delay(100)
    }
  }
  browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: /^設定$/ }).click()
  const mode = page.getByRole('combobox', { name: '処理方法' })
  assert.equal(await mode.inputValue(), 'LOCAL_ONLY')
  await page.getByText('ローカルモデル未導入。通常のTodayで動作中。').waitFor()
  await mode.selectOption('LOCAL_REMOTE_FALLBACK')
  await page.getByText('外部Providerは未設定です。ローカル機能は利用できます。').waitFor()
  const privateConsent = page.getByRole('checkbox', {
    name: '手動で登録した項目を外部モデルへ送ることを許可する',
  })
  assert.equal(await privateConsent.isChecked(), false)
  assert.equal(await privateConsent.isDisabled(), true)
  await page.getByText('手動項目の送信はサーバー設定で無効です。', { exact: false }).waitFor()
  const shadow = page.getByRole('checkbox', {
    name: 'モデル提案と手動修正の結果をこの端末だけに記録する',
  })
  assert.equal(await shadow.isChecked(), false)
  await shadow.check()
  await mode.selectOption('DISABLED')
  await page.getByText('AIは無効です。通常のTodayは引き続き利用できます。').waitFor()
  await page.getByRole('button', { name: '詳細設定' }).click()
  await page.getByText(/Gmailを含む接続サービス/).waitFor()
  assert.ok((await page.screenshot()).length > 1000)
  await page.reload()
  await page.getByRole('button', { name: /^設定$/ }).click()
  assert.equal(await page.getByRole('combobox', { name: '処理方法' }).inputValue(), 'DISABLED')
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'モデル提案と手動修正の結果をこの端末だけに記録する' })
      .isChecked(),
    true,
  )
  await page.getByRole('combobox', { name: '処理方法' }).selectOption('LOCAL_REMOTE_FALLBACK')
  assert.equal(
    await page
      .getByRole('checkbox', { name: '手動で登録した項目を外部モデルへ送ることを許可する' })
      .isChecked(),
    false,
  )
  await page.getByRole('combobox', { name: '処理方法' }).selectOption('DISABLED')
  await page.getByRole('button', { name: '閉じる' }).first().click()
  await page.getByRole('button', { name: /^追加$/ }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('牛乳を買う')
  await page.getByRole('button', { name: 'Todayに追加' }).click()
  await page.getByRole('heading', { name: '牛乳を買う' }).waitFor()
  assert.deepEqual(errors, [])
  process.stdout.write(
    JSON.stringify({
      passed: true,
      flows: [
        'default-local-mode',
        'zero-key-remote-mode',
        'private-consent-server-gate',
        'shadow-opt-in',
        'disabled-mode',
        'settings-persistence',
        'disabled-capture',
      ],
      consoleErrors: 0,
    }) + '\n',
  )
} finally {
  await browser?.close()
  server.kill()
}
