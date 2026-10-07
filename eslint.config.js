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
    // ADR-0024 §6 "No dynamic code" (T-DG3-KBE-A): the T09 formula engine is a hand-written tokenizer, parser and AST
    // walker. Nothing under packages/shared/src/formula may evaluate text as code. no-restricted-syntax replaces the
    // generic list for these files, so the parseFloat ban is repeated here.
    files: ["packages/shared/src/formula/**/*.{ts,tsx,js,mjs}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "vm", message: "The formula engine never runs code (ADR-0024 §6)." },
            { name: "node:vm", message: "The formula engine never runs code (ADR-0024 §6)." },
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
          selector: "ImportExpression",
          message: "No dynamic import() in the formula engine (ADR-0024 §6).",
        },
        {
          selector: "WithStatement",
          message: "No with statement in the formula engine (ADR-0024 §6).",
        },
        {
          // no-implied-eval only sees declared globals and the root config declares none, so timers (which accept
          // a code string) are banned outright: the engine is synchronous and needs none.
          selector:
            "CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate|execScript)$/], CallExpression[callee.property.name=/^(setTimeout|setInterval|setImmediate|execScript)$/]",
          message: "No timers in the formula engine: a timer can take a code string (ADR-0024 §6).",
        },
        {
          // (() => {}).constructor("code") is the Function constructor without the name no-new-func looks for.
          selector:
            "CallExpression[callee.property.name='constructor'], NewExpression[callee.property.name='constructor']",
          message: "No .constructor(...) calls in the formula engine: that is the Function constructor (ADR-0024 §6).",
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
