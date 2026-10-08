# Assignment T-DG3-KBE-I: repair F-DG3-280: the lintText test must lint every probe-table spelling (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (round 6 reviewed), repair before review round 7.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/kbe-i`.
  - Its `HEAD` is the round-6 candidate `7049d793` (source `c40232b`) plus the round-6 review records.
  - `node_modules` is installed and the packages are built.
- **You own:**
  - `packages/shared/src/formula/fuzz.test.ts`;
  - `eslint.config.js`, only if a probe row reveals a genuine lint gap;
  - `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6, the 'Pinned by tests' sentence only;
  - one appended item in `docs/architecture/p3-work-split.md` §9 (item 29).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first; it must exit 0.
- **Time:** about 30 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`. Offline.
  - Remove empty `.claude/.cc-writes` directories in source folders before tests.
  - Never run `git worktree add`.

## The finding

**F-DG3-280 (Low, REQ-PB-056, raised by code-security in round 6).** Read it in `docs/delivery/reviews/DG3/round-6/code-security-reviewer.findings.json`, with `docs/delivery/test-evidence/DG3/code-security/round-6/`.

**The problem.** ADR-0024 §6 'Pinned by tests' says the `ESLint.lintText` test covers every probe-table spelling. It lints only 48 of the 99 rows. As a result, some partial removals of selectors would fail neither the lint test nor the config assertion. Examples:
- `ForOfStatement[await=true]`;
- the `PrivateIdentifier[…]` part of the round-6 name selector.

F-DG3-100 is CLOSED_VERIFIED; do not weaken anything it relies on.

## The repair

1. **Lint every row.** Make the lintText test lint **every** probe-table row that is a valid module. Filter out only rows that cannot be parsed, such as the two 'unbalanced' rows, and name each excluded row with its reason.
   - Each linted row must be refused by at least one rule.
   - If any row is **not** refused by lint, that is a lint gap. Add the narrowest selector in the formula block, and report it.
2. **Prove it with mutations,** in a disposable copy, never your tree:
   - removing `ForOfStatement[await=true]` from the async selector must now fail a test;
   - removing the `PrivateIdentifier[…]` part of the round-6 name selector must now fail a test.

   Restore the files afterwards.
3. **Make the §6 sentence exactly true.** It must say precisely what the test lints, including the excluded rows and why. Change no other §6 sentence.
4. **`p3-work-split.md` §9:** item 29 under a round-7 heading.

## Acceptance

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts`
2. `pnpm test` passes on Node 24 and Node 22, with the locale unset and with `C.UTF-8`, in both invocations. Report the counts; the round-6 baseline is 1651 + 256 passed, 2 skipped.
3. The two mutation runs fail as stated, and a clean run passes after the restore.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-I-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-I-evidence/`. Leave your changes uncommitted.
