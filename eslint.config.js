// ESLint flat config (ADR-0001, ADR-0009). Type-aware rules are deliberately not enabled at the root to keep
// `pnpm lint` fast and independent of a prior build; packages may add stricter local configs later.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "test-results/**",
      "playwright-report/**",
      "docs/**",
      "tools/**",
      "trading_agent/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-restricted-syntax": [
        "error",
        {
          // Money and rates never use binary floating point (ADR-0003): parseFloat on domain values is banned.
          selector: "CallExpression[callee.name='parseFloat']",
          message: "Use Decimal (decimal.js via @mth/shared) for money, rates and KPI values, never parseFloat.",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
);
