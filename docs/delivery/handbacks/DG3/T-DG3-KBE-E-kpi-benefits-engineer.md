# Handback T-DG3-KBE-E: F-DG3-100, second pass (kpi-benefits-engineer)

- **Stage:** P3 / DG3, repair before review round 3.
- **Assignment:** `docs/delivery/assignments/DG3/round-3/T-DG3-KBE-E.md` (sha256 `b96b068a…2ccd16`, verified).
- **Invocation:** `DG3-T-DG3-KBE-E-kpi-benefits-engineer-20261008T094313Z-4d13281a`, session `4d13281a-5328-4eec-9e3d-374414a1f0ee`.
- **Working tree:** `/home/user/wt/dg3-kbe-e`, branch `dg3/kbe-e`. `HEAD` is `153f798`: the round-2 candidate `58ef3f47` (source `f49ca16`) plus the round-2 review records and the assignment.
- **Changes:** uncommitted, as the assignment asks.
- **Time:** started 2026-10-08T09:43:27Z, finished 2026-10-08T10:20:35Z (`date -u`); about 37 minutes.
- **Finding:** F-DG3-100 (Low, REQ-PB-056). I don't close it: only a non-author reviewer can.
- **Engineering only.** Nothing here grants or implies any G1–G6 business approval, or DG3.

## 1. Changed files

| File | Purpose |
|---|---|
| `vitest.config.ts` | Adds a fourth project, `unit-formula-nocodegen`: every `*.test.ts` under `packages/shared/src/formula/`, in forked Node processes started with `--disallow-code-generation-from-strings` and the preload below. Root `poolOptions.forks.execArgv` carries the flag only when that project is the one selected. The config refuses to combine it with another project. `unit-node` now excludes `*.nocodegen.test.ts`. |
| `package.json` (root) | **Outside my listed files; disclosed in §4.** One line: `test` becomes `vitest run --project unit-node --project unit-web && vitest run --project unit-formula-nocodegen`. Without this line the new project is not part of `pnpm test`. |
| `packages/shared/src/formula/codegen.nocodegen.test.ts` (new) | The canary. It runs only in the no-codegen project and asserts five things (see §2). |
| `packages/shared/src/formula/test-support/nocodegen-preload.mjs` (new) | A test helper, loaded with `--import` in the no-codegen forks only. It renames tinypool's single warm-up message from handler `default` to `run`, so tinypool does not reach its `new Function` fallback (§2). It enables no code generation. It is not built (no `allowJs`) and not imported by the engine. |
| `packages/shared/src/formula/fuzz.test.ts` | `scanSource()` gains:<ul><li>the import allowlist;</li><li>the host globals;</li><li>the word `constructor` outside a class constructor declaration;</li><li>prototype reflection;</li><li>string-assembled keys;</li><li>`import.meta`;</li><li>hex and Unicode escapes.</li></ul>The probe table gains O2 and N1–N12 plus allowlist cases (22 rows). The "does not flag" case gains the engine's real class-constructor, import and index-arithmetic shapes. The header names the run-time layer. |
| `eslint.config.js` | Formula blocks only. The shared rule lists move into constants. There are now two blocks:<ul><li>**all formula files:** the existing rules, plus `inspector` and `repl` in `no-restricted-imports`;</li><li>**engine sources only** (non-test files, excluding `test-support/`): an import allowlist (`regex` pattern) and `no-restricted-globals` for the host globals. `no-restricted-syntax` adds the constructor literal, template and identifier bans (class constructor names allowed), a host-global identifier ban, prototype reflection, string-assembled or function-expression computed keys, and `import.meta`.</li></ul> |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` | §6 "Extended guard" is rewritten. It now states what each of the three layers guarantees, the residual, and the production CSP (verified). No other paragraph changed. |
| `docs/architecture/p3-work-split.md` | §9: a new heading for the round-3 repair, with item 25. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-E-*` | This handback and its evidence. |

The engine sources (`evaluate.ts`, `index.ts`, `parse.ts`, `tokenize.ts`, `typecheck.ts`, `types.ts`) are **unchanged** (`git diff --quiet HEAD --` exits 0). `formula.test.ts` is unchanged. No new lint rule forced a change in the engine, because its class constructors are exempted by selector.

