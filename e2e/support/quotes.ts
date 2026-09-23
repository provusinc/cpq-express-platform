import { expect, type Page } from "@playwright/test"

import { acmeUrl } from "./urls"

/** A Quote Name no earlier run used. */
export const uniqueQuoteName = (flow: string) =>
  `E2E ${flow} ${new Date().toISOString()}`

/**
 * Creates a Quote on the first Account through the New Quote dialog and
 * waits for its editor. Returns the editor URL.
 */
export async function createQuote(page: Page, name: string): Promise<string> {
  await page.goto(acmeUrl("/quotes"))
  await page.getByRole("button", { name: "New Quote" }).click()
  const dialog = page.getByRole("dialog", { name: "New Quote" })
  await dialog.getByLabel("Account").click()
  await page.getByRole("option").first().click()
  await dialog.getByLabel("Name").fill(name)
  await dialog.getByRole("button", { name: "Create Quote" }).click()
  await page.waitForURL(/\/quotes\/[0-9a-f-]{36}$/)
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(name)
  return page.url()
}

/**
 * Adds the first item of each named Add Items tab (e.g. "Resource Roles",
 * "Products") as one gesture, from the Line Items tab.
 */
export async function addItems(page: Page, tabs: string[]) {
  await page.getByRole("button", { name: "Add items" }).first().click()
  const sheet = page.getByRole("dialog", { name: "Add items" })
  for (const tab of tabs) {
    await sheet.getByRole("tab", { name: tab }).click()
    await sheet.getByRole("tabpanel").getByRole("checkbox").first().check()
  }
  const count = tabs.length
  await sheet
    .getByRole("button", {
      name: `Add ${count} item${count === 1 ? "" : "s"}`,
    })
    .click()
  await expect(sheet).toBeHidden()
}

/** Opens one of the Quote editor's tabs by its label. */
export async function openQuoteTab(page: Page, label: string) {
  await page
    .getByRole("tablist", { name: "Quote" })
    .getByRole("tab", { name: label })
    .click()
}
