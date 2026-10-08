# Handback T-DG3-KBE-D: repair F-DG3-100 (kpi-benefits-engineer)

- **Stage:** DG3 (FIXING), repair before review round 2.
- **Assignment:** `docs/delivery/assignments/DG3/round-2/T-DG3-KBE-D.md` (sha256 `049cdd39…fdad0e9`, checked at the start).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-KBE-D-kpi-benefits-engineer-20261008T075626Z-283ccb61","session_id":"283ccb61-2a9c-415b-8706-f1e2ce79e821"}`
- **Base:** worktree `/home/user/wt/dg3-kbe-d`, branch `dg3/kbe-d`, `HEAD` `33f2ac0265310c409d9c0f31a212a6ca95ee996f`. I left the changes uncommitted for the orchestrator to integrate.
- **Time:** started 2026-10-08T07:56:46Z (`date -u`). The end time is in the last line of this file.
- **Evidence:** `docs/delivery/handbacks/DG3/T-DG3-KBE-D-evidence/`.
- **Product gates:** none touched. This task grants no business, Finance or IT approval. Nothing in it implies a product gate (G1–G6) or an engineering gate (DG7).

## 1. The fix for F-DG3-100

The engine code (`tokenize.ts`, `parse.ts`, `typecheck.ts`, `evaluate.ts`, `index.ts`, `types.ts`) is **unchanged**. I closed the gaps in both guards.

**The ESLint override** for `packages/shared/src/formula/**` in `eslint.config.js`. I extended only this block. Every existing rule is kept, including the repeated `parseFloat` ban, the timer selectors and the `.constructor(...)` call selector. The new rules:

- `no-restricted-globals`: `Function`, `eval`, `Reflect`. I checked that the engine uses no `Reflect` anywhere under `formula/`, so the whole global is refused rather than just `Reflect.construct` and `Reflect.apply`.
- `no-restricted-syntax` gets these new selectors:
  - `Identifier[name='Function']`. This catches every use of the name as a value or a property: an alias, `globalThis.Function`, and the argument of `Reflect.construct/apply`. Engine names such as `FormulaFunction` and `isFunctionName` are different identifiers and don't match.
  - A computed `MemberExpression` whose literal or template-literal property is `constructor` or `Function`, such as `x["constructor"]`, `` x[`constructor`] `` or `globalThis["Function"]`.
  - Any `.constructor` read, such as `const C = gen.constructor`, and any destructured `constructor` key in an `ObjectPattern`. The class `constructor(...)` methods in the engine are `MethodDefinition` nodes, so they are not affected.
  - A `CallExpression` whose callee is `require` or `createRequire`, either plain or as a member, plus the `createRequire` identifier itself.
  - `MemberExpression[object.name='Reflect']`.
- `no-restricted-imports`: `module` and `node:module`. I also added `worker_threads` and `child_process`, with and without `node:`, because a `Worker` with `eval: true` and a child process both run code from a string. Note that this goes beyond the list in the assignment.

**The source scan** in `packages/shared/src/formula/fuzz.test.ts`:

- I moved it into a function, `scanSource(text)`, and a `FORBIDDEN` table. The function strips comments first, so prose in a header comment is not a hit. String literals are still scanned.
- New patterns: `eval` identifier, `Function` identifier, `Reflect.construct`, `Reflect.apply`, `Reflect`, `["constructor"]` (any quote style), `.constructor` access, a `constructor:` key, `createRequire`, `require(`, `module`/`node:module`, and `worker_threads`/`child_process`. All the earlier patterns are kept.
- **New permanent tests:**
  - an `it.each` over 20 in-memory probe strings, one per bypass form plus the earlier forms, each of which must be a hit;
  - a false-positive test: comments, `FormulaFunction`/`isFunctionName`, a class `constructor`, the word "required" and a `https://` string must not be hits.
