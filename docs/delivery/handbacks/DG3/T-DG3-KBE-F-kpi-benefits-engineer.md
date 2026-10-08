# Handback T-DG3-KBE-F: F-DG3-100 third pass (kpi-benefits-engineer)

- **Stage / task:** P3 / DG3, repair before review round 4. Assignment `docs/delivery/assignments/DG3/round-4/T-DG3-KBE-F.md` (sha256 `e47ac01e…162aa`, verified).
- **Finding:** F-DG3-100 (Low, REQ-PB-056), OPEN after the round-3 code-security verification.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-KBE-F-kpi-benefits-engineer-20261008T134120Z-5369bb5c","session_id":"5369bb5c-a14f-44a6-8aa4-6b1cb2081cc2"}`
- **Working tree:** `/home/user/wt/dg3-kbe-f`, branch `dg3/kbe-f`, HEAD `1f02d3bcbb08aa978c1901ab2f84380c06de6c5a` (round-3 candidate `f2b4c77a` / source `ce988e2` plus the round-3 review records). The changes are **uncommitted**, as instructed.
- **Time:** start `Thu Oct 8 13:41:31 UTC 2026`, end `Thu Oct 8 14:10:47 UTC 2026` (`date -u`), about 30 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0, before any change (`T-DG3-KBE-F-evidence/00-validate-dg2-historical.log`). Re-run at the end: §7.
- **Approvals:** none. This is engineering work. No business, Finance or IT approval is granted or implied, and product gate G6 does not imply DG7.

All evidence is under `docs/delivery/handbacks/DG3/T-DG3-KBE-F-evidence/` (`E/` below).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/formula/index.ts` | `validateFormula` and `evaluateFormula` rethrow `EvalError` instead of converting it into a problem. Every other error keeps becoming a 422 `formula.syntax` `internal` problem. The `internalProblem` doc comment states the rule and its reason. |
| `packages/shared/src/formula/evaluate.ts` | `evaluateAst`'s tree-walk catch also rethrows `EvalError`. Doc comment updated. |
| `packages/shared/src/value.ts` | `formatDecimal`'s catch rethrows `EvalError` (one line plus a comment). Allowed by the assignment "only if the guard needs it": it is a catch inside the engine's import closure, and otherwise an exercised code generation in `fromStored` would become a null. Behaviour is unchanged for every input (§2.1). No other change. |
| `packages/shared/src/formula/fuzz.test.ts` | `internalProblems` helper. `checkOutcome` and the code-shaped-payload test refuse any `internal` problem. The scan's file set now includes `../value.ts`, with its narrower allowlist. New tests: the engine's static import closure is in the scan set (both projects), and every closure file gets the engine-source ESLint rules (unit-node only, §2.2). |
| `packages/shared/src/formula/formula.test.ts` | The same `internalProblems` helper. Every row of the rejection table ('rejects … at offset N', including the offset-0 rows) refuses an `internal` problem for both `validateFormula` and `evaluateFormula`. New block (4 tests): at each of the four catches, a `TypeError` is still converted and an `EvalError` is rethrown. |
| `packages/shared/src/formula/codegen.nocodegen.test.ts` | Regression (4 tests, no-codegen project only): a **real** string code generation inside each of the four catches, through the public entry points, must surface as `EvalError`. |
| `eslint.config.js` (formula-engine blocks only) | `FORMULA_CLOSURE_OUTSIDE = ["packages/shared/src/value.ts"]` added to both formula blocks, plus one block giving `value.ts` a `decimal.js`-only import allowlist. |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6 | "Extended guard" corrected. New "Scope: the engine's import closure" paragraph. Layers 1–2 now name `value.ts`. The layer-3 guarantee now names the two rules that make it true (the `EvalError` rethrow and the internal-failure rule), the regression and the production behaviour. "Not covered by the flag" now refers to the whole closure. The residual names the Q1–Q5-style keys. |
| `docs/architecture/p3-work-split.md` §9 | New heading "Amendments in the DG3 round-4 repair (T-DG3-KBE-F, 2026-10-08)", item 26. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-F-*` | This handback and its evidence. |

`vitest.config.ts` is unchanged: no change was needed.

## 2. Behaviour delivered (REQ-PB-056, F-DG3-100)

### 2.1 An exercised `EvalError` fails. Choice: (a), the engine rethrows `EvalError`

**What the engine does now.** Every catch in the engine's import closure rethrows `EvalError` before converting anything. There are four:
- `validateFormula`;
- `evaluateFormula`;
- `evaluateAst`'s tree walk;
- `value.ts` `formatDecimal`.