## 2. Behaviour delivered (REQ-PB-056, F-DG3-100)

### 1. Run-time guard, independent of spelling (the core)

- `pnpm test` runs the formula corpus a second time as `unit-formula-nocodegen`: `formula.test.ts` (136 tests), `fuzz.test.ts` (48) and the canary (6), 190 tests in all. They run in `forks` processes whose `execArgv` contains `--disallow-code-generation-from-strings`.
- The existing engine tests pass unchanged in both projects.
- **The canary**, `codegen.nocodegen.test.ts`, asserts five things in that process:
  - `process.execArgv` contains the flag;
  - `new Function("return 1")` throws `EvalError`;
  - `eval("1")` throws `EvalError`, both direct and indirect;
  - `new (Object.getPrototypeOf(async () => {}).constructor)("return 1")` throws `EvalError`;
  - the GeneratorFunction constructor reached by a key built with `join` throws `EvalError`.

  A sixth test shows that the engine still evaluates `a * b` to `42` there.
- **Negative controls** (`nocodegen-controls.log`):
  - Running the canary without `--project unit-formula-nocodegen` gives 5 failed and exit 1. The guard cannot disappear silently.
  - Selecting it together with `unit-node` is refused at startup with exit 1.

**Why a separate Vitest invocation, a root-level `execArgv` and a preload.** Each one was established by experiment, not assumed:

1. **Root `execArgv` only.** In vitest 3.2.4, `createForksPool` reads `vitest.config.poolOptions.forks.execArgv`, which is the root config, and ignores a project's `poolOptions`. My first per-project attempt made the canary fail 5/5 (`process.execArgv` = `['--conditions','node',…]`). A root value would also reach `unit-node` and `integration`. So the project needs its own invocation, and the root value is set only for that invocation.
2. **Not `threads`.** `new Worker(…, { execArgv: ['--disallow-code-generation-from-strings'] })` throws `ERR_WORKER_INVALID_EXEC_ARGV`.
3. **Not `vmForks`.** Under the flag, `vm.runInNewContext('eval("1")')` still returns `1`, because `node:vm` contexts re-enable code generation.
4. **Not a run-time V8 flag.** `v8.setFlagsFromString('--disallow-code-generation-from-strings')` after start-up has no effect: `eval` and `new Function` still work on Node 22 and 24.
5. **The preload.** With the flag on, every fork crashed before the first test, at tinypool 1.1.1 `getHandler`. The warm-up message uses handler name `"default"`, which vitest's `worker.js` does not export, so tinypool falls back to `new Function("specifier", "return import(specifier)")` and that throws `EvalError`. The preload rewrites only that warm-up name to `run`, so tinypool loads the worker through `import()`. The flag stays in force, as the canary proves.

The plain `node --test` fallback was not needed: Vitest's own runtime runs under the flag once tinypool's warm-up is handled.

### 2. Module loading: an allowlist

- For the engine sources, `no-restricted-imports` uses `patterns: [{ regex }]` and refuses every specifier except these:
  - `./<name>.ts`;
  - `../value.ts`;
  - `decimal.js`.
- It applies to `import`, `import type`, `export * from` and `export {…} from`.
- **Workspace imports.** The engine uses no `@mth/*` import. Its only import from outside the formula directory is the relative `../value.ts` (`checkDecimal`, `MEASURE_COLUMN`, `formatDecimal`, `DisplayLocale`). Every `node:*` built-in, npm package and other relative path is refused; I checked `node:fs`, `@mth/shared`, `../../db/index.ts`, `import type … from "node:vm"` and `export * from "node:vm"`.
- **Globals.** `process`, `global`, `globalThis`, `self` and `window` are refused, and so are `frames`, `parent`, `top`, `opener` and `document` (the browser aliases of the global object, and script injection). They are refused through `no-restricted-globals` and also as any `Identifier`, because the reviewer's snippets shadow them with `declare const global`, which `no-restricted-globals` does not see. The engine uses none of them, so I refuse the whole names, not dangerous members.
- **Tests.** Test files keep a separate block with the existing justified disables. They keep `node:fs` and `node:url`, and `test-support/` is excluded too.

### 3. Constructor keys (defence in depth)

