import { readFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../support/auth"
import {
  addItems,
  createQuote,
  openQuoteTab,
  uniqueQuoteName,
} from "../support/quotes"
import { APPROVER, OWNER } from "../support/users"

/** Runs an approval transition: its header button, then the dialog's confirm. */
async function transition(page: Page, label: string, dialogTitle = label) {
  await page.getByRole("button", { name: label }).click()
  const dialog = page.getByRole("dialog", { name: dialogTitle })
  await dialog.getByRole("button", { name: label }).click()
  await expect(dialog).toBeHidden()
}

test("submit, approve as another User, Mark as Sent and download the Quote Document", async ({
  page,
  browser,
}) => {
  await signIn(page, OWNER)
  const quoteUrl = await createQuote(page, uniqueQuoteName("approval"))
  await addItems(page, ["Resource Roles"])

  await transition(page, "Submit for approval")
  await expect(page.getByRole("button", { name: "Recall" })).toBeVisible()

  const approverContext = await browser.newContext()
  try {
    const approverPage = await approverContext.newPage()
    await signIn(approverPage, APPROVER, quoteUrl)
    await approverPage.waitForURL(quoteUrl)
    await transition(approverPage, "Approve", "Approve this Quote")
  } finally {
    await approverContext.close()
  }

  await page.reload()
  await transition(page, "Mark as Sent")
  await expect(page.getByRole("button", { name: "Mark as Sent" })).toHaveCount(
    0
  )

  await openQuoteTab(page, "Documents")
  const downloading = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download" }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF")
})
