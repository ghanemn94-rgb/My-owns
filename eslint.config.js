// ESLint flat config (ADR-0001, ADR-0009). Type-aware rules are deliberately not enabled at the root to keep
// `pnpm lint` fast and independent of a prior build; packages may add stricter local configs later.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------------------------------------------------
// ADR-0024 §6 "No dynamic code" (T09 formula engine). Static layer, shared by the two formula blocks below. It is a
// best-effort denylist for the common spellings plus, for the engine sources, an import allowlist. It cannot be complete
// (a key can be assembled at run time); the spelling-independent layer is the `unit-formula-nocodegen` Vitest project,
// which runs every formula test under node --disallow-code-generation-from-strings (vitest.config.ts; F-DG3-100).
// ---------------------------------------------------------------------------------------------------------------------
const FORMULA_MSG = "(ADR-0024 §6)";

/** Globals refused in every formula file (engine sources and tests). */
const FORMULA_GLOBALS = [
  { name: "Function", message: `No Function constructor in the formula engine ${FORMULA_MSG}.` },
  { name: "eval", message: `No eval in the formula engine ${FORMULA_MSG}.` },
  {
    name: "Reflect",
    message: `No Reflect in the formula engine: Reflect.construct/apply reach Function ${FORMULA_MSG}.`,
  },
];

/**
 * F-DG3-100 (round 3): the global object and the host process, refused in the engine sources only. Each one reaches
 * eval by a computed key (global["ev" + "al"], self[…]) or a module loader (process.getBuiltinModule). The engine uses
 * none of them. The browser aliases of the global object (self, window, frames, parent, top, opener) matter because the
 * engine is bundled into apps/web; document can inject a script element.
 */
const FORMULA_HOST_NAMES = [
  "process",
  "global",
  "globalThis",
  "self",
  "window",
  "frames",
  "parent",
  "top",
  "opener",
  "document",
];

/** no-restricted-syntax entries for every formula file (the parseFloat ban is repeated: this list replaces the generic one). */
const FORMULA_SYNTAX = [
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: "Use Decimal (decimal.js via @mth/shared) for money, rates and KPI values, never parseFloat.",
  },
  {
    selector: "ImportExpression",
    message: `No dynamic import() in the formula engine ${FORMULA_MSG}.`,
  },
  {
    selector: "WithStatement",
    message: `No with statement in the formula engine ${FORMULA_MSG}.`,
  },
  {
    // no-implied-eval only sees declared globals and the root config declares none, so timers (which accept a code
    // string) are banned outright: the engine is synchronous and needs none.
    selector:
      "CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate|execScript)$/], CallExpression[callee.property.name=/^(setTimeout|setInterval|setImmediate|execScript)$/]",
    message: `No timers in the formula engine: a timer can take a code string ${FORMULA_MSG}.`,
  },
  {
    // (() => {}).constructor("code") is the Function constructor without the name no-new-func looks for.
    selector: "CallExpression[callee.property.name='constructor'], NewExpression[callee.property.name='constructor']",
    message: `No .constructor(...) calls in the formula engine: that is the Function constructor ${FORMULA_MSG}.`,
  },
  // F-DG3-100: the forms below build and run code from a string without the names the rules above look for.
  {
    // Any use of the name Function as a value or property: an alias (const F = Function), globalThis.Function,
    // Reflect.construct(Function, …). Engine identifiers such as FormulaFunction are different names.
    selector: "Identifier[name='Function']",
    message: `No Function constructor in the formula engine, not even through an alias ${FORMULA_MSG}.`,
  },
  {
    selector:
      "MemberExpression[computed=true][property.value=/^(constructor|Function)$/], MemberExpression[computed=true][property.type='TemplateLiteral'][property.quasis.0.value.cooked=/^(constructor|Function)$/]",
    message: `No ["constructor"] or ["Function"] member in the formula engine: that is the Function constructor ${FORMULA_MSG}.`,
  },
  {
    // Reading .constructor at all (const C = gen.constructor; C("…")), and destructuring it.
    selector:
      "MemberExpression[property.name='constructor'], ObjectPattern > Property[key.name='constructor'], ObjectPattern > Property[key.value='constructor']",
    message: `No .constructor access in the formula engine: that reaches the Function constructor ${FORMULA_MSG}.`,
  },
  {
    selector:
      "CallExpression[callee.name=/^(require|createRequire)$/], CallExpression[callee.property.name=/^(require|createRequire)$/], Identifier[name='createRequire']",
    message: `No require/createRequire in the formula engine: static imports only ${FORMULA_MSG}.`,
  },
  {
    selector: "MemberExpression[object.name='Reflect']",
    message: `No Reflect in the formula engine: Reflect.construct/apply reach Function ${FORMULA_MSG}.`,
  },
];

