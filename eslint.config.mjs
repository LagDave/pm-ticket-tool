// Backend ESLint (flat config, ESLint 9 + typescript-eslint). Advisory baseline
// per Constitution §18: no-explicit-any, function size, nesting depth.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "frontend/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "knexfile.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn", // §17.2 / §4.5
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }], // §2.2
      "max-depth": ["warn", 4], // §2.3
      "no-console": "error", // §9.1 — Pino only
    },
  },
  {
    // Tests may exceed function-size limits for setup/teardown blocks.
    files: ["**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
      "max-lines-per-function": "off",
      "no-console": "off",
    },
  },
);
