import { expect, test } from "@playwright/test"

import { signIn } from "../support/auth"
import {
  addItems,
  createQuote,
  openQuoteTab,
  uniqueQuoteName,
} from "../support/quotes"
import { OWNER } from "../support/users"

test("create a Quote, add items and plan hours with autosave", async ({
  page,
}) => {
  await signIn(page, OWNER)
  await createQuote(page, uniqueQuoteName("planner"))
  await addItems(page, ["Resource Roles", "Products"])
  await expect(
    page.getByRole("checkbox", { name: /^Select (?!all )/ })
  ).toHaveCount(2)

  await openQuoteTab(page, "Resource Planner")
  const grid = page.getByRole("grid", { name: "Resource Planner" })
  const total = page.getByRole("status", { name: "Quote Total" })
  await expect(total).toBeVisible()
  const totalBefore = await total.textContent()

  // A whole period (the second), so any small amount is within its cap.
  const cell = grid.getByRole("gridcell").nth(1)
  const hours = (await cell.textContent())?.trim() === "7" ? "8" : "7"
  await cell.click()
  await page.keyboard.type(hours)
  await grid.getByLabel("Hours").press("Enter")

  await expect(cell).toHaveText(hours)
  await expect(total).not.toHaveText(totalBefore ?? "")
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /^save$/i })).toHaveCount(0)
})
