# Assignment T-DG3-KBE-F: repair F-DG3-100 (third pass): an exercised EvalError must fail, and the engine's one outside import must be guarded (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (round 3 reviewed), repair before review round 4.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/kbe-f`.
  - Its `HEAD` is the round-3 candidate `f2b4c77a` (source `ce988e2`) plus the round-3 review records, which are not candidate content.
  - `node_modules` is installed and the packages are built. Work only in this tree.
- **You own:**
  - `eslint.config.js`, the formula-engine blocks only;
  - `packages/shared/src/formula/**`;
  - `packages/shared/src/value.ts`, only if the guard needs it. Its behaviour must not change;
  - `vitest.config.ts`, if needed;
  - `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6;
  - one appended item in `docs/architecture/p3-work-split.md` §9.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 60 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`, and Node 22.22.2 at `/opt/node22/bin`. Run offline.
  - Your harness ports, if you need any, are 23100–23149 only.
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.
  - Never run `git worktree add`.

## The finding and the round-3 verification

**F-DG3-100 (Low, REQ-PB-056)** stays OPEN. The code-security reviewer's round-3 verification FAILED it. Read it in full in `docs/delivery/reviews/DG3/round-3/code-security-reviewer.verifications.json`, with its probes and logs in `docs/delivery/test-evidence/DG3/code-security/round-3/`:
- `probes/guard-layers-probe.mjs` and `guard-layers-probe.log`;
- `probes/exercised-probe.mjs` and `exercised-probe.log` / `exercised-probe-rerun.log`;
- `diff-scan.log`.

**What T-DG3-KBE-E closed, all verified:**
- the 18 round-1 and round-2 forms;
- a mechanically sound run-time layer;
- the CSP claim.

**The two remaining gaps.** Each contradicts an explicit ADR-0024 §6 statement.

1. **The engine swallows the `EvalError`.**
   - `validateFormula` and `evaluateFormula` (`packages/shared/src/formula/index.ts`) catch **any** thrown error and return `formula.syntax` with `params.reason: 'internal'`.
   - `fuzz.test.ts` (`checkOutcome`, the code-shaped-payload test) and `formula.test.ts`'s 'rejects … at offset 0' rows all accept that outcome.
   - So a code-generating path that the tests **do** exercise passes under `--disallow-code-generation-from-strings`. The reviewer's S1 (tokenize-time) was hit 2,805 times by the fuzz's own seeded inputs, and S3 (evaluation-time) 41 times. Every test passed.
2. **`../value.ts` is outside every formula rule.** It is the engine's one allowlisted import from outside `formula/**`.
   - It gets only the generic lint block, and the scan reads only `formula/`.
   - `import { runInThisContext } from "node:vm"` in `value.ts`, called from `checkDecimal`, passes lint, the scan and the run-time layer (V1).

## The repair

1. **An internal failure is never acceptable to the engine's tests.**
   - In `fuzz.test.ts` and `formula.test.ts`, every outcome check must **refuse** an `internal` problem (`params.reason === 'internal'`, or however the engine marks it). That covers `checkOutcome`, the payload test and the offset-0 rejection table.
   - A fuzz or table input that produces an internal failure is then a test failure in both projects, so an exercised `EvalError` always fails.
   - If any existing input legitimately produces an internal failure today, stop and report it. Do not silence it.
   - **Also choose and justify one of these:**
     - (a) the engine rethrows `EvalError` instead of converting it. It cannot occur in production, where nothing generates code;
     - (b) or the no-codegen project fails on any `internal` outcome through a shared assertion helper.

     Keep the engine's production behaviour for genuinely unexpected errors unless you justify a change. Today that behaviour is a 422 `formula.syntax` 'internal', never a 500.
   - Add a regression test, in the no-codegen project, that proves an exercised code-generation path now fails. For example, a test-only engine hook, or a fixture module evaluated through the same catch, that generates code under the flag and must surface as a failure.
2. **Guard the engine's whole import closure.**
   - Apply the engine-source lint block (the allowlist, globals, syntax bans and the core no-eval rules) to `packages/shared/src/value.ts` as well, or to every file in the engine's transitive import closure.
   - Add those files to the scan's file set.
   - **Add a test** that computes the engine's transitive import closure from `formula/index.ts` (static imports) and asserts that every file in it is covered by the engine-source rules and the scan. A future new import then cannot silently escape the guard.
   - If `value.ts` legitimately needs something the engine-source rules refuse, explain it and use the narrowest exception.
3. **The record.** Correct ADR-0024 §6 so that every statement is exactly true. That covers:
   - the layer-3 guarantee, which now includes 'an internal failure fails the tests';
   - the import-closure coverage;
   - the 'not covered by the flag' sentence;
   - the residual (Q1–Q5-style run-time-assembled keys on paths no test exercises).

   Add one item to `docs/architecture/p3-work-split.md` §9, under a new heading for the round-4 repair. The existing items end at 25.

## Proof (real output in the handback)

- Run the reviewer's probes as read-only evidence, in a disposable clone under `$TMPDIR`. Never run them in your tree, and never edit the reviewer's files:
  - `node <copy of guard-layers-probe.mjs> <clone> S1 S3 V1`;
  - `node <copy of exercised-probe.mjs> <clone>`.
- Report, for S1, S2, S3, V1 and V2, which layer now refuses each: lint, scan, run time, or the internal-failure rule.
- **Expected:** every one is refused by at least one layer. Also re-run the 18 earlier forms (`guard-bypass-probe.mjs`) and show that they stay refused.

## Acceptance

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes on Node 24 and Node 22, with the locale unset and with `C.UTF-8`, in both Vitest invocations.
   - Report the counts.
   - The round-3 baseline is 1587 + 190.
3. `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` exits 0.
4. The integration suite on a disposable PostgreSQL passes, because the engine's API callers must keep their behaviour: `QA_PG_PORT=<23100-23149> MTH_PORT_POOL=<the rest> tests/qa/support/with-pg.sh pnpm test:integration`. Report the counts; the round-3 baseline is 793.
5. The per-form table above.
6. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-F-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-F-evidence/`. Leave your changes uncommitted for the orchestrator to integrate.