`parseFormula`'s catch already rethrew everything except its own `ParseFailure`.

**Why (a) and not (b).**
- With (a), the `EvalError` escapes as an exception, so **every** test in the no-codegen project that reaches the path fails, whatever it asserts. That includes tests that only check `ok === false` or `result === null`, and future tests in any file.
- Option (b), a shared assertion helper, protects only the tests that call it.
- I also implemented the internal-failure rule from repair step 1 (the `internalProblems` refusal). So there are two independent mechanisms: if a future catch converted the error again, the fuzz outcome checks and the rejection table would still fail. The no-rethrow run in §4 shows this.

**Production behaviour.**
- **Genuinely unexpected errors** (`TypeError`, `RangeError`, a decimal.js `Error`, …): unchanged. They still return a 422 `formula.syntax` problem with `params.reason: "internal"` and `offset: 0`. `formatDecimal` still returns null (Unknown) for any non-`EvalError`. This is pinned in both projects by `formula.test.ts` "internal failures: converted, except EvalError".
- **`EvalError`:**
  - **Why it cannot occur in production.** The host throws it only when code is generated from a string and code generation is refused. In Node that needs `--disallow-code-generation-from-strings`; in a browser, a CSP without `'unsafe-eval'`. The engine generates no code, so this cannot occur in production.
  - **If it ever did occur** (meaning the "never runs code" guarantee had been broken), it now propagates instead of being shown as a user syntax error:
    - In the API, `problemForError` (`apps/api/src/modules/platform/hooks.ts`) answers with the generic 500 `internal` problem, with no internal detail.
    - In the web formula builder, the error boundary shows.
  - **Why that is right.** Hiding a security-guard violation as "Syntax error at offset 0" is the defect the reviewer found.
- **API and web contracts:** no change. The integration suite (§3) checks the API callers.

**Existing inputs.** No existing fuzz, table or payload input produces an internal failure today. With the new refusals, all 40,000 fuzz inputs, the 15 payloads and every rejection row pass in both projects, so there was nothing to report.

### 2.2 The engine's whole import closure is guarded

**Lint.** `value.ts` gets every engine-source rule:
- `no-eval`, `no-implied-eval` and `no-new-func`;
- the `Function`/`eval`/`Reflect` and host-object globals;
- every `FORMULA_SYNTAX` and `FORMULA_SOURCE_SYNTAX` selector;
- an import allowlist narrowed to `decimal.js`, so `value.ts` cannot pull a further file into the closure.

`value.ts` needed **no exception**: `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` exits 0 with the unchanged code.

**Scan.** The scan's file set is now the six `formula/` sources plus `value.ts`, with the same narrower allowlist for `value.ts`. `value.ts` scans clean.

**Closure test** (`fuzz.test.ts`).
- `engineImportClosure()` follows every static `import` and `export … from` (type-only included) from `formula/index.ts`. Today it finds the six formula sources plus `value.ts`, and the single package `decimal.js`.
- It asserts:
  - no unresolved relative specifier;
  - `decimal.js` is the only package;
  - `value.ts` is in the closure (the test is not vacuous);
  - every closure file is in the scan's file set.
- A second test calls `ESLint.calculateConfigForFile` for every closure file. It asserts the core no-eval rules, the restricted globals, an import allowlist that refuses `node:vm`, `vm`, `node:module`, `node:inspector`, `node:fs`, `zod` and `@mth/shared` but allows `decimal.js` (and, outside `formula/`, refuses `./other.ts`), and ten representative engine-source selectors.

**Disclosed limitation.**
- The ESLint-config test is `it.skipIf(NOCODEGEN)`: it runs in `unit-node` only, which is why the no-codegen project reports 1 skipped.
- **Why.** ESLint validates rule options with ajv, which compiles schemas with `new Function`. Under the flag, ESLint throws `InvalidRuleOptionsSchemaError` caused by `EvalError: Code generation from strings disallowed`. I observed that before writing the test.
- **Why that is acceptable.** Lint coverage is a property of `eslint.config.js`, not of the process. The closure and scan-coverage test runs in both projects.

**Mutation proof** (`E/14-closure-test-mutations.log`, disposable clone). Each mutation fails at least one closure test:

| Mutation | Result |
|---|---|
| M1: `FORMULA_CLOSURE_OUTSIDE` emptied | The lint-coverage test fails. |
| M2: `value.ts` imports a new `./zz-extra.ts` | Both tests fail (`expected [ 'zz-extra.ts' ] to deeply equal []`; `zz-extra.ts no-eval: expected undefined to be 2`), and ESLint refuses the import. |
| M3: `formula/types.ts` re-exports from `zod` | The closure test fails (`expected [ 'decimal.js', 'zod' ] to deeply equal [ 'decimal.js' ]`). |

