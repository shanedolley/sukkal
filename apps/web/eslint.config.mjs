import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // KPA-67 vendored-code overrides. Each block names one registry path and
  // the rules it disables there, with the reason lint would otherwise force
  // a rewrite of code this project did not author. A finding in code this
  // project wrote gets fixed instead; see hooks/use-mobile.ts and the small
  // dead-code trims in components/reui/data-grid, none of which appear here.

  {
    // The ReUI app-shell block's client-mount flag. It defers rendering
    // until hydration completes, so the app never shows a server-guessed
    // theme before correcting to the real one. That is a one-time flip with
    // no external store to subscribe to, unlike hooks/use-mobile.ts, so the
    // fix applied there does not carry over. Rewriting this vendored block
    // to avoid the flip risks a hydration mismatch, which is worse than the
    // extra render the rule warns about.
    files: ["components/blocks/app-shell-1/components/nav-user.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },

  {
    // The Bklit chart registry (components/charts). Its animation and
    // scale-tracking hooks read and write refs during render by design, so
    // a resize or a data update can redraw a path in the same frame instead
    // of one frame behind. Making that pattern effect-driven, as the rule
    // wants, would change when a chart repaints, which is exactly the
    // rendering change this story forbids fixing lint by making.
    files: ["components/charts/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    // Also in components/charts: the curve-factory type the registry
    // approximates as `any`, carried over from its origin (see the
    // `biome-ignore` comment above each use). Typing it exactly means
    // reproducing d3's own curve-factory generics here, for a type that
    // never leaves this file.
    files: [
      "components/charts/area.tsx",
      "components/charts/line.tsx",
      "components/charts/loading-sweep.tsx",
      "components/charts/pattern-area.tsx",
      "components/charts/projection-line.tsx",
      "components/charts/series-path-utils.ts",
      "components/charts/use-animated-series-path.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Also in components/charts: chart-context.tsx declares a second type
    // parameter on ScaleLinear and ScaleTime that its own body never reads.
    // It exists so callers can write ScaleLinear<Output, Input> to match
    // d3's real scale signature; removing it would drop that from the type
    // callers already depend on.
    files: ["components/charts/chart-context.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  {
    // The ReUI data-grid registry (components/reui/data-grid). Its table,
    // scroll and virtualization internals read refs during render and set
    // state from effects to keep a large, actively scrolled table in sync
    // with TanStack Table and TanStack Virtual without re-rendering every
    // row on every frame. Reworking that synchronization to satisfy these
    // rules means redesigning how the grid renders, not fixing a lint
    // finding.
    files: ["components/reui/data-grid/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      // data-grid.tsx builds two memo keys with JSON.stringify so an object
      // prop only re-triggers the memo when its contents change, not its
      // identity. The rule wants a dependency list of simple expressions,
      // which this deliberate pattern cannot be without losing that check.
      "react-hooks/use-memo": "off",
      // data-grid-table-virtual.tsx calls TanStack Virtual's
      // useVirtualizer(), which returns functions the React Compiler cannot
      // memoize safely. That is a property of the library, not of this
      // code, so the compiler already skips memoizing here; the warning
      // just says so.
      "react-hooks/incompatible-library": "off",
    },
  },
]);

export default eslintConfig;
