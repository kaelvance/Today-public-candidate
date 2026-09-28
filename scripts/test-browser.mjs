import { chromium } from 'playwright-core'

/** Explicit executable for local machines; CI downloads pinned Playwright Chromium. */
export function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  })
}