**decimal.js** is pinned third-party code and is outside layers 1–2. ADR-0024 §6 says so. Its 10.6.0 `decimal.js` and `decimal.mjs` contain no `eval(` or `Function(` (`grep -c` = 0).

### 2.3 The record

**ADR-0024 §6.** I checked every statement in "Extended guard" against the code:
- **Scope.** The closure is defined, and so is what the closure test pins.
- **Layer 1.** It applies to `formula/**` **and `value.ts`**, with `value.ts`'s `decimal.js`-only allowlist.
- **Layer 2.** The file set includes `value.ts`.
- **Layer 3 guarantee.** "Any engine path that generates code from a string fails the engine's tests, provided a test exercises it", plus the two rules that make it true:
  - the `EvalError` rethrow at the four catches;
  - the internal-failure rule: every `fuzz.test.ts` outcome check and every rejection-table row refuses `reason: "internal"`.
  It also states the regression and the production behaviour.
- **"Not covered by the flag."** `vm`, `inspector` and `getBuiltinModule` are refused by layers 1–2 "in every file of the engine's import closure, `value.ts` included", and the closure test keeps it so. `decimal.js` is named as outside layers 1–2.
- **Residual.** An unexercised `f[k](…)` with a run-time key (`getOwnPropertyNames`, `fromCharCode`, `atob`, `decodeURIComponent`, a reversed string: Q1–Q5) passes both static layers. It is refused only on an exercised path.

**`p3-work-split.md` §9:** item 26 under the new round-4 heading.

## 3. Checks actually run

All commands ran in `/home/user/wt/dg3-kbe-f` unless a disposable clone is named. Node 24.21.0 unless stated. Offline.

| # | Command | Environment | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG2` | Node 24, before any change | `PASS gate DG2 (historical)`, **exit 0** | `E/00-validate-dg2-historical.log` |
| 1 | `pnpm -r typecheck` | Node 24 | **exit 0** | `E/20-typecheck-build-lint.log` |
| 2 | `pnpm -r build` | Node 24 | **exit 0** | same |
| 3 | `pnpm lint` | Node 24 | **exit 0** | same |
| 4 | `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` | Node 24 | **exit 0** | same |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | Node 24 | **exit 0** ("All matched files use Prettier code style!"). Re-run after this handback was written: §7. | `E/21-prettier.log` |
| 6a | `pnpm test` | Node 24.21.0, `LANG`/`LC_*` unset | **exit 0**: invocation 1 (unit-node + unit-web) **1593 passed (1593)**; invocation 2 (unit-formula-nocodegen) **199 passed, 1 skipped (200)** | `E/30-pnpm-test-node24-locale-unset.log` |
| 6b | `pnpm test` | Node 24.21.0, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **exit 0**: 1593 passed (1593); 199 passed, 1 skipped (200) | `E/30-pnpm-test-node24-locale-C.UTF-8.log` |
| 6c | `pnpm test` | Node 22.22.2, unset | **exit 0**: 1593 passed (1593); 199 passed, 1 skipped (200) | `E/30-pnpm-test-node22-locale-unset.log` |
| 6d | `pnpm test` | Node 22.22.2, C.UTF-8, **run 1** | **exit 1**: 1 failed, 1592 passed (1593) in invocation 1, so invocation 2 did not run (`&&`). Disclosed below. | `E/30-pnpm-test-node22-locale-C.UTF-8.run1-failed.log` |
| 6e | `pnpm test` | Node 22.22.2, C.UTF-8, **run 2** (identical command) | **exit 0**: 1593 passed (1593); 199 passed, 1 skipped (200) | `E/30-pnpm-test-node22-locale-C.UTF-8.run2.log` |
| 7 | `QA_PG_PORT=23100 MTH_PORT_POOL=23101-23149 tests/qa/support/with-pg.sh pnpm test:integration` | Node 24, disposable PostgreSQL 16 | see §3.1 | `E/40-integration-node24.log` |
| 8 | Reviewer probes, disposable clones | §4 | §4 | `E/10…15` |

**Counts against the round-3 baseline (1587 + 190).**
- unit-node + unit-web: 1587 → **1593**. That is +4 (`formula.test.ts` internal-failure block) and +2 (`fuzz.test.ts` closure and lint-coverage tests).
- unit-formula-nocodegen: 190 → **200**. That is +4, +2 and +4 (`codegen.nocodegen.test.ts` regression). 199 pass, and 1 is skipped by design (§2.2).

