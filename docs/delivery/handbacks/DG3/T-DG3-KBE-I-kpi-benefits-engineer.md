# Handback T-DG3-KBE-I: F-DG3-280, the lintText test lints every probe-table row (kpi-benefits-engineer)

- **Stage:** DG3, repair before review round 7. **Requirement:** REQ-PB-056. **Finding:** F-DG3-280 (Low, non-mandatory, code-security round 6).
- **Invocation:** run `DG3-T-DG3-KBE-I-kpi-benefits-engineer-20261008T205525Z-36d7af8e`, session `36d7af8e-d72b-41e1-9652-2ccd7c347b89`.
- **Assignment:** `docs/delivery/assignments/DG3/round-7/T-DG3-KBE-I.md`, sha256 `ef445edd…94ffe7` (verified).
- **Starting revision:** worktree `/home/user/wt/dg3-kbe-i`, branch `dg3/kbe-i`, `HEAD` `cc7b463` (the round-6 candidate plus the round-6 review records). Changes are left uncommitted.
- **Time:** started 2026-10-08T20:55:40Z, ended 2026-10-08T21:10Z (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` exited 0 before any change (`validate-historical-DG2-before.log`) and again at the end (`validate-historical-DG2.log`).

I'm an engineering agent. Nothing here grants a business, Finance or IT approval, and no product gate G1–G6 is involved.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/formula/fuzz.test.ts` | The `ESLint.lintText` test now lints every probe-table row except the two named `LINT_EXCLUDED` rows. Each linted row must be refused by a **guard rule** of the formula block. The excluded rows must be parse errors. Also adds 2 private-name probe rows and a test that pins the exclusion list. |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` | §6 "Pinned by tests": only the lintText sentence changed, so that it states exactly what the test lints and excludes, and why. |
| `docs/architecture/p3-work-split.md` | §9: item 29 under a new "Amendments in the DG3 round-7 repair (T-DG3-KBE-I, 2026-10-08)" heading. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-I-kpi-benefits-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-I-evidence/*` | Scripts (`checks.sh`, `unit-tests.sh`, `mutations.sh`) and their logs. |

`eslint.config.js` is **unchanged**, because no lint gap was found (§2.2).

## 2. Behaviour delivered (REQ-PB-056, F-DG3-280)

### 2.1 Every probe-table row is linted

- **Before:** the test linted only the rows whose scan-hit name matched `/^(catch|finally|\.then|Promise|generator|then|fromAsync)/`, which is 48 of 99 rows.
- **Now:** it iterates over **all** `PROBES` rows, 101 after the 2 additions:
  - **99 rows are linted.** The test asserts `linted === PROBES.length - LINT_EXCLUDED.size`, so a row can't be skipped silently.
  - **2 rows are excluded,** each named in `LINT_EXCLUDED` with its reason. For each one the test requires a fatal parse error instead:
    - `const s = "unclosed;`: an unterminated string literal, so not a valid module;
    - `function f() {`: an unclosed block, so not a valid module.
- **A separate test pins the exclusion list.** `excludes from the ESLint test only the named probe rows that are not valid modules` checks that every excluded text is a probe row and that no other rows are matched.

### 2.2 Refusal now means a guard rule, and a weakness I found

The first version of the widened test still passed mutation M2. I traced the cause: the old assertion counted **any** non-null rule as a refusal. For example, `class C { #then() {} }` is also reported by `@typescript-eslint/no-unused-vars` ("'C' is defined but never used"), and that hid the removal of the `PrivateIdentifier[…]` selector.

- **The fix:** each linted row must now be refused by one of the formula block's guard rules:
  - `no-eval`, `no-implied-eval`, `no-new-func`;
  - `no-restricted-globals`, `no-restricted-imports`, `no-restricted-syntax`;
  - `no-unsafe-finally`.
- **The result:** all 99 linted rows meet this rule on this tree, so there is **no lint gap**, and `eslint.config.js` is unchanged.

This makes the test stricter. It weakens nothing that F-DG3-100 relies on. The config-substring assertion, the per-rule assertions for G1/G2/A1/A2 (`ROUND5_HANDLER_FORMS`) and F1 (`no-unsafe-finally`), the scan probes and the "engine shapes stay allowed" check are all unchanged.

### 2.3 New probe rows

- **The gap:** no probe row used a private name, so no test exercised the `PrivateIdentifier[…]` part of the round-6 name selector.
- **Added:**
  - `class C {\n  #then() {}\n}` (scan hit `then`);
  - `class C {\n  #fromAsync = 0;\n}` (scan hit `fromAsync/asyncIterator`).
- The scan flags both rows, and lint refuses both only through that selector.

### 2.4 Mutation proof (`mutations.sh` → `mutations.log`)

The script runs in a disposable copy at `$TMPDIR/kbe-i-mut`: a tar copy of the worktree, including the uncommitted changes and excluding `.git`. It never touches the tree. It runs `vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts` on Node 24.21.0.

| Run | Change to `eslint.config.js` | Result |
|---|---|---|
| M1 | removed `ForOfStatement[await=true], ` | **exit 1**: 1 failed, 110 passed. `AssertionError: for await (const x of xs) a(x); (await): expected [] to not deeply equal []` |
| M2 | removed `PrivateIdentifier[name=/^(then\|catch\|finally\|fromAsync\|asyncIterator)$/], ` | **exit 1**: 1 failed, 110 passed. The `class C { #then() {} }` row fails. |
| Clean | restored; `diff -q` against the tree reports identical | **exit 0**: 111 passed |

Afterwards the copy was deleted. `git status` shows `eslint.config.js` unmodified in the tree.

## 3. Checks actually run

Unless stated otherwise, these ran in the worktree on Node 24.21.0. Empty `.claude/.cc-writes` directories were removed first. Each log ends with `# exit_status`.

| Command | Environment | Exit | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (before) | Node 24 | 0 (`PASS gate DG2 (historical)`) | `validate-historical-DG2-before.log` |
| `pnpm -r typecheck` | Node 24 | 0 | `typecheck.log` |
| `pnpm -r build` | Node 24 | 0 | `build.log` |
| `pnpm lint` | Node 24 | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | Node 24 | 0 | `prettier.log` |
| `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` | Node 24 | 0 | `eslint-formula.log` |
| `node tools/gates/validate.mjs --historical --stage DG2` (after) | Node 24 | 0 | `validate-historical-DG2.log` |
| `pnpm test` | Node 24.21.0, locale unset | 0: 1654 passed; 259 passed, 2 skipped | `pnpm-test-nodev24-lang-unset.log` |
| `pnpm test` | Node 24.21.0, `LANG=C.UTF-8` | 0: 1654 passed; 259 passed, 2 skipped | `pnpm-test-nodev24-lang-C.UTF-8.log` |
| `pnpm test` | Node 22.22.2, locale unset | 0: 1654 passed; 259 passed, 2 skipped | `pnpm-test-nodev22-lang-unset.log` |
| `pnpm test` | Node 22.22.2, `LANG=C.UTF-8` | 0: 1654 passed; 259 passed, 2 skipped | `pnpm-test-nodev22-lang-C.UTF-8.log` |
| `bash mutations.sh` (M1, M2, clean) | Node 24, disposable copy | script 0; M1 1, M2 1, clean 0 (as expected) | `mutations.log` |

All evidence paths are relative to `docs/delivery/handbacks/DG3/T-DG3-KBE-I-evidence/`.

### Test counts compared with the round-6 baseline

The baseline was 1651 + 256 passed, 2 skipped. Each invocation now has +3 tests:

- 2 new probe rows, scan `it.each` in both the unit-node and the nocodegen projects;
- 1 new exclusion-list test.

The 2 skipped tests are unchanged. They are the `skipIf(NOCODEGEN)` tests in `unit-formula-nocodegen`, including this lintText test, which runs in `unit-node` only.

### Disclosures

- **Expected failures.** `mutations.log` contains `FAIL` and `AssertionError` lines. These are the M1 and M2 runs, which are meant to fail.
- **Copy-step errors.** The first `mutations.sh` run printed `tar: Cannot mknod` errors for the sandbox-mounted dotfiles at the tree root (`.bashrc`, `.mcp.json`, …). They are not needed for the test. The script now discards that stderr, and the cited log is from the second run.
- **Superseded run.** The first run also showed M2 **passing** (exit 0) under the first version of the test. That is how I found the weakness in §2.2. The cited log is the re-run after the fix.
- **Warnings.** `npm warn Unknown project config …` lines appear in the `npx` logs. They are npm warnings about `.npmrc` keys and do not affect any check.
- **Not mine.** An untracked `CLAUDE.local.md` appears in `git status`. It is a sandbox mount and not part of my change.

## 4. Known gaps / not done

- **Integration tests.** `pnpm test:integration` (PostgreSQL) was not run. The assignment doesn't require it, and the change touches only a unit test and documentation.
- **Coverage of other selector parts.** The mutation proof covers the two removals the assignment names. Other partial selector removals may still be masked by overlapping guard selectors on the same rows. For example, `MemberExpression[computed=true][property.value=…]` overlaps with the `Literal[value=…]` selector for `p["then"]`. In that case lint still refuses the form, so there is no behavioural gap.
- **Wording of the probe-table list.** ADR-0024 §6's probe-table list ("the other spellings of L1–L7 above") was left unchanged, as the assignment instructs. It already covers the two private-name rows.

## 5. Merge instructions

- There are no migrations and no changes to the engine, API, web or lint configuration.
- The changes touch three files, plus this handback and its evidence.
- Expect a possible conflict only if another round-7 task also appends to `p3-work-split.md` §9 or edits the `PROBES` table or the lintText test in `fuzz.test.ts`.
