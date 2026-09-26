import { config } from "@workspace/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Everything in src/components and src/hooks is vendored: stock shadcn
    // components and the niko-table and ReUI registries, written by the
    // shadcn CLI and never hand-edited (see "UI component policy" in
    // AGENTS.md). Their
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
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // The ReUI Gantt isn't written for noUncheckedIndexedAccess, and
    // TypeScript can't relax that per folder: those files open with
    // @ts-nocheck (see AGENTS.md).
    files: ["src/components/reui/**"],
    rules: { "@typescript-eslint/ban-ts-comment": "off" },
  },
]