**Disclosed failure (6d).**
- **What failed.** `apps/web/src/auth/session-identity.test.tsx` › "F-DG2-500 sign-out here and 403 (en) › signing out here clears everything; B signing in afterwards never sees A's records" failed with `TestingLibraryElementError: Unable to find an element with the text: No transformations yet` after 5579 ms.
- **Why I believe it is unrelated.** It is a unit-web test of the session and sign-out flow, outside the formula engine and `value.ts`'s callers. The identical command passed in run 2. The same test appears in earlier `run1-failed` unit logs of other tasks (`T-DG3-BE-B-evidence/unit-c-utf8-run1-failed.log`, `T-DG3-ARCH-03-evidence/unit-locale-unset.run1-failed.log`).
- **Status.** I did not investigate or modify it; it is outside my scope. I report it as a flaky test.

### 3.1 Integration

`QA_PG_PORT=23100 MTH_PORT_POOL=23101-23149 tests/qa/support/with-pg.sh pnpm test:integration`, Node 24.21.0, disposable PostgreSQL 16 (`port-policy: PostgreSQL listening on port 23100 (attempt 1)`):
- **Test Files 56 passed (56); Tests 793 passed (793); exit 0.** This equals the round-3 baseline of 793.
- The engine's API callers (`apps/api/src/modules/kpi/benefit-formulas.ts`, `calculations.ts`) keep their behaviour.
- Ran 14:05:29–14:09:00 UTC (`E/40-integration-node24.log`).

## 4. Proof: the reviewer's probes (read-only copies, disposable clones)

**Setup.**
- The probes were copied byte-for-byte to `$TMPDIR/probes/`. The sha256 values equal the reviewer's files: `guard-layers-probe.mjs` `7887455b…c66196`, `exercised-probe.mjs` `c4e63640…1baa66a23`, `guard-bypass-probe.mjs` `934c62b1…04f0`.
- **Clones.** Each clone is `git clone` of this worktree plus `git apply` of my working diff (`E/01-working-diff.patch.txt`). `node_modules` was copied from the worktree with `cp -a`: `pnpm install --offline` fails with EROFS because the pnpm store is read-only in this sandbox.
- Clone paths: `$TMPDIR/review-p3-kbef` (main), `$TMPDIR/review-p2-kbef` (the round-2 probe needs `review-p2` in the path) and `$TMPDIR/review-p3-norethrow` (defence-in-depth run only).
- I never ran a probe in my tree, and I edited none of the reviewer's files.

### 4.1 Per-form table (`E/10-guard-layers-probe-S1-S2-S3-V1-V2.log`, `E/11-exercised-probe.log`)

`node $TMPDIR/probes/guard-layers-probe.mjs $TMPDIR/review-p3-kbef S1 S2 S3 V1 V2`. I added S2 and V2 to the assignment's `S1 S3 V1`, so the table covers all five forms. Probe exit 0. "Run-time" means a test fails under the flag and passes in the unit-node control.

| Form | lint | scan | no-codegen run | control | Refused by | Round 3 |
|---|---|---|---|---|---|---|
| **S1** (`tokenize.ts` `describe()` codegen, exercised by fuzz and 'été') | 0 | 0 | **1** (3 failed, all flag-only: 'rejects "été" … offset 0' and two fuzz tests) | 0 | **run time**, through the `EvalError` rethrow | passed all three layers |
| **S2** (codegen when a value ends in a fraction zero) | 0 | 0 | **1** (8 flag-only) | 0 | **run time** | run time |
| **S3** (codegen when `m = 50`) | 0 | 0 | **1** (2 flag-only: the byte-string and grammar fuzz tests) | 0 | **run time**, through the `EvalError` rethrow | passed all three layers |
| **V1** (`node:vm` `runInThisContext` in `value.ts` `checkDecimal`) | **1** (`'node:vm' import is restricted … imports only decimal.js`) | **1** (`value.ts: expected [ 'vm import', … ]`; the closure test fails too) | 1 (scan tests only; 0 flag-only, as expected: vm is outside the flag) | 1 | **lint + scan** | passed all three layers |
| **V2** (`new Function` in `value.ts`) | **1** (`no-new-func`, `no-restricted-globals`, `no-restricted-syntax`) | **1** | **1** (61 flag-only) | 1 | **lint + scan + run time** | run time only |

**Exercised probe** (`E/11-exercised-probe.log`): `node $TMPDIR/probes/exercised-probe.mjs $TMPDIR/review-p3-kbef`.
- With S1 and S3 applied, `vitest exit_status: 1`.
- `fuzz.test.ts`'s own three fuzz tests fail with `expected [Function] to not throw an error but 'EvalError: Code generation from strin…' was thrown`.
- The reviewer's probe tests S1 and S3 also fail, with `EvalError`, because the error is no longer swallowed.
- All four regression tests and the canary pass.
- The probe restored its files. Its `git status` shows only my applied diff.

