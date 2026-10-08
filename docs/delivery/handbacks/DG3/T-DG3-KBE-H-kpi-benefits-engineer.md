# Handback T-DG3-KBE-H: F-DG3-100 fifth pass (kpi-benefits-engineer)

- **Stage / task:** P3 / DG3, repair before review round 6. Requirement REQ-PB-056; finding F-DG3-100 (Low, OPEN).
- **Assignment:** `docs/delivery/assignments/DG3/round-6/T-DG3-KBE-H.md` (sha256 `fc0e8cff…214907`, verified at start).
- **Invocation:** run `DG3-T-DG3-KBE-H-kpi-benefits-engineer-20261008T182621Z-473d0217`, session `473d0217-04e4-4c0f-bef5-7f9ddb1404ef`.
- **Working tree:** `/home/user/wt/dg3-kbe-h`, branch `dg3/kbe-h`. HEAD `26c0ea42d4fe` (round-5 candidate `dfedd62f` / source `21e2742` plus the round-5 review records), verified before writing. Changes are **uncommitted**, as instructed.
- **Time:** started `date -u` = 2026-10-08T18:26:33Z; checks finished 2026-10-08T18:57:28Z; handback finished 2026-10-08T18:59:20Z (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0, before any change (`T-DG3-KBE-H-evidence/validate-historical-DG2-start.log`) and again at the end (exit 0, `validate-historical-DG2-end.log`).
- **No approval is granted.** This is engineering work on DG3. It grants no product gate (G1–G6) and no business, Finance or IT approval. Only the originating reviewer or another qualified non-author can close F-DG3-100; I close nothing.

## 1. Changed files

| File | Purpose |
|---|---|
| `eslint.config.js` (formula blocks only) | Two new `no-restricted-syntax` entries in `FORMULA_SOURCE_SYNTAX`, the engine-source rules applied to every file of the import closure: (1) `:function[generator=true], YieldExpression`; (2) `then`/`catch`/`finally`/`fromAsync`/`asyncIterator` as an `Identifier`, `PrivateIdentifier`, `Literal` or `TemplateElement`. |
| `packages/shared/src/formula/fuzz.test.ts` (test only) | Scan mirror: new `FORBIDDEN` words (`generator`, `then`, `fromAsync/asyncIterator`); `blockAt` replaced by `bracePairs`, a string/template/regex-aware brace matcher that fails closed (fixes F1); `rethrowRuleHits` now also refuses `catch`/`finally` outside a try statement; probe table gains G1, G2, A1, A2 (built from the reviewer's probe text), F1 plus four relatives, and 26 further spellings; a new `unit-node` test lints the same forms with `ESLint.lintText`; the config assertion checks the new selectors; the clean-code list gains try/catch/finally and brace-in-string/regex shapes. |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6 | Absolute claims removed. The enumerated list L1–L7 replaces them, with the residual in the reviewer's wording. The "stricter" sentence is replaced with the exact difference. Four domain sentences with "never"/"ever" are made exact. |
| `docs/architecture/p3-work-split.md` §9 | Item 28 under "Amendments in the DG3 round-6 repair (T-DG3-KBE-H, 2026-10-08)". |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-H-kpi-benefits-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-H-evidence/**` | Logs, run scripts, copies of the reviewer's probes (byte-identical, sha256 in `probes-summary.txt`) and `changes.diff`. |

**No engine source changed.** `git diff --stat -- packages/shared/src/formula/*.ts packages/shared/src/value.ts ':!*.test.ts'` is empty. Every engine source already satisfies the new rules, and `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` exits 0. Formula results are unchanged, because no engine code changed.

## 2. Behaviour delivered (REQ-PB-056, F-DG3-100)

### (a) Static refusal of G1, G2 and A1, in lint and mirrored in the scan

Both layers apply to every file of the engine's import closure (the six `formula/` sources and `value.ts`). Lint does this through `FORMULA_SOURCE_SYNTAX`, which the closure test asserts is on every closure file. The scan does it through `scannedFiles()`, which the closure test asserts covers the closure.

| Assignment item | Lint (`eslint.config.js`) | Scan (`fuzz.test.ts`) |
|---|---|---|
| generator functions | `:function[generator=true]` (declaration, expression, method) | `generator`: `function\s*\*`, a `*` before a name or `[` after `{ } , ;`, `static` or `async` |
| `YieldExpression` | `YieldExpression` | `generator`: `\byield\b` |
| `then`/`catch`/`finally` as property key, member, computed literal key, destructured name | `Identifier[name=/^(then\|catch\|finally\|…)$/]`, `PrivateIdentifier[…]`, `Literal[value=…]`, `TemplateElement[value.cooked=…]` (the statement keywords are not identifiers) | `then`: `\bthen\b` anywhere; `catch outside a try statement` / `finally outside a try statement` (each `catch`/`finally` word must be a clause of a try statement, located with `bracePairs`); plus the round-5 `.then/.catch/.finally` regex |
| `fromAsync` | same selector (`fromAsync`) | `fromAsync/asyncIterator` |
| async iteration | `ForOfStatement[await=true]` (round 5) and `asyncIterator` in the new selector | `await` (round 5), `fromAsync/asyncIterator` |

**The engine uses none of these.** Lint and the scan pass on all seven files. `grep` finds `then` only in one comment (`index.ts:109`), no `finally`, and no `yield`, `function*`, `fromAsync` or `asyncIterator`. decimal.js 10.6.0 (`decimal.js`, `decimal.mjs`) has none of the refused words outside comments (all 12 matching lines are comments).

**Probe table.** G1, G2, A1 and A2 are in `ROUND5_HANDLER_FORMS`, built with the same `probeGen`/`PROBE_KEY`/`PROBE_R`/`PROBE_T` text as the reviewer's `rethrow-rule-attack-probe*.mjs`. They feed both the scan's `it.each(PROBES)` and the new ESLint test.

**Mutation check of the new tests (run in the tree, files restored byte-for-byte from `$TMPDIR` copies):**
- replacing the two new lint selectors with `DebuggerStatement` makes 2 tests fail (the configuration assertion and the new ESLint test);
- disabling the quote/template/regex handling in `bracePairs` (the round-5 `blockAt` behaviour) makes 7 tests fail (F1 and its four relatives, the unbalanced-quote probe, and the clean-code test).

### (b) ADR-0024 §6 without absolute claims

The three sentences named by the reviewer are gone:
- "It cannot handle its own refusal": replaced by the residual bullet "Self-handling forms outside the list".
- "So the exception reaches the test on the exercising test's call stack": replaced by "What it refuses", a conditional statement that points at the list.
- "This closes a promise reaction…": replaced by "What the list is for", which says only what each listed form can do.

Every other sentence of §6 was re-read; see §5 below for the sentence-by-sentence basis. Other absolute wording removed or narrowed:
- "enforces it": now "refuses these spellings";
- "each one guarantees only what is stated here";
- "it cannot be" (completeness);
- "**Guarantee.** Any engine path … fails the engine's tests … Two rules make this true, whatever the exercising test asserts";
- "however the constructor was reached and however its key was spelled": now the V8 flag semantics plus what the canary checks;
- "An `EvalError` cannot occur in production" and "In practice. This is unreachable": now "No layer finds a code generation in the engine today";
- "so the guard cannot disappear silently";
- "The closure test ensures that no file of the closure is outside them": now "every file the closure parser follows";
- "Wherever it sits in the closure, an exercised one fails every test that reaches it";
- "It also stays refused at run time: every … check … that reaches it fails": now the reviewer's observed W5 result;
- in the domain part: "Percentages are never stored as 12 for 12%", "no JavaScript number ever holds a value", "never exhausts the stack", "minutes + hours never sum silently".

### The "stricter" sentence (F1)

Both options were taken:
- **The matcher is fixed.** `bracePairs` skips string literals, template literals (outside `${…}`) and regular-expression literals. It reports `unbalanced braces, quotes or templates` when a source does not balance (fail closed).
- **The sentence is replaced.** The claim "stricter than `no-unsafe-finally`" is gone. §6 now says exactly: "Unlike `no-unsafe-finally`, this also counts one inside a nested function or loop in the block". It also says that the regex-literal detection is a heuristic and that ESLint remains the reference.

## 3. Proof: the reviewer's probes, copies, run in a disposable clone

**Set-up.** The clone is `$TMPDIR/review-p3`, made with `git clone` of this worktree at `26c0ea4`. The four changed files were copied in and committed in the clone only, as `75ffac8`, so the probes' `git status` check is meaningful. Dependencies were copied from the worktree's installed `node_modules`, because `pnpm install --offline` failed (see §4). The run used Node 22.22.2, as the reviewer's did.

**Probe files.** Copies of the reviewer's files were run unmodified. Their sha256 values match the reviewer's (`probes-summary.txt`): `rethrow-rule-attack-probe.mjs` `3816cd23…`, `rethrow-rule-attack-probe-2.mjs` `76c25713…`, `swallow-probe.mjs` `d9989e67…`, `guard-layers-probe.mjs` `7887455b…`, `guard-bypass-probe.mjs` `934c62b1…`. As in the reviewer's own runner, `guard-bypass-probe.mjs` runs through the symlink `$TMPDIR/review-p2 → review-p3`, because it insists on `review-p2` in its root path. The runner script is `T-DG3-KBE-H-evidence/run-probes.sh`.

All five runs exit 0, every probe restores its files, and the clone's `git status --porcelain` is `''` at the end. The **Round 5** column is the reviewer's result from `docs/delivery/test-evidence/DG3/code-security/round-5/*.log`. The **Now** column is this run.

| Probe (log) | Form | Round 5 (reviewer) | **Now** |
|---|---|---|---|
| `rethrow-rule-attack-probe.log` | **G1** generator `finally { yield 0; }` | PASSES ALL THREE LAYERS | **lint + scan** |
| | **G2** G1 + `it.return(0)` | PASSES ALL THREE LAYERS | **lint + scan** |
| | G3 (control) for-of over a generator | run-time | lint + scan + run-time |
| | E1 EventTarget listener | run-time | run-time |
| | E2 AbortSignal.onabort | run-time | run-time |
| | H1 hasInstance hijack, literal key | scan + run-time | scan + run-time |
| | H2 hasInstance hijack, run-time key | run-time | run-time |
| | S1 catch shape + later `var e` | lint + run-time | lint + run-time |
| | S2 (control, allowed by design) | run-time | run-time |
| `rethrow-rule-attack-probe-2.log` | **A1** `Array.fromAsync` + destructured `then` | PASSES ALL THREE LAYERS | **lint + scan** |
| | A2 (control) A1 without handler | run-time | lint + scan + run-time |
| | **F1** `finally { const s = "}"; return; }` | lint | **lint + scan** |
| | F2 `catch (e: unknown)` | scan + run-time | scan + run-time |
| | H3 hijack (exact name), literal key | scan + run-time | scan + run-time |
| | H4 hijack (exact name), run-time key | run-time | run-time |
| `swallow-probe.log` | W1 `catch { }` | lint + scan | lint + scan |
| | W2 `finally { return; }` | lint + scan | lint + scan |
| | W3 | lint + scan + run-time | lint + scan + run-time |
| | W4 `Promise…then(…).catch(…)` | lint + scan | lint + scan |
| | W5 wrapping catch | lint + scan + run-time | lint + scan + run-time |
| | W6 | lint + scan + run-time | lint + scan + run-time |
| `guard-layers-probe.log` | V1 `node:vm` in `value.ts` | lint + scan | lint + scan |
| | V2 `new Function` in `value.ts` | lint + scan + run-time | lint + scan + run-time |
| | S1, S2, S3 (round-3 assembled-key code generation, Q class) | run-time | run-time |
| `guard-bypass-probe.log` | O1–O6, N1–N12 (18 forms) | eslint=1 scan=1 (all) | eslint=1 scan=1 (all, "BLOCKED BY BOTH") |

**Result.** As expected, G1, G2 and A1 are refused by lint and the scan. F1 is now refused by the scan too. Every earlier form stays refused by at least the layers that refused it in round 5. No form lost a layer.

**Reading the columns.** In the probes, a form refused by the scan also makes the no-codegen run exit 1 (`run=1`), because `fuzz.test.ts` runs in that project as well. The probe counts a form as refused at run time only when a test fails under the flag and passes in the control. So G1, G2, A1 and F1 show `run=1 ctrl=1 run-only-fails=0`: they are refused statically, not at run time.

## 4. Checks actually run

All on Node 24.21.0 in the working tree unless stated. Logs are in `docs/delivery/handbacks/DG3/T-DG3-KBE-H-evidence/`.

| # | Command | Environment | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG2` (start) | Node 24 | `PASS gate DG2 (historical)`, **exit 0** | `validate-historical-DG2-start.log` |
| 2 | `pnpm -r typecheck` | Node 24 | **exit 0** | `typecheck.log` |
| 3 | `pnpm -r build` | Node 24 | **exit 0** | `build.log` |
| 4 | `pnpm lint` | Node 24 | **exit 0** | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | Node 24 | "All matched files use Prettier code style!" (xargs ran 2 batches; both pass), **exit 0** | `format-check.log` |
| 6 | `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` | Node 24 | no problems, **exit 0** | `eslint-formula.log` |
| 7 | `pnpm test` (both invocations) | Node 24.21.0, LANG/LC_* unset | `Tests 1651 passed (1651)`; `Tests 256 passed \| 2 skipped (258)`; **exit 0** | `unit-node24-unset.log` |
| 8 | `pnpm test` | Node 24.21.0, `LANG=LC_ALL=C.UTF-8` | 1651 passed; 256 passed, 2 skipped; **exit 0** | `unit-node24-C.UTF-8.log` |
| 9 | `pnpm test` | Node 22.22.2, LANG/LC_* unset | 1651 passed; 256 passed, 2 skipped; **exit 0** | `unit-node22-unset.log` |
| 10 | `pnpm test` | Node 22.22.2, `LANG=LC_ALL=C.UTF-8` | 1651 passed; 256 passed, 2 skipped; **exit 0** | `unit-node22-C.UTF-8.log` |
| 11 | `QA_PG_PORT=23100 MTH_PORT_POOL=23101-23149 tests/qa/support/with-pg.sh pnpm test:integration` | Node 24; PostgreSQL on 23100 (attempt 1) | `Test Files 56 passed (56)`, `Tests 793 passed (793)`, **exit 0** | `integration.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG2` (end) | Node 24 | `PASS gate DG2 (historical)`, **exit 0** | `validate-historical-DG2-end.log` |
| 13 | The five reviewer probes (copies) in the disposable clone | Node 22.22.2 | all **exit 0**; table in §3 | `run-probes.sh`, `probes-summary.txt`, `*-probe*.log` |
| 14 | `bash word-greps.sh` (decimal.js and engine-source word greps) | Node 24 | **exit 0** | `word-greps.log` |

The matrix (rows 7–10) ran through `run-unit-matrix.sh`; its summary is in `unit-matrix-summary.txt`. Each log has 81 + 3 test files passed, and none contains `FAIL`, `Unhandled`, `Errors` or a retry.

**Test counts against the round-5 baseline (1614 + 220 passed, 1 skipped).** The changes are +37 in `unit-node` and +36 passed, +1 skipped in `unit-formula-nocodegen`, all in `fuzz.test.ts`:
- **36 new probe rows** in both projects: 5 `ROUND5_HANDLER_FORMS` rows (A1 appears twice, once per scan hit), 5 `F1_FORMS` rows and 26 further spellings.
- **1 new ESLint test.** It runs in `unit-node` and is skipped under `--disallow-code-generation-from-strings`, like the round-5 ESLint configuration test. The 2 skips are those two ESLint tests.

No other test changed. The integration count is unchanged at 793.

**Non-zero exits and disclosures (none of them hides a failing check):**
- **The first clone commit failed** (`fatal: cannot exec '/tmp/code-sign'`): the global git config signs commits. I re-ran it with `-c commit.gpgsign=false`, in the disposable clone only.
- **`pnpm install --frozen-lockfile --offline` in the clone failed** with `EROFS … symlink … /root/.local/share/pnpm/store/v10/projects/…`, because the pnpm store is read-only in this sandbox. pnpm printed a stack trace, though my wrapper echoed exit 0 (`tail` was last in the pipe). Instead, I copied the worktree's installed `node_modules` (root and the six workspace packages) and `packages/shared/dist` into the clone, so its dependencies are the worktree's lockfile install. The reviewer's clone was installed offline with `--frozen-lockfile` from the same lockfile.
- **A safety check refused one `rm -rf "$C/$d"` command** before it ran. I re-ran it as `rm -rf "${C:?}"/"${d:?}"`, which targets only `$TMPDIR/review-p3`.
- **The first attempt at `word-greps.log` was garbled.** A `cd` inside a `{ … }` group persisted, and the follow-up `tail` failed with "No such file". I discarded that content and regenerated the log with the standalone `word-greps.sh` (exit 0). Its content matches the earlier interactive grep: 12 comment-only lines per decimal.js file.
- **Two mutation runs failed by design** (see §2): 2 failures and 7 failures. Both files were restored from `$TMPDIR` copies, and the post-restore run passed 108/108 in `fuzz.test.ts`.
- **A manual lint of `import x = require("node:vm")`** (to check a §6 sentence) exited 1 as intended: `no-restricted-imports` and `@typescript-eslint/no-require-imports`. It used a temporary `packages/shared/src/formula/__ie_probe.ts`, deleted at once. A temporary `.lt-probe.mjs` at the repository root, used once to try the selectors, was deleted too. Neither is in the final tree.
- **Empty `.claude/.cc-writes` directories** in source folders were removed before the tests, as instructed. One was found: `packages/shared/src/.claude/.cc-writes`.

## 5. The final §6 text and what makes each sentence true

The guard part of §6 (ADR lines 89–181) is quoted in full below. In the rest of §6 (package, grammar, types, evaluation, versioning, examples, items 4–13, import path), only four sentences changed; they are listed after the map.

> **No dynamic code.** The engine is a hand-written tokenizer, recursive-descent parser and AST walker. `eval`, `new Function`, `Function(...)`, `vm`/`node:vm`, `setTimeout(string)`, dynamic `import()` and `with` are forbidden in `packages/shared/src/formula/**`. An ESLint override refuses these spellings: `no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-imports: vm, node:vm`, and `no-restricted-syntax` for `ImportExpression`, `WithStatement`, timer calls (`setTimeout`/`setInterval`/`setImmediate`/`execScript` as plain or member calls) and `.constructor(...)` calls. The timer selectors are needed because core `no-implied-eval` only recognises declared globals (T-DG3-KBE-A lint probe). A source scan in `fuzz.test.ts` mirrors the rule.
>
> **Extended guard (F-DG3-100; T-DG3-KBE-D, rewritten by T-DG3-KBE-E, corrected by T-DG3-KBE-F, T-DG3-KBE-G and T-DG3-KBE-H).** There are three layers. Each one refuses only what is listed for it here; none of them proves that the engine generates no code.
>
> **Scope: the engine's import closure.** The guarded code is the engine's transitive static import closure from `formula/index.ts`: the six sources in `packages/shared/src/formula/` (`evaluate.ts`, `index.ts`, `parse.ts`, `tokenize.ts`, `typecheck.ts`, `types.ts`) and `packages/shared/src/value.ts`, plus the package `decimal.js`. Below, "the engine sources" means all seven files. `value.ts` is the closure's only file outside `formula/` (`FORMULA_CLOSURE_OUTSIDE` in `eslint.config.js`).
> - **Pinned by a test.** `fuzz.test.ts` computes the closure from `formula/index.ts` and asserts four things (listed below).
>   - **What the closure parser follows.** It is a regular expression (`IMPORT_SPECIFIER`) over the comment-free text, not a JavaScript parser. It follows the quoted specifier of `import … from "…"`, `import type … from "…"`, a side-effect `import "…"`, `export { … } from "…"`, `export type { … } from "…"`, `export * from "…"` and `export * as n from "…"`, with braces over several lines. Since round 5 it also follows string-named specifiers, `export { "x" as y } from "…"`, `import { "x" as y } from "…"` and `export * as "n" from "…"` (the reviewer's X1).
>   - **What it does not follow.** It does not follow `import()`, `require(…)`, `createRequire`, `import x = require("…")` or `import.meta`. Layers 1–2 refuse these spellings in every engine source. For a static declaration the regular expression misses, the backstop is ESLint: it parses the module, and its import allowlist (layer 1) applies to every `import`/`export … from` declaration in the parsed module.
>   - **The four assertions:**
>     - every relative specifier resolves to a file;
>     - `decimal.js` is the only package;
>     - every file of the closure is in the source scan's file set (layer 2);
>     - ESLint's computed configuration for every file of the closure carries the engine-source rules of layer 1 (`ESLint.calculateConfigForFile`). These include `no-eval`, `no-implied-eval`, `no-new-func`, `no-unsafe-finally`, the host globals, an import allowlist that refuses `node:vm`, `node:module`, `node:inspector`, `node:fs`, `zod` and `@mth/shared`, and the engine-source syntax selectors, including the handler and asynchrony selectors listed below.
> - **What this means.** A file that the engine starts to import through a declaration the closure parser follows, directly or through another file, fails this test until it is added to both static layers.
> - **One exception to the both-projects rule.** The ESLint tests run in `unit-node` only. ESLint validates rule options with ajv, which compiles schemas with `new Function`, so ESLint does not run under `--disallow-code-generation-from-strings`. Lint coverage is a property of the configuration, not of the process. The other three closure assertions run in both projects.
> - **decimal.js.** It is a pinned third-party package (10.6.0) and is outside layers 1–2. Its 10.6.0 sources (`decimal.js` and `decimal.mjs`) contain no `eval(` or `Function(` call. Outside comments, they also contain none of the words `try`, `catch`, `finally`, `Promise`, `async`, `await`, `then`, `yield`, `fromAsync` or `asyncIterator`, and no `function*` (checked with `grep` for T-DG3-KBE-H). Layer 3 covers whatever part of it the tests exercise.
>
> 1. **Static layer: ESLint (`eslint.config.js`, the formula blocks).**
>    - For every file under `packages/shared/src/formula/**`, and for `packages/shared/src/value.ts`:
>      - `no-eval`, `no-implied-eval` and `no-new-func`;
>      - `no-restricted-globals` for `Function`, `eval` and `Reflect`;
>      - `no-restricted-syntax` for any `Function` identifier, computed `["constructor"]`/`["Function"]` members, any `.constructor` read or destructuring, `require`/`createRequire`, `Reflect.*`, `import()`, `with`, and timer calls;
>      - `no-restricted-imports` for `vm`, `module`, `worker_threads`, `child_process`, `inspector` and `repl`, with and without `node:`.
>    - For the engine sources only (the non-test files of `formula/`, excluding `test-support/`, and `value.ts`), these rules as well:
>      - **An import allowlist.** `no-restricted-imports` refuses every specifier except `./<name>.ts`, `../value.ts` and `decimal.js`, for `import`, `import type` and `export … from`. For `value.ts` the allowlist is narrower: `decimal.js` only. That refuses every `node:*` built-in and every npm or workspace package in a static declaration. The engine uses no `@mth/*` workspace import. Run-time module loading is refused in these spellings: `import()`, `require`, `createRequire`, `import.meta`, and `process` (which carries `getBuiltinModule`).
>      - **Host globals.** `process`, `global`, `globalThis`, `self`, `window`, `frames`, `parent`, `top`, `opener` and `document` are refused both through `no-restricted-globals` and as any identifier, so a shadowing `declare const global` is refused too. The engine uses none of them.
>      - **Constructor keys.** Any string literal, template element or identifier equal to `constructor` is refused, except the name of a class constructor declaration.
>      - **Prototype reflection and assembled keys.** Also refused: prototype reflection (`getPrototypeOf`, `getOwnPropertyDescriptor(s)`, `setPrototypeOf`, `defineProperty`, `__proto__`, …), a computed key assembled from a string literal (`["con" + k]`, or a template with substitutions), and a computed member read directly off a function expression.
>      - **The listed handler and asynchrony forms (F-DG3-100 rounds 5–6).** Lint refuses exactly these forms, through `no-restricted-syntax` selectors and `no-unsafe-finally`:
>        - **L1, catch shape.** A `catch` whose parameter is not the identifier `e`, or whose first statement is not exactly `if (e instanceof EvalError) throw e;` with a bare `throw` and no `else`. That covers an optional-binding `catch { }`, a destructured or differently named parameter, a rethrow inside a block or after another statement, and any other first statement. The fixed name `e` lets a selector express the rule, because esquery cannot compare two attributes. All five catches of the closure have this shape.
>        - **L2, `EvalError` outside `instanceof`.** `EvalError` is allowed only as the right operand of `instanceof`, so a local declaration named `EvalError` is refused.
>        - **L3, control flow in a `finally`.** A `return`, `throw`, `break` or `continue` that `no-unsafe-finally` reports (one that leaves the `finally` block).
>        - **L4, generators (round 6).** A generator function, method or expression (`:function[generator=true]`) and any `yield` (`YieldExpression`). These cover the reviewer's G1 and G2.
>        - **L5, promises and async functions.** The identifiers `Promise` and `queueMicrotask`, an `async` function, `await` and `for await`.
>        - **L6, reaction names in any position (widened in round 6).** The names `then`, `catch` and `finally` as an identifier (a member such as `.then`, a property key, a destructured name such as `const { then: t } = p`, a variable), a private name, a string literal (also as a computed key `["then"]`) or a template element. The `try`/`catch`/`finally` statement keywords are not identifiers and stay allowed. This covers the reviewer's A1 and A2.
>        - **L7, asynchronous sources (round 6).** The names `fromAsync` (as in `Array.fromAsync`) and `asyncIterator` (as in `Symbol.asyncIterator`), in the same positions as L6.
>      - **What the list is for.** Each listed form can handle, hold or move a refused code generation (an `EvalError`) inside the closure, so that it does not reach the test that exercised it (layer 3). The engine sources contain none of the listed forms: lint and the scan pass on all seven files.
>      - **Pinned by tests.** `fuzz.test.ts` asserts that each selector is in the computed configuration of every closure file. It also lints the reviewer's G1, G2, A1, A2 and F1 helpers and the probe-table spellings below with `ESLint.lintText`, as if they were `formula/tokenize.ts`, and requires a rule to refuse each one.
>    - **Limit.** This layer is a denylist of the listed spellings, plus the import allowlist. It is not complete: JavaScript can assemble a property key at run time from values that no static rule sees, and it can handle an exception through forms that are not on the list.
> 2. **Static layer: the source scan (`fuzz.test.ts`, `scanSource`).**
>    - It mirrors layer 1 on the engine sources, with comments stripped and with regular expressions over the text, not a parser. Its file set is the six `formula/` sources and `value.ts`, and the closure test asserts that this set contains the whole closure. It checks the same denylist words, the host globals, the word `constructor` outside a class constructor declaration, prototype reflection, string-assembled keys, `import.meta`, hex and Unicode escapes, and the same import allowlists (`decimal.js` only for `value.ts`).
>    - **The listed handler and asynchrony forms.** Its mirror of L1–L7 reports a hit for:
>      - L1: a `catch` word that is not the catch clause of a `try` statement (it must follow the `}` of a block that follows `try`), or that does not begin `catch (e) { if (e instanceof EvalError) throw e;` with no `else` after it;
>      - L2: an `EvalError` that does not follow `instanceof`;
>      - L3: a `finally` word that is not the finally clause of a `try` statement opening a block, or whose block text contains `return`, `throw`, `break` or `continue`. Unlike `no-unsafe-finally`, this also counts one inside a nested function or loop in the block;
>      - L4: `function*`, a generator method (a `*` before a name or `[` after `{`, `}`, `,`, `;`, `static` or `async`) and the word `yield`;
>      - L5: the words `Promise`, `queueMicrotask`, `async` and `await`;
>      - L6: the word `then` anywhere, and `.then`, `.catch`, `.finally` or `["then"]`, …; the words `catch` and `finally` anywhere except the clause positions of L1 and L3 (a key, a member, a destructured name, a method name, a string);
>      - L7: the words `fromAsync` and `asyncIterator`.
>    - **Its brace matcher (round 6).** L1 and L3 locate blocks with `bracePairs`. It skips string literals, template literals outside their `${…}` substitutions, and regular-expression literals, so a `}` inside one of them ends no block. The reviewer's F1, `finally { const s = "}"; return; }`, is now a hit (in round 5 the matcher missed it, while lint refused it). Whether a `/` starts a regular-expression literal is decided by a heuristic: it does when the previous significant character is an operator or punctuator. If the braces, quotes or templates of a source do not balance under these rules, the scan reports a hit. ESLint, which parses the module, remains the reference for layer 1's forms.
>    - A probe table pins that each F-DG3-100 form is a hit:
>      - the round-1 forms O1–O6;
>      - the round-2 forms N1–N12;
>      - other non-allowlisted imports;
>      - the round-4 handler forms W1 (`catch { }`), W2 (`finally { return; }`), W4 (`Promise…then(…).catch(…)`) and W5 (a catch that wraps the error);
>      - the round-5 forms G1, G2, A1 and A2, built from the same text as the reviewer's probes, and F1 with four relatives (a `}` in a single-quoted string, a template, a substitution and a regular expression);
>      - the other spellings of L1–L7 above;
>      - the string-named specifiers (X1).
>    - Its limit is the same as layer 1's.
> 3. **Run-time layer, independent of spelling (`vitest.config.ts`, project `unit-formula-nocodegen`).**
>    - `pnpm test` runs the whole formula test corpus a second time: every `*.test.ts` under `packages/shared/src/formula/`, including `formula.test.ts` and `fuzz.test.ts`. It runs in forked Node processes started with `--disallow-code-generation-from-strings`.
>    - In those processes, V8 refuses code generation from strings: `eval` and the construction of a function from a string throw `EvalError`. The canary (below) checks this for `new Function`, direct and indirect `eval`, and the AsyncFunction and GeneratorFunction constructors reached through a prototype.
>    - **What it refuses.** An engine path that a test exercises and that generates code from a string throws `EvalError` there. If the `EvalError` reaches the exercising test, that test fails, unless it expects an `EvalError` (only the injection tests named under "Regression" do). It reaches the test if nothing between the throw and the test handles, holds or moves it. Inside the closure, lint and the scan refuse the listed handler and asynchrony forms L1–L7, and the five catch clauses rethrow it (next point). A form outside that list is the residual below.
>      - **The rethrow in the five catches (F-DG3-100 rounds 4–5).** Every catch clause in the closure begins with `if (e instanceof EvalError) throw e;`, instead of converting an `EvalError` into a problem or a null. Lint and the scan require that first statement for every catch clause they see (L1).
>        - **The five catch clauses:** `validateFormula` and `evaluateFormula` in `index.ts`, the tree walk in `evaluateAst` (`evaluate.ts`), `parseFormula` (`parse.ts`), and `formatDecimal` in `value.ts`.
>        - **The `parse.ts` catch.** It already rethrew everything that is not its own `ParseFailure`. Round 5 gave it the same first statement, which changes no behaviour. Round 5 also moved the rethrow to the top of the `evaluateAst` catch, ahead of the `EvalFailure` check. `EvalFailure` is a separate class, not a subclass of `EvalError`, so this changes no behaviour either.
>        - **The closure today.** Lint and the scan find none of L1–L7 in the seven files, and they contain no `finally` block at all (`grep`, T-DG3-KBE-H).
>      - **An internal failure fails the tests.** Every outcome check in `fuzz.test.ts` refuses a problem with `params.reason: "internal"`, through the helper `internalProblems`. That covers `checkOutcome` (all 40,000 generated inputs, for both `validateFormula` and `evaluateFormula`) and the code-shaped-payload test. Every row of `formula.test.ts`'s rejection table refuses one too.
>      - **Regression.** `codegen.nocodegen.test.ts` runs a real string code generation inside four of the five catches (all but `parse.ts`), through the public entry points: a caller-supplied getter, or a crafted checked formula. It requires the `EvalError` to come out. In both projects, `formula.test.ts` pins the other half: a `TypeError` at the same four points is still converted. Both files also inject an `EvalError` at those four points (the injection tests).
>        - **Why `parse.ts` has no regression case.** Its `try` processes only the tokenizer's own token list, so no caller-supplied value reaches it. Its rethrow is pinned by lint and the scan instead.
>      - **Production behaviour.** A genuinely unexpected error, other than an `EvalError`, is unchanged: it is a 422 `formula.syntax` problem with `reason: "internal"` (`formatDecimal`: null, shown as Unknown). No layer finds a code generation in the engine today. If an `EvalError` were thrown inside one of the five `try` blocks, the catch would rethrow it rather than convert it into a user's syntax error.
>        - **API.** The API's error handler answers with the generic 500 `internal` problem.
>        - **Web.** The web defines no error boundary or `errorElement` of its own (`apps/web/src/app/router.tsx`). The formula builder (`useLiveCheck`) and the example preview (`BenefitFormulasPage.tsx`) call `evaluateFormula` while rendering. An `EvalError` would therefore reach React Router 7.9's default error element, which replaces the page. It shows "Unexpected Application Error!", the error message and its stack, in English only (not translated, not RTL).
>    - **Canary.** `codegen.nocodegen.test.ts` runs only in this project. It asserts that the flag is in the process's `execArgv`, and that each of these throws `EvalError`: `new Function`, direct and indirect `eval`, and the AsyncFunction and GeneratorFunction constructors reached through a prototype. If the flag is missing from the project's `execArgv`, the canary fails.
>    - **Not covered by the flag.** It does not cover `node:vm`, `node:inspector`, or a module loaded with `process.getBuiltinModule`. Layers 1–2 refuse those spellings in every file of the engine's import closure, `value.ts` included, through the import allowlists and the `process` ban. The closure test checks that every file the closure parser follows is in both static layers. `decimal.js` is outside layers 1–2 (see "Scope").
>    - **Mechanics**, recorded because they are not obvious:
>      - Vitest 3.2 honours the forks pool's `execArgv` only at the root, so the project runs in its own Vitest invocation, the second command of `pnpm test`. The config refuses to combine it with another project.
>      - Neither the `threads` pool nor `vmForks` can carry the flag: worker threads refuse it (`ERR_WORKER_INVALID_EXEC_ARGV`), and `node:vm` contexts re-enable code generation.
>      - tinypool 1.1.1 resolves its warm-up handler through `new Function` when the handler name is not exported. So `test-support/nocodegen-preload.mjs`, loaded with `--import`, renames that one warm-up message to the worker's `run` export. The preload enables no code generation.
>
> **Residual.** Two gaps remain, and this section claims nothing beyond them.
> - **Unexercised paths.** The run-time layer covers only what the tests exercise: the unit tests, and the fuzz tests with 40,000 generated inputs through `validateFormula` and `evaluateFormula`. No coverage figure is claimed. A code-generating path that no test exercises is caught only by the static layers, which refuse only the listed spellings.
>   - **The example.** `f[k](…)`, where `f` is an ordinary function variable and `k` is assembled at run time from non-literal parts, passes both static layers. Examples of such a `k`: a key harvested with `Object.getOwnPropertyNames`, or built with `String.fromCharCode`, `atob`, `decodeURIComponent` or a reversed string (the reviewer's Q1–Q5).
> - **Self-handling forms outside the list.** A self-handling form outside the list L1–L7, even on an exercised path, is refused by no layer. It is the run-time analogue of Q1–Q5: the static layers do not see it, and the run-time layer sees only an `EvalError` that reaches a test. Historical examples, all three now refused statically (round 6):
>   - G1: a generator `try { … } finally { yield 0; }` whose iterator is dropped after one `next()`; the exception in flight is held at the suspended `yield` (now L4);
>   - G2: the same, then the iterator's `return(0)`, whose return completion replaces the pending throw (now L4);
>   - A1: a promise obtained without the name `Promise` (`Array.fromAsync([0])`) with a destructured `then`, whose second reaction handles the rejection (now L6 and L7).
> - **Other forms the reviewer tried (round 5).** The reviewer also tried forms that the list does not name and that do not handle the exception themselves: an `EventTarget` listener (E1) and an `AbortSignal.onabort` handler (E2). The host reports a listener's exception as an unhandled error, and the no-codegen run failed. An `Error[Symbol.hasInstance]` redefinition that defeats the L1 rethrow (H3/H4 in the reviewer's numbering) also failed at run time, because it breaks the canary's and the injection tests' `EvalError` assertions; the scan also refuses the string-literal-key variant through its prototype-reflection word. These are the reviewer's round-5 observations, not guarantees.
> - **A converting catch.** A catch that wraps or converts the `EvalError` (W5) lacks the required first statement, so lint and the scan refuse it (L1). The reviewer's W5 was also refused at run time (rounds 4 and 5), through the internal-failure rule: the outcome checks that reached it failed. That rule is defence in depth: with the required first statement, a catch converts only errors that `instanceof EvalError` does not match.
>
> **Production.**
> - **Browser.** The web bundle, which includes this engine, is served by the API through `@fastify/static`. It carries the CSP from `HELMET_OPTIONS` in `apps/api/src/server.ts` (`useDefaults: false`): `script-src 'self'` with no `'unsafe-eval'`. Under that CSP the browser refuses `eval` and string `Function` construction for that document. This was verified on the emitted header (T-DG3-KBE-E evidence). It holds only where the API serves the web bundle; a different web host must send an equivalent CSP.
> - **Server.** No run-time flag is set in the API or worker processes, so there the engine relies on the static layers and on its tests.

**Sentence-to-evidence map.** "Probe" rows refer to §3. `fz` = `packages/shared/src/formula/fuzz.test.ts`; `cfg` = `eslint.config.js`.

| §6 passage | What makes it true |
|---|---|
| No dynamic code: the listed spellings are forbidden and refused by the override; the scan mirrors them | `cfg` `FORMULA_GLOBALS`, `FORMULA_SYNTAX`, the `no-restricted-imports` paths; `fz` `FORBIDDEN`; probe O1–O6 (eslint=1 scan=1) |
| Extended guard: each layer refuses only what is listed; none proves no code generation | Definitional. The residual paragraphs, and round-5 G1/G2/A1 (passed all layers before this repair), show why |
| Scope: the seven files plus decimal.js; `value.ts` the only outside file | `fz` test "engine sources contain no eval…" (asserts the seven-file set); `fz` "the engine's whole static import closure…" (`closure.files` contains `value.ts`, `packages == ["decimal.js"]`); `cfg` `FORMULA_CLOSURE_OUTSIDE` |
| What the closure parser follows / does not follow | `fz` `IMPORT_SPECIFIER`; probe rows X1 (`export { "weightedScore" as zzX } …` etc.) |
| Layers 1–2 refuse `import()`, `require`, `createRequire`, `import x = require`, `import.meta` | `cfg` `ImportExpression`, the require/createRequire selector, `MetaProperty[meta.name='import']`; `fz` `dynamic import`, `require(`, `createRequire`, `import.meta`; probe O3, N12; the manual lint of `import x = require("node:vm")` (exit 1, §4) |
| ESLint parses the module, so its allowlist applies to every declaration | `cfg` `no-restricted-imports` `patterns.regex` (`FORMULA_IMPORT_ALLOWLIST`); probe N10, N11, V1 |
| The four assertions | `fz` tests "the engine's whole static import closure…" (first three) and "every file of the engine's import closure gets the engine-source lint rules" (fourth, with the new selectors added to its list) |
| What this means: a newly imported file fails until added | Same closure test: `closure.files.filter((f) => !scanned.has(f))` must be `[]` |
| ESLint tests run in unit-node only; ajv uses `new Function` | `it.skipIf(NOCODEGEN)` on both ESLint tests; the 2 skips in every `pnpm test` log |
| decimal.js: no `eval(`/`Function(`, none of the listed words outside comments | `word-greps.log` (grep exit 1 = none, for both files) |
| Layer 1 bullets (every formula file; engine sources only) | `cfg` blocks 3–5 (files/ignores); `fz` configuration test (globals, import patterns, selectors, `no-unsafe-finally` = 2) |
| L1 catch shape; "All five catches of the closure have this shape" | `cfg` `CATCH_RETHROWS_EVAL_ERROR`; `word-greps.log` (five `} catch (e) {` lines); `eslint-formula.log` exit 0; probe W1, W5, S1 |
| L2 `EvalError` only after `instanceof` | `cfg` `Identifier[name='EvalError']:not(…)`; `fz` row `const EvalError = RangeError;` |
| L3 `no-unsafe-finally` | `cfg` `"no-unsafe-finally": "error"`; probe W2, F1 (lint=1); the new ESLint test (`F1_FORMS` → `no-unsafe-finally`) |
| L4 generators | `cfg` `:function[generator=true], YieldExpression`; probe G1, G2, G3 (lint=1); the new ESLint test (G1, G2 → `no-restricted-syntax`) |
| L5 Promise/queueMicrotask/async/await/for await | `cfg` round-5 synchronous-engine selector; probe W3, W4 (lint=1) |
| L6 then/catch/finally in any position; statement keywords stay allowed | `cfg` new `Identifier/PrivateIdentifier/Literal/TemplateElement` selector; probe A1, A2 (lint=1); `eslint-formula.log` exit 0 with the five catch clauses present |
| L7 fromAsync/asyncIterator | Same selector; probe A1; `fz` rows `Array.fromAsync`, `Symbol.asyncIterator` (lint-checked in the new ESLint test) |
| What the list is for | Reviewer's `generator-swallow-demo.log` and round-5 G1/G2/A1 results (semantics); W1–W4 (round 4) |
| The engine sources contain none of the listed forms | `eslint-formula.log` exit 0; `fz` "engine sources contain…" passes (scan returns `[]` for all seven files) |
| Pinned by tests (selectors in config; lintText of G1, G2, A1, A2, F1 and probe spellings) | `fz` "every file … gets the engine-source lint rules"; `fz` "ESLint refuses the round-5 handler forms…" (filters parse errors out, so a rule must fire); mutation check in §2 |
| Limit: a denylist; keys assembled at run time; forms not on the list | Probe H2, H4, round-3 S1–S3 (lint=0 scan=0); E1/E2 (lint=0 scan=0) |
| Layer 2: comment-stripped regexes, file set, words | `fz` `stripComments`, `FORBIDDEN`, `scannedFiles`, `IMPORT_ALLOWLIST`/`CLOSURE_OUTSIDE_IMPORT_ALLOWLIST` |
| Scan L1 (catch only in a try statement, with the rethrow) | `fz` `rethrowRuleHits` (`beforeBlock` + `/\btry$/` + `CATCH_RETHROW`); rows "catch outside a try statement" (destructured, key, class method after `}`, template) |
| Scan L2 | `fz` `rethrowRuleHits` `EvalError` count |
| Scan L3, including nested function or loop (unlike `no-unsafe-finally`) | `fz` `rethrowRuleHits` (block text via `bracePairs`); rows `for (;;) { try … finally { break; } }`, W2, F1 forms |
| Scan L4 / L5 / L6 / L7 | `fz` `FORBIDDEN` `generator`, `Promise`/`async`/`await`, `.then/.catch/.finally` + `then` + the catch/finally position rule, `fromAsync/asyncIterator`; the matching probe rows |
| Brace matcher skips strings, templates, regex literals; F1 is a hit; heuristic for `/`; unbalanced → hit | `fz` `bracePairs`; rows `F1_FORMS` (5) and "unbalanced braces, quotes or templates" (2); clean-code rows with `/^[a-z][a-z0-9_]{0,47}$/`, `"{"`, `` `}${"{"}` ``, `a / b / c`, `/[{}]/`; probe F1 now scan=1; mutation check (7 failures) |
| Probe table contents | `fz` `PROBES` (O, N, imports, W1/W2/W4/W5, `ROUND5_HANDLER_FORMS`, `F1_FORMS`, round-6 spellings, X1) |
| Layer 3: the corpus runs again under the flag | `package.json` `test` script (second `vitest run --project unit-formula-nocodegen`); `vitest.config.ts`; logs show "Test Files 3 passed" for that invocation |
| V8 refuses code generation; what the canary checks | `codegen.nocodegen.test.ts` lines 12–41 |
| What it refuses (conditional on reaching the test) | Probe G3 (run-only-fails=3), round-3 S1–S3 (run-time), W5/W6 (run-time); contrast G1/G2/A1 in round 5 |
| Every catch clause in the closure begins with the rethrow; lint and the scan require it | `word-greps.log` (five clauses); `eslint-formula.log` exit 0; L1 rules |
| The five catch clauses; the `parse.ts` catch; `EvalFailure` not an `EvalError` | Source lines `evaluate.ts:256`, `index.ts:102/134`, `parse.ts:67`, `value.ts:154`; reviewer's round-5 verification ("parse.ts and evaluate.ts change no behaviour") |
| The closure today: none of L1–L7; no `finally` block | `eslint-formula.log`; `fz` scan test; `word-greps.log` (no `finally` in the engine sources) |
| An internal failure fails the tests | `fz` `internalProblems` in `checkOutcome` and the code-shaped-payload test; `formula.test.ts` rejection table; probe W5 (run-only-fails=3) |
| Regression; why `parse.ts` has no case | `codegen.nocodegen.test.ts` (four catches); `formula.test.ts` (TypeError converted; EvalError injection) |
| Production behaviour, API, web | Unchanged since round 5 (reviewer verified the router and the error handler in round 5). The `EvalError` clause is now conditional: "If an `EvalError` were thrown inside one of the five `try` blocks, the catch would rethrow it" (the L1 first statement) |
| Canary: fails if the flag is missing | `codegen.nocodegen.test.ts:12-13` (`expect(process.execArgv).toContain(…)`) |
| Not covered by the flag; layers 1–2 refuse those spellings | Probe V1 (`node:vm` in `value.ts`), N9 (`process.getBuiltinModule`), N10 (`node:inspector`) |
| Mechanics | Unchanged since round 5: `vitest.config.ts`, `test-support/nocodegen-preload.mjs` |
| Residual: unexercised paths, Q1–Q5 | Probe H2/H4 and round-3 S1–S3 (lint=0 scan=0) |
| Residual: self-handling forms outside the list (reviewer's wording); G1, G2, A1 historical, now L4, L6, L7 | Round-5 reviewer logs (PASSES ALL THREE LAYERS); this run (lint + scan) |
| Other forms the reviewer tried (E1, E2, hijack) | Reviewer round-5 logs, reproduced in this run: E1/E2 run-time, H1/H3 scan + run-time (the scan hit is "prototype reflection", seen in the H1 SCAN line of `rethrow-rule-attack-probe.log`), H2/H4 run-time |
| A converting catch (W5) | `cfg` L1; probe W5 lint + scan + run-time (this run and the reviewer's round 5) |
| Production: browser CSP, server | Unchanged since round 5 (T-DG3-KBE-E evidence) |

**The four changed domain sentences of §6:**
- "Percentages are stored as fractions, not as 12 for 12%: the API takes and returns fractions, and the web converts at input and display." This is the `fraction` kind (`types.ts`), backed by the API schema (fractions).
- "decimal.js only, through a clone with precision 80 and `ROUND_HALF_UP`; formula values are held as `Decimal`s, not JavaScript numbers." Backed by `evaluate.ts` and the generic `parseFloat` ban in `cfg`.
- "Both limits are enforced while parsing, so deeply nested input fails with `too_deep` or `too_many_nodes` instead of recursing further (`formula.test.ts`)." Backed by `parse.ts` `enter()`, which runs before each deeper call, and `formula.test.ts:271`.
- "…so minutes + hours is refused rather than summed (`formula.test.ts`)." Backed by `formula.test.ts:451-452`.

**Other absolute wording I left in place** (outside the guard part), because the code enforces it and it is outside the guard:
- "the result is **Unknown (null)**, never 0 or Infinity": division by zero returns a null result (formula tests);
- "`too_long` is therefore reachable only through direct calls…, never through the API": the API schema's `maxLength` 2000;
- "Code-point vs UTF-16 counting … cannot admit an invalid formula…": the grammar is ASCII.

If the reviewer reads any of these as overclaiming, I will narrow it the same way.

## 6. Known gaps / not done

- **The residual is real.** As §6 now says, a self-handling form outside L1–L7, even on an exercised path, is refused by no layer. The list is not complete; I did not try to enumerate every host channel that can hold or swallow an exception. The residual is stated, not closed, which the reviewer's criterion allows (options (a) and (b) both done).
- **The scan's regular-expression-literal detection is a heuristic.** A crafted pair of regex literals that the heuristic misreads as division could still hide a `return` in a `finally` from the scan. Lint (`no-unsafe-finally`, a real parser) still refuses it. §6 says that ESLint is the reference.
- **The two static layers are not an exact mirror.** For example, the scan refuses F2 (`catch (e: unknown)`), which lint allows, and the scan refuses H1/H3's `Object["defineProperty"]` (its prototype-reflection word, in a string), which lint allows (lint=0, scan=1). §6 claims, for each layer, only the forms listed for it.
- **Probe clone install.** The clone used the worktree's `node_modules` (same lockfile), not a fresh offline install, because the pnpm store is read-only here (§4).
- **Nothing closes F-DG3-100 here.** Only the originating reviewer can verify it.

## 7. Merge instructions

- No migration, no dependency change, no API, OpenAPI or web change. No engine source changed.
- Files: `eslint.config.js` (formula blocks), `packages/shared/src/formula/fuzz.test.ts`, ADR-0024 §6, `p3-work-split.md` §9 item 28. Expect no conflict unless another task edits the same formula blocks or §6.
- The integrator commits these changes. They are uncommitted in `dg3/kbe-h`. The untracked top-level dot-files in the worktree (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json`, …) were present before I started and are not mine.
