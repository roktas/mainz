// Exports the styled booklet Recipe and replays it against the same local book.

import { join } from "node:path"

export const title = "Save and reuse a booklet recipe"
export const description = "Save the booklet as a Recipe and reuse its pages and styles with the source PDF."
export const steps = [
  "Save this booklet as a Recipe",
  "Export the Recipe JSON file",
  "Some time later",
  "Choose the saved Recipe JSON file",
  "Choose the source PDF again to reuse the Recipe",
  "Check the match by selecting the underlined filename",
  "Apply the Recipe",
  "The Recipe restores the page order and print styling",
  "Check the restored fill and outlines with the Lens",
  "Check the booklet in Page view",
  "Download the restored PDF",
]

export async function record(h) {
  const { page } = h
  const output = page.locator(".composition-output")
  await h.cue(steps[0], () => h.click(output.getByRole("button", { name: "Export recipe", exact: true })))
  const panel = page.getByRole("dialog", { name: "Export recipe", exact: true })
  const saved = join(h.directory, "recipe.json")
  await h.cue(steps[1], async () => {
    const pending = page.waitForEvent("download")
    await h.click(panel.getByRole("button", { name: "Export", exact: true }))
    await (await pending).saveAs(saved)
  })
  await h.later(steps[2])
  await h.cue(steps[3], async () => {
    await h.choose(page.locator(".landing-recipe"), saved)
    await page.locator(".load-panel").waitFor()
  })
  const loader = page.locator(".load-panel")
  await h.cue(steps[4], async () => {
    await h.choose(loader.locator(".binding-empty").first(), h.book)
    await page.getByText("1 of 1 Inputs selected · Ready to apply recipe", { exact: true }).waitFor()
  })
  await h.cue(steps[5], async () => {
    await h.click(loader.locator(".binding-file"))
    await loader.getByText("The selected PDF matches this Recipe's saved Input.", { exact: true }).waitFor()
    await h.pause(1100)
    await h.click(loader.getByRole("button", { name: "Close details", exact: true }))
  })
  await h.cue(steps[6], async () => {
    await h.click(loader.getByRole("button", { name: "Apply recipe", exact: true }))
    await loader.waitFor({ state: "hidden" })
  })
  await h.cue(steps[7])
  await h.ready()
  await h.cue(steps[8], () => h.magnify())
  await h.cue(steps[9], () => h.inspect())
  await h.cue(steps[10], () => h.pdf("recipe.pdf"))
}
