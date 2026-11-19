// Selects, repeats, and adjusts two practice pages for printing through the UI.

import assert from "node:assert/strict"

export const title = "Prepare a styled booklet"
export const description = "Build a four-page practice booklet and preview darker fills and thicker outlines for print."
export const steps = [
  "Open the practice book",
  "Switch Input to List",
  "Fold all section headings",
  "Open ARCH and add ITAL-ARCH-60A4-WXGF",
  "Open MIXB and add ITAL-MIXB-60A4-WXGF",
  "Duplicate each Output page once",
  "Four pages make two double-sided sheets",
  "The pages are ready. Now let’s style them",
  "Start with a profile that suits your printer",
  "Or…",
  "Create your own style",
  "Check the starting pattern with the Lens",
  "Darken the pattern fill",
  "Thicken the outlines with +",
  "Compare the same detail with the Lens",
  "Check the booklet in Page view",
  "Download the styled PDF",
  "Or print a test sheet to check the result",
]

export async function prepare(h) {
  const { page } = h
  const input = page.locator(".selection-panel")
  const output = page.locator(".composition-output")
  await h.cue(steps[0], async () => {
    await h.choose(
      page
        .locator(".file-picker")
        .filter({ has: page.getByLabel("Open PDF", { exact: true }) })
        .first(),
      h.book,
    )
    await page.locator(".composer[aria-busy=false]").waitFor()
  })
  await h.cue(steps[1], () => h.click(input.getByRole("tab", { name: "List", exact: true })))
  await h.cue(steps[2], () => h.click(input.getByRole("button", { name: "Fold all Input sections", exact: true })))
  await h.cue(steps[3], async () => {
    await h.click(input.getByRole("button", { name: "Unfold Input section: ARCH", exact: true }))
    await h.pause()
    await h.click(input.getByRole("button", { name: "Add Input page 7 to Output", exact: true }), true)
  })
  await h.cue(steps[4], async () => {
    await h.click(input.getByRole("button", { name: "Fold Input section: ARCH", exact: true }))
    await h.click(input.getByRole("button", { name: "Unfold Input section: MIXB", exact: true }))
    await h.pause()
    await h.click(input.getByRole("button", { name: "Add Input page 32 to Output", exact: true }), true)
  })
  await h.cue(steps[5], async () => {
    await h.click(output.getByRole("tab", { name: "List", exact: true }))
    for (const number of [1, 3]) {
      await h.click(output.getByRole("button", { name: `Duplicate Output page ${number}`, exact: true }), true)
      await h.pause()
    }
  })
  assert.equal(await output.locator(".composition-totals strong").textContent(), "4 pages")
  await h.cue(steps[6])
  await h.cue(steps[7], () => h.click(input.getByRole("tab", { name: "Style", exact: true })))
  await h.cue(steps[8], async () => {
    const profile = input.getByRole("combobox", { name: "Style profile", exact: true })
    await profile.hover()
    await h.pause(2300)
    await profile.selectOption({ label: "Filled" })
    await h.ready()
  })
  await h.cue(steps[9], () => h.pause(850), { centered: true })
  await h.cue(steps[10])
  await h.cue(steps[11], () => h.magnify())
  const pattern = input.getByRole("group", { name: "Pattern", exact: true })
  await h.cue(steps[12], async () => {
    await h.click(pattern.getByRole("button", { name: "Edit Fill", exact: true }))
    const color = pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true })
    await h.click(color)
    await h.pause()
    await color.fill("#606060")
    await color.press("Tab")
    assert.equal(await color.inputValue(), "#606060")
    await h.ready()
    await h.pause()
    await page.keyboard.press("Escape")
  })
  await h.cue(steps[13], async () => {
    await h.click(pattern.getByRole("button", { name: "Edit Width", exact: true }))
    const width = pattern.getByRole("spinbutton", { name: "Pattern Stroke Width (mm)", exact: true })
    assert.equal(await width.inputValue(), "0.32")
    const increase = pattern.getByRole("button", { name: "Increase Pattern Stroke Width", exact: true })
    for (const expected of ["0.336", "0.3528", "0.3704"]) {
      await h.click(increase)
      assert.equal(await width.inputValue(), expected)
      await h.pause(350)
    }
    await h.ready()
    await h.pause()
    await page.keyboard.press("Escape")
  })
}

export async function record(h) {
  await prepare(h)
  await h.cue(steps[14], () => h.magnify())
  await h.cue(steps[15], () => h.inspect())
  await h.cue(steps[16], () => h.pdf("booklet.pdf"))
  await h.cue(steps[17], async () => {
    const { page } = h
    await h.click(page.locator(".composition-output").getByRole("button", { name: "Print PDF", exact: true }))
    await page.waitForFunction(() => {
      const pdf = document.querySelector(".print-frame")?.contentDocument
      return pdf?.contentType === "application/pdf" && pdf.readyState === "complete"
    })
  })
  await h.cue()
}