/** no-restricted-syntax entries added for the engine sources only (F-DG3-100 round 3; defence in depth). */
const FORMULA_SOURCE_SYNTAX = [
  {
    // The word constructor anywhere except as the name of a class constructor: a string literal ("constructor";
    // "\x63onstructor" has the same cooked value), a template element, an identifier key or a variable. A key assembled
    // at run time from other strings is outside any static rule; the no-codegen test project covers it.
    selector:
      "Literal[value='constructor'], TemplateElement[value.cooked='constructor'], Identifier[name='constructor']:not(MethodDefinition[kind='constructor'] > Identifier.key)",
    message: `No 'constructor' literal, template or identifier in the formula engine: it names the Function constructor ${FORMULA_MSG}.`,
  },
  {
    // The global object and the host process, also when shadowed by a local declaration (declare const global: …),
    // which no-restricted-globals does not see.
    selector: `Identifier[name=/^(${FORMULA_HOST_NAMES.join("|")})$/]`,
    message: `No global object, process or document in the formula engine ${FORMULA_MSG}.`,
  },
  {
    // Prototype reflection reaches the constructor of a function prototype by any key; the engine needs none of it.
    selector:
      "Identifier[name=/^(getPrototypeOf|setPrototypeOf|getOwnPropertyDescriptors?|defineProperty|defineProperties|__proto__|__lookupGetter__|__lookupSetter__|__defineGetter__|__defineSetter__)$/]",
    message: `No prototype reflection in the formula engine ${FORMULA_MSG}.`,
  },
  {
    // A computed key assembled from a string ("con" + "structor", `${a}b`) or a computed member read directly off a
    // function expression ((() => 0)[k], also through up to three type assertions). Index arithmetic such as tokens[pos + 1] stays allowed.
    selector:
      "MemberExpression[computed=true] > BinaryExpression.property Literal[raw=/^[\"']/], MemberExpression[computed=true] > TemplateLiteral.property[expressions.length>0], MemberExpression[computed=true][object.type=/^(ArrowFunctionExpression|FunctionExpression|ClassExpression)$/], MemberExpression[computed=true][object.expression.type=/^(ArrowFunctionExpression|FunctionExpression|ClassExpression)$/], MemberExpression[computed=true][object.expression.expression.type=/^(ArrowFunctionExpression|FunctionExpression|ClassExpression)$/], MemberExpression[computed=true][object.expression.expression.expression.type=/^(ArrowFunctionExpression|FunctionExpression|ClassExpression)$/]",
    message: `No string-assembled computed key or computed member of a function expression in the formula engine ${FORMULA_MSG}.`,
  },
  {
    selector: "MetaProperty[meta.name='import']",
    message: `No import.meta in the formula engine ${FORMULA_MSG}.`,
  },
];

/**
 * F-DG3-100 (round 3): module loading in the engine sources is an ALLOWLIST. A source may import only a sibling module
 * (./x.ts), the shared value helpers (../value.ts) and decimal.js. Everything else is refused, including every node:*
 * built-in (vm, inspector, repl, module, worker_threads, child_process, …) and every workspace or npm package. The engine
 * uses no @mth/* workspace import.
 */
const FORMULA_IMPORT_ALLOWLIST = /^(?!(?:\.\/[A-Za-z0-9_-]+\.ts|\.\.\/value\.ts|decimal\.js)$)/.source;
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
    // ADR-0024 §6 "No dynamic code" (T-DG3-KBE-A, F-DG3-100): every file under packages/shared/src/formula, engine
    // sources and tests. no-restricted-syntax replaces the generic list for these files, so the parseFloat ban is
    // repeated in FORMULA_SYNTAX. The tests keep the access they need (fuzz.test.ts's globalThis.Function tripwire, the
    // no-codegen canary) through justified eslint-disable comments.
    files: ["packages/shared/src/formula/**/*.{ts,tsx,js,mjs}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-globals": ["error", ...FORMULA_GLOBALS],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "vm", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "node:vm", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            // F-DG3-100: createRequire/require load modules at run time (for example vm).
            { name: "module", message: `No module loader in the formula engine ${FORMULA_MSG}.` },
            { name: "node:module", message: `No module loader in the formula engine ${FORMULA_MSG}.` },
            // Each of these runs code from a string or a file (Worker eval, child processes, inspector, repl).
            { name: "worker_threads", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "node:worker_threads", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "child_process", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "node:child_process", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "inspector", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "node:inspector", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "repl", message: `The formula engine never runs code ${FORMULA_MSG}.` },
            { name: "node:repl", message: `The formula engine never runs code ${FORMULA_MSG}.` },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...FORMULA_SYNTAX],
    },
  },
  {
    // F-DG3-100 (round 3): the engine sources (non-test files) additionally get the import allowlist, the host-object
    // globals and the constructor-key, prototype-reflection and assembled-key rules. Tests and test-support/ (the
    // no-codegen fork preload, never built or imported by the engine) are excluded so they keep node:fs, node:url,
    // process and their tripwires.
    files: ["packages/shared/src/formula/**/*.{ts,tsx,js,mjs}"],
    ignores: ["packages/shared/src/formula/**/*.test.{ts,tsx,js,mjs}", "packages/shared/src/formula/test-support/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...FORMULA_GLOBALS,
        ...FORMULA_HOST_NAMES.map((name) => ({
          name,
          message: `No ${name} in the formula engine: it reaches eval or a module loader ${FORMULA_MSG}.`,
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: FORMULA_IMPORT_ALLOWLIST,
              message: `The formula engine imports only ./<sibling>.ts, ../value.ts and decimal.js ${FORMULA_MSG}.`,
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...FORMULA_SYNTAX, ...FORMULA_SOURCE_SYNTAX],
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
