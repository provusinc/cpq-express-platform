import type { NextConfig } from "next"

// Validate env at startup (dev and build). Root .env is loaded by `pnpm with-env`.
import { env } from "./env"

const nextConfig: NextConfig = {
  transpilePackages: [
    "@workspace/ui",
    "@workspace/api",
    "@workspace/db",
    "@workspace/domain",
    "@workspace/auth",
    "@workspace/documents",
    "@workspace/storage",
  ],
  // Organization subdomains ({slug}.localtest.me) must reach the dev server.
  allowedDevOrigins: [env.ROOT_DOMAIN, `*.${env.ROOT_DOMAIN}`],
  // The root AGENTS.md already carries Next's agent rules; don't let
  // `next dev` write a second copy into apps/web.
  agentRules: false,
}

export default nextConfig
