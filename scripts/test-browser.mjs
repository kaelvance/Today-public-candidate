import { chromium, firefox, webkit } from 'playwright-core'

/** Explicit executable for local machines; CI downloads pinned Playwright Chromium. */
export function launchBrowser() {
  const engine = process.env.TODAY_TEST_BROWSER || 'chromium'
  const browsers = { chromium, firefox, webkit }
  if (!Object.hasOwn(browsers, engine)) throw new Error('Invalid test browser')
  return browsers[engine].launch({
    headless: true,
    ...(engine === 'chromium' && process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  })
}
