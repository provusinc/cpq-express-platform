import { defineConfig } from "vitest/config"

// Unit tests for pure app modules (e.g. lib/hosts.ts). UI is not tested here.
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"] },
})
