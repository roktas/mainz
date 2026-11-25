// Shares List view setup helpers across List browser test suites.

import { setup, tab } from "./browser.js"

export async function lists(browser, url, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce", ...options })
  page.setDefaultTimeout(10000)
  await setup(page)
  await page.goto(`${url}?demo=single`)
  await page.locator('.composer[aria-busy="false"]').waitFor()
  const input = page.locator(".selection-panel"),
    output = page.locator(".composition-output")
  await tab(input, "List")
  await tab(output, "List")
  return { page, input, output }
}

export async function blankList(browser, url, count, reducedMotion = "reduce") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion })
  page.setDefaultTimeout(10000)
  await setup(page)
  await page.goto(url)
  await page.locator('.landing-recipe input[type="file"]').setInputFiles({
    name: "Blank pages.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        inputs: {},
        sources: {},
        parts: [
          { pages: Array.from({ length: count / 1000 }, () => ({ blank: { width: 80, height: 100 } })), copies: 1000 },
        ],
      }),
    ),
  })
  await page.getByRole("button", { name: "Apply recipe", exact: true }).click()
  await page.locator('.composer[aria-busy="false"]').waitFor()
  return { page, output: page.locator(".composition-output") }
}
