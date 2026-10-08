import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './test-browser.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const output = resolve(args[0] || join(tmpdir(), 'today-v2-ui'))
const prefix = args[1] === 'archive' ? 'archive' : 'source'
const distance = relative(root, output)
assert(distance === '..' || distance.startsWith(`..${sep}`), 'Evidence outside source')
await mkdir(output, { recursive: true })
const require = createRequire(import.meta.url)
const axePath = require.resolve('axe-core/axe.min.js')
// Temporary build-only fixture: real same-origin delivery also works when SW
// handles requests that cannot be intercepted by Playwright context.route.
const axeFixture = join(root, 'dist', '__test_axe.js')
await writeFile(axeFixture, await readFile(axePath))
const url = 'http://127.0.0.1:4187/'
const server = spawn(process.execPath, ['server/index.mjs', '--production', '--port', '4187'], {
  stdio: 'pipe',
})
let browser, page
const record = {
  passed: false,
  flows: [],
  accessibility: [],
  screenshots: [],
  errors: [],
  axeVersion: require('axe-core/package.json').version,
  fixtureClock: '2026-10-01T09:00:00+09:00',
  widths: [320, 390, 820, 1440],
  scope: `${process.env.TODAY_TEST_BROWSER || 'chromium'} automation, WCAG A/AA including 2.1/2.2 tags; manual assistive-technology validation is separate`,
}
async function accessible(label) {
  await page.waitForFunction(() => {
    const expected =
      document.documentElement.dataset.theme === 'dark' ? 'rgb(238, 234, 224)' : 'rgb(37, 38, 33)'
    return [...document.querySelectorAll('h1,h2,h3')].every((n) => {
      const style = getComputedStyle(n)
      return (
        style.color === expected && style.getPropertyValue('-webkit-text-fill-color') === expected
      )
    })
  })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  // Each measurement owns a fresh axe lifecycle after rendering settles.
  await page.addScriptTag({ url: new URL('__test_axe.js', url).href })
  const result = await page.evaluate(async () => {
    const value = await window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    })
    return {
      theme: document.documentElement.dataset.theme,
      background: getComputedStyle(document.body).backgroundColor,
      rootBackground: getComputedStyle(document.documentElement).backgroundColor,
      headingColors: [...document.querySelectorAll('h1,h2,h3')].map((n) => ({
        text: n.textContent,
        color: getComputedStyle(n).color,
      })),
      violations: value.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      incomplete: value.incomplete.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      passes: value.passes.length,
    }
  })
  record.accessibility.push({ label, ...result })
  assert.deepEqual(result.violations, [], `Accessibility: ${label}`)
}
async function shot(label) {
  const file = `v2-${prefix}-${label}.png`
  await page.screenshot({ path: join(output, file), fullPage: true })
  record.screenshots.push(file)
}
const nav = () =>
  page.getByRole('navigation', {
    name: page.viewportSize().width >= 1100 ? 'メインナビゲーション' : 'モバイルナビゲーション',
  })
