/**
 * Post-sign-in / sign-out redirect policy: relative paths stay on the app
 * host; absolute URLs are allowed only to the root domain or one of its
 * subdomains (Organization subdomains, `admin.`), on the app's scheme and
 * port. Anything else falls back to the app's base URL, so the sign-in flow
 * can never be used as an open redirect.
 */
export interface RedirectPolicy {
  /** Base URL of the sign-in app, e.g. `http://app.localtest.me:3000`. */
  appUrl: string
  /** e.g. `localtest.me`. */
  rootDomain: string
}

export function isAllowedRedirect(url: string, policy: RedirectPolicy) {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  const app = new URL(policy.appUrl)
  const root = policy.rootDomain.toLowerCase()
  const host = target.hostname.toLowerCase()
  return (
    target.protocol === app.protocol &&
    target.port === app.port &&
    !target.username &&
    !target.password &&
    (host === root || host.endsWith(`.${root}`))
  )
}

/** Resolves a requested redirect to a safe absolute URL. */
export function resolveRedirect(
  url: string,
  baseUrl: string,
  policy: RedirectPolicy
) {
  // Relative path (but not protocol-relative `//evil.com`).
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) {
    return new URL(url, baseUrl).toString()
  }
  return isAllowedRedirect(url, policy) ? url : baseUrl
}
