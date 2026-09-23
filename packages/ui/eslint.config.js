import { config } from "@workspace/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // niko-table is vendored from its shadcn registry (re-added with the
    // shadcn CLI, not hand-edited): its refs-in-render and effect patterns
    // trip the React Compiler rules, which then just skip those components.
    files: ["src/components/niko-table/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]
