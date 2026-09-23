import { config } from "@workspace/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Everything in src/components and src/hooks is vendored: stock shadcn
    // components and the niko-table registry, written by the shadcn CLI and
    // never hand-edited (see "UI component policy" in AGENTS.md). Their
    // refs-in-render and effect patterns trip the React Compiler rules,
    // which then just skip those components.
    files: ["src/components/**", "src/hooks/**"],
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