async function navigate(label) {
  await nav().getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('heading', { name: label, exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'view-heading')
  assert.equal(
    await nav().getByRole('button', { name: label, exact: true }).getAttribute('aria-current'),
    'page',
  )
}
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) break
    } catch {
      /* starting */
    }
    await delay(100)
  }
  browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  page = await context.newPage()
  page.on('pageerror', (error) => record.errors.push(error.message))
  await page.clock.setFixedTime(new Date(record.fixtureClock))
  await page.goto(url)
  await page.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
  await accessible('mobile-empty')
  await shot('empty')
  record.flows.push('empty-state')
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).fill('V2 priority')
  const imeEnterPrevented = await page
    .getByRole('textbox', { name: 'Todayに追加すること' })
    .evaluate((input) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      })
      input.dispatchEvent(event)
      return event.defaultPrevented
    })
  assert(imeEnterPrevented)
  assert.equal(await page.getByRole('dialog').count(), 0)
  record.flows.push('ime-composition-enter-guard')
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
  await page.getByRole('dialog', { name: 'すばやく追加' }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'やること・予定' }).inputValue(),
    'V2 priority',
  )
  await accessible('capture-dialog')
  assert.equal(await page.locator('main').getAttribute('inert'), '')
  await page.keyboard.press('Escape')
  assert.equal(
    await page.getByRole('textbox', { name: 'Todayに追加すること' }).inputValue(),
    'V2 priority',
  )
  await navigate('やること')
  await navigate('Today')
  assert.equal(
    await page.getByRole('textbox', { name: 'Todayに追加すること' }).inputValue(),
    'V2 priority',
  )
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
  await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await page.getByRole('heading', { name: 'V2 priority' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Todayに追加すること' }).inputValue(), '')
  await page.reload()
  await page.getByRole('heading', { name: 'V2 priority' }).waitFor()
  record.flows.push(
    'quick-entry-confirmation',
    'quick-entry-cancel-and-navigation-draft',
    'persist-reload',
    'modal-inert',
  )
  await navigate('やること')
  await page.getByRole('heading', { name: 'V2 priority' }).waitFor()
  await page.getByRole('button', { name: '完了にする', exact: true }).click()
  await navigate('ふりかえり')
  await page.getByRole('button', { name: 'V2 priorityを戻す' }).click()
  await navigate('やること')
  await page.getByRole('heading', { name: 'V2 priority' }).waitFor()
  record.flows.push('all-items', 'review-restore', 'navigation-focus')
  await page.getByRole('button', { name: '追加', exact: true }).click()
  await page.getByRole('textbox', { name: 'やること・予定' }).fill('V2 calendar meeting')
  await page.getByRole('button', { name: '予定', exact: true }).click()
  await page.getByRole('textbox', { name: '開始時刻' }).fill('2026-10-02T15:00')
  await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await navigate('カレンダー')
  await page.getByRole('button', { name: /V2 calendar meeting/ }).click()
  await page.getByRole('dialog', { name: 'V2 calendar meeting' }).waitFor()
  await page.keyboard.press('Escape')
  await navigate('やること')
  await page.getByRole('textbox', { name: 'Todayを検索' }).fill('V2 priority')
  assert.equal(await page.getByRole('heading', { name: 'V2 calendar meeting' }).count(), 0)
  await page.getByRole('textbox', { name: 'Todayを検索' }).fill('')
  record.flows.push('future-calendar-detail', 'search-in-destination')
  const longTitle =
    '資料の内容を確認して関係者と調整する'.repeat(5) + 'UnbrokenEnglishTitle'.repeat(4)
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).fill(longTitle)
  await page.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
  await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await page.getByRole('heading', { name: longTitle, exact: true }).waitFor()
  record.flows.push('long-japanese-and-english-title')
  await navigate('Today')
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByRole('button', { name: 'ライト', exact: true }).click()
  await page.getByRole('button', { name: 'サンプルを表示', exact: true }).click()
  await accessible('settings-light')
  await page.keyboard.press('Escape')
  for (const width of record.widths) {
    await page.setViewportSize({ width, height: 900 })
    await navigate('Today')
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
      `Overflow ${width}`,
    )
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1)
    const tooSmall = await nav()
      .getByRole('button')
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => {
            const r = n.getBoundingClientRect()
            return r.width < 44 || r.height < 44
          })
          .map((n) => n.textContent),
      )
    assert.deepEqual(tooSmall, [], `Navigation targets ${width}`)
    await accessible(`light-${width}`)
    await shot(`light-${width}`)
    for (const label of ['やること', 'カレンダー', 'ふりかえり']) {
      await navigate(label)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
      await accessible(`${label}-${width}`)
    }
  }
  record.flows.push(
    'four-responsive-destinations',
    'touch-targets',
    'heading-hierarchy',
    'washi-light',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  for (const label of ['Today', 'やること', 'カレンダー', 'ふりかえり']) {
    await navigate(label)
    // Simulate text-only 200% resize without changing viewport or app state.
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('body *')].filter((n) => n instanceof HTMLElement)
      const sizes = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize))
      nodes.forEach((n, i) => {
        n.dataset.testOriginalFont = n.style.fontSize
        n.style.fontSize = `${sizes[i] * 2}px`
      })
    })
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
      `200% text overflow ${label}`,
    )
    const navigationGeometry = await page.locator('.bottom-nav').evaluate((nav) => {
      const bounds = nav.getBoundingClientRect()
      const labels = [...nav.querySelectorAll('button')].map((button) => {
        const target = button.getBoundingClientRect()
        const text = button.querySelector('span').getBoundingClientRect()
        return { label: button.textContent, target: target.toJSON(), text: text.toJSON() }
      })
      return { viewport: innerHeight, bounds: bounds.toJSON(), labels }
    })
    await writeFile(
      join(output, `navigation-geometry-${label}.json`),
      JSON.stringify(navigationGeometry, null, 2),
    )
    assert(
      navigationGeometry.labels.every(
        ({ target, text }) =>
          target.top >= navigationGeometry.bounds.top - 1 &&
          target.bottom <= navigationGeometry.viewport + 1 &&
          text.top >= target.top - 1 &&
          text.bottom <= target.bottom + 1 &&
          text.bottom <= navigationGeometry.viewport + 1,
      ),
      `200% navigation label clipped ${label}`,
    )
    await shot(`text-resize-${label}`)
    await page.evaluate(() => {
      for (const n of document.querySelectorAll('[data-test-original-font]')) {
        n.style.fontSize = n.dataset.testOriginalFont
        delete n.dataset.testOriginalFont
      }
    })
  }
  record.flows.push('200-percent-text-resize-four-views')
  await page.setViewportSize({ width: 390, height: 844 })
  await navigate('Today')
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByRole('button', { name: 'ダーク', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await accessible('sumi-dark-mobile')
  await shot('dark-mobile')
  await page.setViewportSize({ width: 1440, height: 900 })
  await accessible('sumi-dark-desktop')
  await shot('dark-desktop')
  const duration = await page
    .locator('.button')
    .first()
    .evaluate((n) => parseFloat(getComputedStyle(n).transitionDuration))
  assert(duration <= 0.001, 'Reduced motion')
  record.flows.push('sumi-dark-persist', 'reduced-motion')
  const failureContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
  })
  const failurePage = await failureContext.newPage()
  await failurePage.goto(url)
  await failurePage.getByRole('textbox', { name: 'Todayに追加すること' }).waitFor()
  // Reading must first succeed. A write-only failure cannot be modeled by
  // denying initial reads: those now correctly block the application instead.
  await failurePage.evaluate(() => {
    IDBFactory.prototype.open = () => {
      throw new Error('fictional write unavailable')
    }
    Storage.prototype.setItem = () => {
      throw new Error('fictional write unavailable')
    }
  })
  await failurePage.getByRole('textbox', { name: 'Todayに追加すること' }).fill('架空 保存失敗検証')
  await failurePage.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
  await failurePage.getByRole('button', { name: 'Todayに追加', exact: true }).click()
  await failurePage.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor()
  await failurePage.screenshot({
    path: join(output, `v2-${prefix}-storage-error.png`),
    fullPage: true,
  })
  record.flows.push('storage-error-visible')
  assert.deepEqual(record.errors, [])
  record.passed = true
  console.log(
    JSON.stringify({
      passed: true,
      flows: record.flows,
      accessibilityChecks: record.accessibility.length,
      violations: 0,
      widths: record.widths,
    }),
  )
} catch (error) {
  record.failure = error.message
  if (page)
    await page
      .screenshot({ path: join(output, `v2-${prefix}-failure.png`), fullPage: true })
      .catch(() => {})
  throw error
} finally {
  await rm(axeFixture, { force: true })
  await writeFile(
    join(output, `v2-${prefix}-ui-report.json`),
    JSON.stringify(record, null, 2) + '\n',
  )
  await browser?.close()
  server.kill('SIGTERM')
}