These are refused in the engine sources:
- `Literal[value='constructor']`;
- `TemplateElement[value.cooked='constructor']`;
- `Identifier[name='constructor']:not(MethodDefinition[kind='constructor'] > Identifier.key)`. The three engine class constructors stay legal.
- the existing `.constructor` rules.

I also added these, because the engine uses none of them:
- prototype reflection identifiers (`getPrototypeOf`, `getOwnPropertyDescriptor(s)`, `setPrototypeOf`, `defineProperty(ies)`, `__proto__`, `__lookup*__`, `__define*__`);
- a computed key built from a string literal with `+`, or a template with substitutions (`tokens[pos + 1]` stays legal);
- a computed member read directly off a function expression, including through up to three TS type assertions;
- `import.meta`.

### 4. The scan

`scanSource()` mirrors items 2 and 3, and also refuses hex and Unicode escapes, which the engine does not use. That covers `"\x63onstructor"`. Class constructor declarations are masked first. The probe table has 22 new rows, covering O2, N1–N12, `node:fs`, `@mth/shared`, a deep relative path, a side-effect import, a multi-line `zod` import, an escape and `window.eval`. The shipped engine scans clean.

### 5. The record

- ADR-0024 §6 "Extended guard" now separates the three layers:
  - ESLint: best effort, plus the allowlist;
  - the scan: a mirror of ESLint;
  - run time: an exercised path that generates code from a string fails.
- It also states the residual: an unexercised path is caught only by the static layers, for example `f[k]` with `f` an ordinary function variable and `k` assembled from non-literal parts.
- **The CSP claim was verified before I wrote it.** The text says the CSP holds only where the API serves the web bundle (`@fastify/static`, `server.ts:302`).
  - The emitted header from the freshly built `apps/api/dist/server.js` (`captureSecurityHeaders()`) is `script-src 'self'`.
  - It contains no `'unsafe-eval'` and no `'wasm-unsafe-eval'`.
  - `useDefaults: false` is set.
  - Evidence: `csp-header.log`.
- The text also says that on the server the API and worker processes run without the flag.

## 3. Checks actually run

