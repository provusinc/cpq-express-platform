import "server-only"

import { headers } from "next/headers"

import { env } from "@/env"

import { REQUEST_PATH_HEADER, surfaceOrigin } from "./hosts"

/**
 * Absolute URLs between surfaces (server only; built from APP_URL and
 * ROOT_DOMAIN). Within a surface, link with plain public paths instead.
 */
export function appUrl(path = "/") {
  return new URL(path, env.APP_URL).toString()
}

export function adminUrl(path = "/") {
  return new URL(
    path,
    surfaceOrigin(env.APP_URL, env.ROOT_DOMAIN, { kind: "admin" })
  ).toString()
}

export function organizationUrl(slug: string, path = "/") {
  return new URL(
    path,
    surfaceOrigin(env.APP_URL, env.ROOT_DOMAIN, { kind: "organization", slug })
  ).toString()
}

/** The sign-in page on `app.`, returning to `callbackUrl` afterwards. */
export function signInUrl(callbackUrl: string) {
  return appUrl(`/sign-in?${new URLSearchParams({ callbackUrl })}`)
}

/** The public path + query of the current request (set by the proxy). */
export async function currentPath() {
  return (await headers()).get(REQUEST_PATH_HEADER) ?? "/"
}
