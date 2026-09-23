/** Absolute URLs of the app's surfaces, from ROOT_DOMAIN and PORT in `.env`. */
const rootDomain = process.env.ROOT_DOMAIN ?? "localtest.me"
const port = process.env.PORT ?? "3000"

/** `http://<subdomain>.<ROOT_DOMAIN>:<PORT><path>` */
export function surfaceUrl(subdomain: string, path = "/"): string {
  return `http://${subdomain}.${rootDomain}:${port}${path}`
}

export const appUrl = (path = "/") => surfaceUrl("app", path)
export const acmeUrl = (path = "/") => surfaceUrl("acme", path)
export const healthUrl = () => `http://localhost:${port}/api/health`

/** Mailpit's HTTP API (docker compose; MAILPIT_UI_PORT overrides the port). */
export const MAILPIT_URL = "http://localhost:8025"