- The engine-sources test now asserts `scanSource(file) == []` for each of the six engine files.
- The fuzz tripwire has three lines that save, replace and restore `globalThis.Function`. They never call it. These lines are now refused by the new rule, so each carries a justified `// eslint-disable-next-line no-restricted-syntax -- tripwire (F-DG3-100 rule) …`. This mirrors the existing `no-eval` disables beside them. I kept the test files under the rule rather than exempting `*.test.ts`, so a probe named `*.test.ts` can't slip through.

**Records:**

- ADR-0024 §6 gets a new paragraph, "Extended guard (F-DG3-100, T-DG3-KBE-D)".
- `docs/architecture/p3-work-split.md` §9 gets item 22, under a new sub-heading "Amendments in DG3 repair round 2".

## 2. Changed files

| File | Purpose |
|---|---|
| `eslint.config.js` | Extends the formula-engine override block only (globals, selectors, imports; see §1). |
| `packages/shared/src/formula/fuzz.test.ts` | Extended scan as `scanSource()`, with the probe table and the false-positive test, plus three justified disable lines in the tripwire. |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` | One paragraph in §6 listing the extended guard. |
| `docs/architecture/p3-work-split.md` | §9 item 22. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-D-kpi-benefits-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-D-evidence/*` | Logs (§4). |

I didn't touch any ARCH-05 file: not the contract, `workflows/gates.ts`, `schemas/gate.ts` or the web Gates pages.

## 3. Behaviour delivered (REQ-PB-056, F-DG3-100)

### The lint probe

The probe was the temporary file `packages/shared/src/formula/zz-lint-probe.ts`. Its source, with line numbers, is in `lint-probe-source.txt`. It held every form from the finding plus a few related ones. I deleted it after the run, and `ls packages/shared/src/formula/` afterwards shows only the eight original files.

- **Before** (`lint-probe-before.log`). The round-1 config, taken from `git show HEAD:eslint.config.js`, gives **0 errors, exit 0** on the probe, which reproduces the finding. A control file in the same log shows that the round-1 config was really active: it still refuses `eval("1")` and `(() => 1).constructor("…")`, with exit 1.
- **After** (`lint-probe-after.log`). The repaired config gives **22 errors, exit 1**. Each form is refused (`lint-probe-per-form.txt`):

| Probe line | Form | Errors | Result |
|---|---|---|---|
| 2 | `import { createRequire } from "node:module"` | 3 | refused |
| 3 | `import * as mod from "module"` | 1 | refused |
| 4 | `Reflect.construct(Function, ["return 1"])` | 4 | refused |
| 5 | `Reflect.apply(Function, null, ["return 1"])` | 4 | refused |
| 6 | `const __F = Function` (aliased Function) | 2 | refused |
| 8 | `Object.getPrototypeOf(function* () {})["constructor"]("yield 1")` | 1 | refused |
| 9 | `` …[`constructor`]("yield 1") `` | 1 | refused |
| 10 | `createRequire(import.meta.url)("vm")` | 2 | refused |
| 12 | `require("vm")` | 1 | refused |
| 13 | `const C = (async () => {}).constructor` | 1 | refused |
| 15 | `const { constructor: D } = function* () {}` | 1 | refused |
| 17 | `globalThis["Function"]` | 1 | refused |

Lines 7, 11, 14 and 16 have no error of their own, and none is expected. Each one either calls or uses a value whose defining line is already refused, or it is the `declare const require` the probe needs to type-check.

### The scan probe

I ran the scan probe two ways:

- **In memory, permanently.** The `it.each` table in `fuzz.test.ts` runs 20 probes. `scan-probes-verbose.log` shows each one passing ("flags … as …"), plus the clean-text test and the engine-sources test: 26 tests, exit 0.
- **On a temporary file** (`scan-probe-file.log`). This was the lint probe source, copied to `$TMPDIR` and removed afterwards. Each line went through the round-1 patterns (from `HEAD`) and the repaired patterns, both copied verbatim from the test file:
  - Round-1 patterns: they flagged only `require("vm")` (as "vm require") and `globalThis["Function"]` (as "globalThis"). Every other form was **NOT FLAGGED**.
  - Repaired patterns: they flag every form line.
  - My first version missed the destructured `{ constructor: D }`. The file probe exposed this, so I added the `constructor key` pattern and a probe for it, then reran everything below.

