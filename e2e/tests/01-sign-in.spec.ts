import { expect, test } from "@playwright/test"

import { signIn } from "../support/auth"
import { acmeUrl } from "../support/urls"
import { OWNER } from "../support/users"

test("magic-link sign-in on app. lands in the Organization", async ({
  page,
}) => {
  await signIn(page, OWNER)

  // A single-Membership User is forwarded from the picker to acme.
  await page.waitForURL(acmeUrl("/**"))
  await expect(page.getByRole("link", { name: "Quotes" }).first()).toBeVisible()
})
