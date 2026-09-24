/**
 * Outgoing email. Magic links go through Auth.js's Nodemailer provider;
 * everything else (Invitations, …) goes through a `Mailer`, over the same
 * SMTP settings (Mailpit locally, http://localhost:8025).
 *
 * The API takes a `Mailer` in its context, so tests pass
 * `createMemoryMailer()` and read the sent messages from its `outbox`
 * instead of talking to SMTP.
 */
import { createTransport } from "nodemailer"

import { authEnv } from "./env"
import type { AuthEnv } from "./env"

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>
}

type SmtpEnv = Pick<
  AuthEnv,
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASSWORD"
  | "SMTP_SECURE"
  | "EMAIL_FROM"
>

/**
 * The SMTP connection URL. A URL rather than an options object: Auth.js's
 * Nodemailer provider deep-merges options over a default
 * `auth: { user: "", pass: "" }`, which makes nodemailer attempt (and fail)
 * AUTH against servers that advertise it.
 */
export function smtpUrl(env: SmtpEnv) {
  const url = new URL(
    `${env.SMTP_SECURE ? "smtps" : "smtp"}://${env.SMTP_HOST}`
  )
  url.port = String(env.SMTP_PORT)
  if (env.SMTP_USER) {
    url.username = env.SMTP_USER
    url.password = env.SMTP_PASSWORD ?? ""
  }
  return url.toString()
}

/** Sends through SMTP from `EMAIL_FROM`. The transport is created on first use. */
export function createSmtpMailer(env: SmtpEnv = authEnv()): Mailer {
  let transport: ReturnType<typeof createTransport> | undefined
  return {
    async send(message) {
      transport ??= createTransport(smtpUrl(env))
      await transport.sendMail({ from: env.EMAIL_FROM, ...message })
    },
  }
}

/** Keeps messages in memory (`outbox`, oldest first) — for tests. */
export function createMemoryMailer(): Mailer & { outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = []
  return {
    outbox,
    async send(message) {
      outbox.push(message)
    },
  }
}