### The engine is still clean

- `npx eslint packages/shared/src/formula/` exits 0 (`lint-formula-dir.log`).
- The engine-sources scan test passes.

## 4. Checks actually run (final tree)

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg3-kbe-d`. Before the test runs I checked for empty `.claude/.cc-writes` directories in source folders and found none. I used no harness ports.

| # | Command | Exit | Log | Tail |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG2` (at start) | 0 | `validate-historical-DG2-start.log` | `PASS gate DG2 (historical)` |
| 1 | `pnpm -r typecheck` | 0 | `typecheck.log` | — |
| 2 | `pnpm -r build` | 0 | `build.log` | — |
| 3 | `pnpm lint` | 0 | `lint.log` | — |
| 4 | `npx eslint packages/shared/src/formula/` | 0 | `lint-formula-dir.log` | — |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` | `All matched files use Prettier code style!` (run last, after this handback was written) |
| 6 | lint probe, round-1 config | 0 (expected: reproduces the finding) | `lint-probe-before.log` | no errors; the control shows 2 errors, exit 1 |
| 7 | lint probe, repaired config | **1 (expected)** | `lint-probe-after.log` | `✖ 22 problems (22 errors, 0 warnings)` |
| 8 | `npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts --reporter=verbose` | 0 | `scan-probes-verbose.log` | `Tests 26 passed (26)` |
| 9 | scan probe on a temporary file (scratch Node script, `$TMPDIR`) | 0 | `scan-probe-file.log` | see §3 |
| 10 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | `test-locale-unset.log` | `Test Files 80 passed (80)`, `Tests 1549 passed (1549)` |
| 11 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | `test-c-utf8.log` | `Test Files 80 passed (80)`, `Tests 1549 passed (1549)` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG2` (at end) | 0 | `validate-historical-DG2-end.log` | `PASS gate DG2 (historical)` |

Two exits differ from the others, and both are intended:

- **#7 exits 1.** This is the lint probe failing as it should.
- **#6 exits 0.** This is the round-1 config failing to catch anything, which is the defect being reproduced.

**Rerun disclosure.** I ran typecheck, build, lint, prettier and both `pnpm test` runs once before adding the `constructor key` scan pattern. All of them exited 0, at 1548 tests. I reran everything after that change, and the logs above come from the final tree. The 1549th test is the new probe.

## 5. Known gaps and limits

- **Lint is static.** A property name assembled at run time, such as `globalThis["Func" + "tion"]`, can't be refused by a selector. In the engine sources, the scan's existing `globalThis` ban covers that route. The lint block doesn't ban `globalThis`, because the fuzz tripwire in the test files needs it. A separate engine-only block could ban it, but the assignment allowed edits to this one block only.
- **The scan is a regex check, not a parser.** Comment stripping is heuristic: `//` preceded by `:` is kept, so URLs in strings survive. Any miss would fall on the side of flagging too much, and the engine source is clean under it.
- **F-DG3-100 is not closed by this handback.** As author I can't close it. Closing it needs a verification by code-security-reviewer or another qualified non-author in round 2.

## 6. Merge instructions

- No migrations, no dependency changes and no contract changes.
- Expect no conflict with ARCH-05: `eslint.config.js` changed only inside the formula block, and `p3-work-split.md` only by an appended §9 sub-section. If ARCH-05 also appends to §9, renumber item 22 if needed.

Finished: see the `date -u` line below.
- **End time (`date -u`):** Thu Oct  8 08:15:37 UTC 2026