### 4.2 The internal-failure rule on its own (defence in depth; not the delivered code)

**Setup.** In `$TMPDIR/review-p3-norethrow`, every `if (e instanceof EvalError) throw e;` line was deleted. The engine then converts the `EvalError` into an `internal` problem, as in round 3.

**Exercised probe** (`E/15-exercised-probe-without-rethrow.log`):
- The probe confirms the swallow: `validateFormula('été')` gives `reason: "internal", detail: "EvalError"`; 2,805 byte strings and 41 grammar strings are swallowed. These are the reviewer's round-3 numbers.
- `fuzz.test.ts`'s three fuzz tests now **fail** through the internal-failure rule: `AssertionError: "m": expected [ Array(1) ] to deeply equal []` (the `internalProblems` check in `checkOutcome`).
- The four regression tests fail as well.
- vitest exit 1.

**Guard-layers probe** (`E/13-guard-layers-probe-without-rethrow.log`): S1, S2 and S3 are each refused at run time. The no-codegen run fails, with 11, 15 and 10 failures respectively.
- **Note on the control.** In this mutated clone the unit-node control also fails. `formula.test.ts`'s simulated-`EvalError` tests correctly detect the missing rethrow. So the probe's "flag-only" list there shows the regression tests first. The per-test failures of the internal-failure rule are in `E/15`.

### 4.3 The 18 earlier forms (`E/12-guard-bypass-probe-18-forms.log`)

`node $TMPDIR/probes/guard-bypass-probe.mjs $TMPDIR/review-p2-kbef`: probe exit 0. O1–O6 and N1–N12 all show `eslint=1 scan=1`, **BLOCKED BY BOTH**, as in round 3.

## 5. Known gaps / not done

- **Lint-coverage test.** It runs in `unit-node` only (1 skipped test in the no-codegen project), because ESLint cannot run under the flag (§2.2). The closure and scan-coverage assertion runs in both projects.
- **decimal.js.** It stays outside layers 1–2. Its 10.6.0 sources contain no `eval(` or `Function(`, and layer 3 covers whatever the tests exercise. This is stated in ADR-0024 §6.
- **The residual stands, as ADR-0024 §6 states.** A Q1–Q5-style code generation on a path that **no** test exercises passes both static layers. The run-time layer and the internal-failure rule only see exercised paths.
- **Server processes.** The API and worker still run without the flag. The production statement in §6 is unchanged.
- **Flaky web test.** The unit-web failure in 6d is not investigated (outside scope).
- **Untracked files.** The worktree has untracked top-level dotfiles (`.bashrc`, `.profile`, `.gitconfig`, `.idea`, `.vscode`, `.mcp.json`, …). They were present before I started; they are not mine and I did not touch them. The orchestrator should not integrate them.

## 6. Merge instructions

- No migrations, no new dependency, no API or OpenAPI change, no web change.
- Integrate the files in §1 as one change. The tests depend on the engine and `eslint.config.js` edits together: for example, the lint-coverage test needs `FORMULA_CLOSURE_OUTSIDE`.
- **Expected conflicts:** none outside the files I own. `p3-work-split.md` §9 is append-only: the new heading and item 26 come after item 25.

## 7. End-of-task checks

Log: `E/50-end-checks.log`, 14:09:22–14:10:47 UTC, Node 24.21.0. This is the final state of the tree, with this handback present.

| Command | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` | `PASS gate DG2 (historical)`, **exit 0** |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** ("All matched files use Prettier code style!") |
| `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` | **exit 0** |
| `git status --short` | 9 modified tracked files (§1); untracked: this handback and `T-DG3-KBE-F-evidence/`. Nothing committed. |

The only edit after this run was to this section's text.

**Acceptance summary.**
1. typecheck, build, lint and prettier: exit 0.
2. `pnpm test`: passes on Node 24 and Node 22, with the locale unset and with C.UTF-8, in both invocations: 1593, and 199 + 1 skipped of 200. Node 22 with C.UTF-8 needed a second run, because run 1 had an unrelated flaky unit-web failure (disclosed in §3).
3. `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts`: exit 0.
4. Integration: 793/793, exit 0.
5. Per-form table (§4.1): S1, S2, S3, V1 and V2 are each refused by at least one layer, and the 18 earlier forms stay refused by lint and scan (§4.3).
6. The DG2 historical validator: exit 0.
