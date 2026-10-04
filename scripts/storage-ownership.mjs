import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Fresh fictional contexts only. Runs against both local and static public-mode builds. */
export async function verifyStorageOwnership(browser, base, output) {
  const flows = []
  const contexts = []
  const errors = []
  const createContext = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
    contexts.push(context)
    return context
  }
  const capture = async (page, title) => {
    await page.getByRole('textbox', { name: 'Todayに追加すること' }).fill(title)
    await page.getByRole('textbox', { name: 'Todayに追加すること' }).press('Enter')
    await page.getByRole('button', { name: 'Todayに追加', exact: true }).click()
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
  }
  const storedTitles = (page) =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('today-prototype-state-v2')).items.map((item) => item.title),
    )
  try {
    const context = await createContext()
    const first = await context.newPage()
    await first.goto(base)
    await first.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
    const second = await context.newPage()
    await second.goto(base)
    await second.getByRole('heading', { name: 'Todayの編集タブを確認しています' }).waitFor()
    assert.equal(await second.getByRole('textbox', { name: 'Todayに追加すること' }).count(), 0)
    await capture(first, '架空検証 タブAの整理')
    assert.deepEqual(await storedTitles(first), ['架空検証 タブAの整理'])
    await second.reload()
    await second.getByRole('heading', { name: 'Todayの編集タブを確認しています' }).waitFor()
    assert.deepEqual(await storedTitles(second), ['架空検証 タブAの整理'])
    if (output)
      await second.screenshot({ path: join(output, 'storage-waiting-tab.png'), fullPage: true })
    flows.push('second-tab-and-reload-cannot-edit-or-overwrite-owner')
    await first.close()
    await second.getByRole('heading', { name: '架空検証 タブAの整理', exact: true }).waitFor()
    await capture(second, '架空検証 タブBの整理')
    assert.deepEqual(
      new Set(await storedTitles(second)),
      new Set(['架空検証 タブAの整理', '架空検証 タブBの整理']),
    )
    await second.reload()
    await second.getByRole('heading', { name: '架空検証 タブAの整理', exact: true }).waitFor()
    await second.getByRole('heading', { name: '架空検証 タブBの整理', exact: true }).waitFor()
    flows.push('close-owner-handoff-loads-latest-and-preserves-both-additions')

    // Simulate persisted pagehide/pageshow to exercise reacquisition with a fresh App instance.
    await second.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
    )
    await second.getByRole('heading', { name: 'Todayの編集タブを確認しています' }).waitFor()
    await second.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    )
    await second.getByRole('heading', { name: '架空検証 タブAの整理', exact: true }).waitFor()
    flows.push('page-lifecycle-release-and-reacquisition')
    await context.close()

    const migrated = await createContext()
    const legacy = {
      version: 3,
      items: [
        {
          id: 'migration-fixture',
          kind: 'task',
          title: '架空検証 旧保存の項目',
          sourceId: 'manual',
        },
      ],
      theme: 'dark',
      intelligenceMode: 'DISABLED',
      showSamples: false,
      queuedActions: [],
    }
    await migrated.addInitScript((state) => {
      if (!/^https?:$/.test(location.protocol)) return
      if (!localStorage.getItem('today-prototype-state-v1'))
        localStorage.setItem('today-prototype-state-v1', JSON.stringify(state))
    }, legacy)
    const page = await migrated.newPage()
    await page.goto(base)
    await page.getByRole('heading', { name: '架空検証 旧保存の項目', exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('today-prototype-state-v2')).intelligenceMode,
      ),
      'DISABLED',
    )
    await capture(page, '架空検証 新保存の項目')
    // A legacy 2.0.1 tab writes the old slot; it cannot overwrite the migrated state.
    await page.evaluate(() =>
      localStorage.setItem('today-prototype-state-v1', JSON.stringify({ version: 3, items: [] })),
    )
    await page.reload()
    await page.getByRole('heading', { name: '架空検証 新保存の項目', exact: true }).waitFor()
    await page.getByRole('heading', { name: '架空検証 旧保存の項目', exact: true }).waitFor()
    flows.push('legacy-migration-preserves-settings-and-isolates-old-writer')
    await migrated.close()

    const idbOnly = await createContext()
    const idbPage = await idbOnly.newPage()
    await idbPage.goto(base)
    await idbPage.getByRole('heading', { name: '今すぐ対応するものはありません' }).waitFor()
    await capture(idbPage, '架空検証 保存完了待ち')
    await idbPage.waitForFunction(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('today-prototype-v1', 1)
          request.onsuccess = () => {
            const db = request.result
            const get = db.transaction('state').objectStore('state').get('current-v2')
            get.onsuccess = () => {
              resolve(get.result?.items?.some((item) => item.title === '架空検証 保存完了待ち'))
              db.close()
            }
          }
        }),
    )
    await idbPage.evaluate(
      (state) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('today-prototype-v1', 1)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('state', 'readwrite')
            transaction.objectStore('state').put(state, 'current')
            transaction.objectStore('state').delete('current-v2')
            transaction.oncomplete = () => {
              localStorage.removeItem('today-prototype-state-v2')
              localStorage.removeItem('today-prototype-state-v1')
              db.close()
              resolve()
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
          }
          request.onerror = () => reject(request.error)
        }),
      legacy,
    )
    await idbPage.reload()
    await idbPage.getByRole('heading', { name: '架空検証 旧保存の項目', exact: true }).waitFor()
    flows.push('legacy-indexeddb-only-migration-without-mirror')
    await idbOnly.close()

    const unsupported = await createContext()
    await unsupported.addInitScript(() =>
      Object.defineProperty(navigator, 'locks', { value: undefined }),
    )
    const blocked = await unsupported.newPage()
    await blocked.goto(base)
    await blocked.getByRole('heading', { name: '安全に保存できるブラウザが必要です' }).waitFor()
    assert.equal(await blocked.getByRole('textbox', { name: 'Todayに追加すること' }).count(), 0)
    assert.equal(
      await blocked.evaluate(() => localStorage.getItem('today-prototype-state-v2')),
      null,
    )
    flows.push('unsupported-locks-fail-closed-without-writing')
    assert.deepEqual(errors, [])
    return { passed: true, flows }
  } finally {
    for (const context of contexts) await context.close()
  }
}
