import { expect, type Page } from "@playwright/test"

import { appUrl, MAILPIT_URL } from "./urls"

interface MailpitSummary {
  ID: string
}

async function mailpit(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${MAILPIT_URL}${path}`, init)
  if (!response.ok) {
    throw new Error(
      `Mailpit ${init?.method ?? "GET"} ${path}: ${response.status}`
    )
  }
  return response
}

const searchFor = (email: string) =>
  `/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`

/** Deletes every message addressed to `email`, so the next one is ours. */
async function clearInbox(email: string) {
  await mailpit(searchFor(email), { method: "DELETE" })
}

/** Polls Mailpit for the newest message to `email` and returns its sign-in link. */
async function magicLink(email: string): Promise<string> {
  let link: string | undefined
  await expect
    .poll(
      async () => {
        const { messages } = (await (
          await mailpit(`${searchFor(email)}&limit=1`)
        ).json()) as { messages: MailpitSummary[] }
        const id = messages[0]?.ID
        if (!id) return undefined
        const message = (await (
          await mailpit(`/api/v1/message/${id}`)
        ).json()) as { Text: string; HTML: string }
        link = /https?:\/\/\S+\/api\/auth\/callback\/\S+/.exec(
          message.Text
        )?.[0]
        return link
      },
      { message: `a magic link email to ${email}`, timeout: 30_000 }
    )
    .toBeTruthy()
  return link!
}

/**
 * Signs `page`'s browser context in as `email` through the real magic-link
 * flow: request a link on `app.`, read it from Mailpit and visit it. The
 * session cookie is scoped to `.<ROOT_DOMAIN>`, so every subdomain sees it.
 * `callbackUrl` is where the link lands (default: the Organization picker,
 * which forwards a single-Membership User to their Organization).
 */
export async function signIn(page: Page, email: string, callbackUrl?: string) {
  await clearInbox(email)
  const query = callbackUrl
    ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : ""
  await page.goto(appUrl(`/sign-in${query}`))
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Email me a sign-in link" }).click()
  await page.waitForURL(/\/check-email/)
  await page.goto(await magicLink(email))
}
