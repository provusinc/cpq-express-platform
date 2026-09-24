import { config } from "@workspace/eslint-config/base"

/**
 * `domain` is pure: no I/O, no framework, no other workspace packages.
 * It is the only package imported by both the browser and the server.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@workspace/*", "node:*", "next", "next/*", "react"],
              message:
                "@workspace/domain must stay pure (no I/O, no framework).",
            },
            {
              group: ["drizzle-orm", "drizzle-orm/*", "postgres", "@trpc/*"],
              message:
                "@workspace/domain must stay pure (no I/O, no framework).",
            },
          ],
        },
      ],
    },
  },
]
