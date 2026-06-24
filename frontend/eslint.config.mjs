// Frontend ESLint (flat config, ESLint 9 + typescript-eslint + react-hooks).
// Constitution §18 advisory baseline: no-explicit-any (§17.2), no-console
// (§17.1), function size (§13.2), depth (§2.3).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "error", // §17.2
      "no-console": "warn", // §17.1
      "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }], // §13.2 (JSX verbosity)
      "max-depth": ["warn", 4], // §2.3
    },
  },
);