All logs are under `docs/delivery/handbacks/DG3/T-DG3-KBE-E-evidence/`. Unless stated otherwise, each check ran in the worktree (`HEAD 153f798` plus these uncommitted changes) on Node 24.21.0, offline.

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG2`, before implementation | `PASS gate DG2 (historical)`, exit 0 | console, 09:43Z |
| 1 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 2 | `pnpm -r build` | exit 0 | `build.log` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" | `format-check.log` |
| 5 | `npx eslint packages/shared/src/formula/ --max-warnings=0` | exit 0 | `eslint-formula.log` |
| 6 | `pnpm test`, Node 24.21.0, `LANG`/`LC_ALL` unset | exit 0. First invocation: 81 files, **1587** passed. Second (`unit-formula-nocodegen`): 3 files, **190** passed | `test-node24-locale-unset.log` |
| 7 | `pnpm test`, Node 24.21.0, `C.UTF-8` | exit 0; 1587 + 190 passed | `test-node24-c-utf8.log` |
| 8 | `pnpm test`, Node 22.22.2, locale unset | **exit 1.** 1 failed, 1586 passed (see the disclosure below). The `&&` meant the no-codegen invocation did not run | `test-node22-locale-unset.log` |
| 8r | Same, rerun | exit 0; 1587 + 190 passed | `test-node22-locale-unset-rerun.log` |
| 8i | `vitest run --project unit-web apps/web/src/auth/session-identity.test.tsx`, 3 times, Node 22, locale unset | 18/18 passed, exit 0, 3 out of 3 runs | `session-identity-node22-x3.log` |
| 9 | `pnpm test`, Node 22.22.2, `C.UTF-8` | exit 0; 1587 + 190 passed | `test-node22-c-utf8.log` |
| 10 | Canary negative and positive controls (§2.1) | Without the project: 5 failed, exit 1 (expected). Mixed selection: startup error, exit 1 (expected). The project alone: 190 passed, exit 0 | `nocodegen-controls.log` |
| 11 | The reviewer's `guard-bypass-probe.mjs`, a byte-identical copy (sha256 `934c62b1…04d04f0`), run as `node $TMPDIR/probes/guard-bypass-probe.mjs $TMPDIR/review-p2` | exit 0. All 18 forms, O1–O6 and N1–N12, are BLOCKED BY BOTH (eslint=1, scan=1). `evaluate.ts` was restored | `guard-bypass-probe.log` |
| 12 | My run-time harness (`runtime-layer-probe.mjs`) in the same clone, Node 24.21.0 and Node 22.22.2 | exit 0 on both; results in §5 | `runtime-layer-probe-node24.log`, `runtime-layer-probe-node22.log` |
| 13 | The emitted CSP header from the built API | `script-src 'self'`, no `unsafe-eval`, exit 0 | `csp-header.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG2`, after implementation | exit 0 | `validate-historical-DG2.log` |

**Disclosure for check 8 (a non-zero exit).**
- **What failed:** one `unit-web` test, `apps/web/src/auth/session-identity.test.tsx` › "F-DG2-500 sign-out here and 403 (ar) › signing out here clears everything; B signing in afterwards never sees A's records". It was a `findByText('لا توجد تحوّلات بعد')` timeout, and the file took 13.1 s against 6.0–7.8 s in the passing runs.
- **Why I don't think my change caused it:** it is in `apps/web` (T-DG3-FE-G's area), which I did not touch. In the normal invocation my config sets root `forks.execArgv` to `[]`, which is the default.
- **How it behaves since:** it passed in the other three full runs, in the full rerun (8r) and in 3 isolated runs (8i).
- **My reading:** the T-DG3-FE-G agent ran concurrently on the same machine, so it is most likely a load-dependent timing flake. I have not proven the cause, and I report it as a flaky test, not as a pass.

**Test counts.**
- **First invocation:** 1587 = the round-2 baseline of 1565, plus the 22 new scan probe rows in `fuzz.test.ts` (26 → 48 tests).
- **No-codegen project:** 190 = 136 (`formula.test.ts`) + 48 (`fuzz.test.ts`) + 6 (the canary).
- **Total per `pnpm test`:** 1777.

**Disposable clone used for checks 11–12.**
- **Location:** `$TMPDIR/review-p2`, never this tree.
- **How it was made:** `git clone` of the worktree, then a `tar` copy of the tree, including `node_modules` and the uncommitted changes, then a local commit `0968bbf`, so the probes' `git status` restore check is meaningful.
- **`tar` exit status:** non-zero, because 13 untracked entries at the worktree root could not be created in the copy ("Cannot mknod": `.bashrc`, `.vscode`, `CLAUDE.local.md`, …). These are character devices (`crw-rw-rw- 1,3`), the sandbox's masks of `/dev/null`, not project files. Every real file was copied.
- **Reviewer files:** I only read them and copied the probe. I did not edit anything under `docs/delivery/test-evidence/DG3/code-security/`.

## 4. Known gaps, deviations and notes

1. **Scope deviation: the root `package.json`.** The assignment wants the project to be "part of `pnpm test`", but `pnpm test` names its projects explicitly, and Vitest 3.2 forces a separate invocation (§2.1). I changed only the `test` script line. Please integrate it or reassign it.
2. **Behaviour change for contributors.** A plain `vitest run <path under formula/>` without `--project` also runs the no-codegen project without the flag, and the canary fails. That is intended (fail loud). Use `pnpm test`, or name the project.
3. **The preload depends on tinypool 1.1.1's message shape.** If an upgrade changes it, the forks crash or the canary fails. The guard fails loudly, never silently. A Vitest upgrade that honours project-level `execArgv` would allow the preload and the separate invocation to be dropped.
4. **The residual is stated plainly in ADR-0024 §6.** The run-time layer only sees exercised paths, and the static layers are best effort. No coverage figure is claimed. On the server (API and worker processes) no flag is set.
5. **N8 (`self`) and N12 (`import.meta.resolve`)** throw in Node with or without the flag, for reasons that have nothing to do with security (`ReferenceError`; Vite SSR has no `import.meta.resolve`). So they are not run-time refusals; the static layer refuses both.
6. **The reviewer's guard-bypass probe ran on Node 24 only.** The static layers (ESLint and the scan) do not depend on the Node version. The run-time harness ran on both Node 22 and Node 24.
7. **The untracked character-device dotfiles at the worktree root** were present before I started. They are not mine; I left them alone.

## 5. Per-form table: which layer refuses each form

- **Lint and scan:** the reviewer's `guard-bypass-probe.mjs`, run unchanged (`guard-bypass-probe.log`).
- **Run time:** my harness calls each snippet's export in `unit-formula-nocodegen`, with `unit-node` as the control (`runtime-layer-probe-node{24,22}.log`). The results are identical on Node 24 and Node 22.

"Run-time ✔" means the call threw `EvalError` under the flag and the test failed (exit 1), while the control ran the code.

| Form | What | Lint | Scan | Run-time (`EvalError`) | Control without flag | Refused by |
|---|---|---|---|---|---|---|
| O1 | `Reflect.construct(Function, …)` | ✔ | ✔ | ✔ | returned a function | all three |
| O2 | `globalThis['ev'+'al']` | ✔ (new) | ✔ | ✔ | returned 1 | all three |
| O3 | `createRequire(import.meta.url)('vm')` | ✔ | ✔ | ✘ (loads `vm`, no codegen) | returned the vm module | lint + scan |
| O4 | `Reflect.apply(Function, …)` | ✔ | ✔ | ✔ | returned a function | all three |
| O5 | `['constructor']` on a generator prototype | ✔ | ✔ | ✔ | returned a function | all three |
| O6 | alias `F = Function` | ✔ | ✔ | ✔ | returned a function | all three |
| N1 | `f[k]`, `k = 'constructor'` | ✔ | ✔ | ✔ | 42 | all three |
| N2 | `f['con' + 'structor']` | ✔ | ✔ | ✔ | 42 | all three |
| N3 | `getOwnPropertyDescriptor(…, 'constructor').value` | ✔ | ✔ | ✔ | 42 | all three |
| N4 | `const { [k]: C } = generator prototype` | ✔ | ✔ | ✔ | 42 | all three |
| N5 | AsyncFunction via prototype, key built with `join` | ✔ | ✔ | ✔ | 42 | all three |
| N6 | tagged template `f[k]\`…\`` | ✔ | ✔ | ✔ | 42 | all three |
| N7 | `global['ev'+'al']` | ✔ | ✔ | ✔ | 42 | all three |
| N8 | `self['ev'+'al']` (browser only) | ✔ | ✔ | n/a: `ReferenceError` in Node, with or without the flag | `ReferenceError` | lint + scan (static `self` ban). In the browser, the CSP also refuses `eval` |
| N9 | `process.getBuiltinModule('node:vm').runInThisContext` | ✔ | ✔ | ✘ (42: `vm` is outside the flag) | 42 | lint + scan (`process` ban) |
| N10 | static `import … from "node:inspector"` | ✔ | ✔ | ✘ (inspector is outside the flag) | ran | lint + scan (import allowlist) |
| N11 | static `import * from "node:repl"` | ✔ | ✔ | ✘ (no codegen in the snippet) | returned a function | lint + scan (import allowlist) |
| N12 | `import.meta.resolve` (the reviewer: not a vector) | ✔ | ✔ | n/a: `TypeError` under Vite SSR, with or without the flag | `TypeError` | lint + scan (`import.meta` ban) |

**Every form is refused by at least one layer, and no form is refused by none.** Every form that is code generation from a string (O1, O2, O4–O6, N1–N7) is refused by all three layers. The forms that load a module or reach `vm` or `inspector` (O3, N9, N10, N11) are outside the run-time flag by design, and the static allowlist and the `process` ban refuse them.

## 6. Merge instructions

- **No migrations.** No production code changed, and the engine sources are byte-identical.
- **Files to integrate:** the six modified files, plus the two new files under `packages/shared/src/formula/`, plus this handback and its evidence directory.
- **Order:** none required. `package.json` and `vitest.config.ts` belong together: the project is wired only by the `test` script.
- **Expected conflicts:** none with T-DG3-FE-G (`apps/web/**`). If another task edits the root `package.json` `test` script or `vitest.config.ts`'s `unit-node` block, keep both changes.
- **After merge:** run `pnpm test` and check that it prints two Vitest summaries, the second being `unit-formula-nocodegen`, 3 files and 190 tests.
