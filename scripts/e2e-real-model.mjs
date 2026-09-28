import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const url = 'http://127.0.0.1:4197/'
const modelDir = process.env.TODAY_EVAL_QWEN3_MODEL_DIR
const python = process.env.TODAY_EVAL_PYTHON || 'python3'
const variant = process.env.TODAY_E2E_MODEL_VARIANT || 'alpha'
if (!modelDir) throw new Error('Set TODAY_EVAL_QWEN3_MODEL_DIR for real-model E2E')
if (!['alpha', 'beta', 'beta2', 'gamma'].includes(variant))
  throw new Error('Unsupported adapter variant')
const adapterDir = process.env.TODAY_E2E_ADAPTER_DIR
if (!adapterDir)
  throw new Error('Set TODAY_E2E_ADAPTER_DIR for the separately obtained experimental adapter')
const modelManifest = fileURLToPath(
  new URL('../models/today-model/manifests/qwen3-base-q4.json', import.meta.url),
)
const adapterManifest = fileURLToPath(
  new URL(
    `../models/today-model/manifests/today-model-${variant === 'alpha' ? 'alpha-0.1.0' : variant === 'beta2' ? 'beta-0.2.1' : variant === 'gamma' ? 'gamma-0.3.0' : 'beta-0.2.0'}.json`,
    import.meta.url,
  ),
)
const server = spawn(process.execPath, ['server/index.mjs', '--production', '--port', '4197'], {
  cwd: root,
  stdio: 'pipe',
  env: {
    ...process.env,
    TODAY_LOCAL_MODEL_DIR: modelDir,
    TODAY_LOCAL_PYTHON: python,
    TODAY_LOCAL_MODEL_MANIFEST: modelManifest,
    TODAY_LOCAL_ADAPTER_DIR: adapterDir,
    TODAY_LOCAL_ADAPTER_MANIFEST: adapterManifest,
    TODAY_LOCAL_MODEL_PORT: '8097',
  },
})
let browser
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    try {
      const status = await (await fetch(url + 'api/local-model/status')).json()
      if (status.state === 'READY') {
        ready = true
        break
      }
    } catch {
      /* Starting. */
    }
    await delay(100)
  }
  assert.equal(ready, true, 'Verified local model must be READY')
  browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const externalRequests = []
  page.on('request', (request) => {
    if (!request.url().startsWith(url) && !request.url().startsWith('data:'))
      externalRequests.push(request.url())
  })
  await page.goto(url)
  await page.getByRole('button', { name: /^設定$/ }).click()
  await page.getByText('ローカルモデルを検証済み。必要時に起動できます。').waitFor()
  await page.getByRole('button', { name: 'ローカルモデルを起動' }).click()
  await page.getByText('ローカルモデルがこの端末で稼働中。').waitFor({ timeout: 20_000 })
  await page.getByRole('combobox', { name: '処理方法' }).selectOption('DISABLED')
  await page.getByText('AIは無効です。通常のTodayは引き続き利用できます。').waitFor()
  assert.deepEqual(externalRequests, [])
  process.stdout.write(
    JSON.stringify({
      passed: true,
      flows: ['verified-model-status', 'real-model-load', 'ai-disabled-fallback'],
      externalRequests: 0,
    }) + '\n',
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5_000)])
}
