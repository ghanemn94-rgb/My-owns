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
  {
    // F-DG2-530/580 (T-DG2-FE15): effects of a user action belong to the session generation it began under. App code
    // navigates and writes the query cache only through apps/web/src/auth/sessionBound.ts, which drops effects of a
    // previous generation (an identity change while the action awaited). The session transitions themselves (the
    // session-end redirect, signing out, signing in) carry a justified eslint-disable comment. Tests are exempt. By
    // convention the session-bound action is the variable `action` (const action = begin()).
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/**/*.test.{ts,tsx}", "apps/web/src/test/**", "apps/web/src/auth/sessionBound.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-router",
              importNames: ["useNavigate", "redirect"],
              message:
                "Navigate through useSessionBoundAction()/useSessionNavigate() (apps/web/src/auth/sessionBound.ts), so a navigation never outlives the session it began under.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "Use Decimal (decimal.js via @mth/shared) for money, rates and KPI values, never parseFloat.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(setQueryData|setQueriesData)$/]:not([callee.object.name='action'])",
          message:
            "Write the query cache through a session-bound action (action.setQueryData, apps/web/src/auth/sessionBound.ts), never directly.",
        },
        {
          selector: "CallExpression[callee.property.name='navigate']:not([callee.object.name='action'])",
          message:
            "Navigate through a session-bound action (action.navigate, apps/web/src/auth/sessionBound.ts), never with the raw router.",
        },
      ],
    },
  },
);
