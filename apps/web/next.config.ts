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
  ],
  // Organization subdomains ({slug}.localtest.me) must reach the dev server.
  allowedDevOrigins: [env.ROOT_DOMAIN, `*.${env.ROOT_DOMAIN}`],
}

export default nextConfig
