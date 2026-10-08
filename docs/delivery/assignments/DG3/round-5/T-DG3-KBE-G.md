# Assignment T-DG3-KBE-G: repair F-DG3-100 (fourth pass): enforce the EvalError-rethrow rule statically, and correct ADR-0024 §6 (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (round 4 reviewed), repair before review round 5.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/kbe-g`.
  - Its `HEAD` is the round-4 candidate `8376d762` (source `171a0b5`) plus the round-4 review records, which are not candidate content.
  - `node_modules` is installed and the packages are built. Work only in this tree.
- **You own:**
  - `eslint.config.js`, the formula-engine blocks only;
  - `packages/shared/src/formula/**`;
  - `packages/shared/src/value.ts`, only if a new rule needs a mechanical change. Its behaviour must not change;
  - `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6;
  - one appended item in `docs/architecture/p3-work-split.md` §9.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`, and Node 22.22.2 at `/opt/node22/bin`. Run offline.
  - Ports, if needed: 23100–23149.
  - Remove empty `.claude/.cc-writes` directories in source folders before tests.
  - Never run `git worktree add`.

## The finding and the round-4 verification

**F-DG3-100 (Low, REQ-PB-056)** stays OPEN. Read the round-4 verification in full: `docs/delivery/reviews/DG3/round-4/code-security-reviewer.verifications.json`, with `docs/delivery/test-evidence/DG3/code-security/round-4/` (`probes/swallow-probe.mjs`, `adr-claims.log`, `closure-parser-probe.log`).

**What your T-DG3-KBE-F repair closed (verified):**
- S1–S3;
- V1 and V2;
- the 18 earlier forms;
- wrapped and unhandled `EvalError`s;
- the API's generic 500;
- unchanged formula results.

**Why it stays open.** ADR-0024 §6 states that every catch in the closure rethrows `EvalError`, but **nothing enforces that for a new handler**. An exercised code generation that handles its own refusal passes lint, the scan and the no-codegen run:
- W1: `try { … } catch { }`;
- W2: `try { … } finally { return; }`;
- W4: `Promise.resolve().then(…).catch(() => undefined)`.

**The reviewer's closure criterion (a)** is to enforce the rethrow rule statically in the closure, in lint and mirrored in the scan.

## The repair

1. **Lint.** Applies to every file in the engine's import closure: the formula sources and `value.ts`.
   - Every `CatchClause` must **bind its parameter** and have, as its **first statement**, `if (<param> instanceof EvalError) throw <param>;`.
     - Write a `no-restricted-syntax` selector, or a tiny local rule if a selector cannot express it, that refuses any other catch shape.
     - That includes an optional-binding `catch { }`.
     - The existing catches already have this shape, except `parse.ts`, which rethrows everything that is not its own `ParseFailure`. Either give `parse.ts` the same first statement, which is a mechanical change with no behaviour change, or justify an equivalent rule.
   - `no-unsafe-finally`: error.
   - Refuse `Promise`, `async` functions, `await`, and `.then`, `.catch` and `.finally` member calls in engine sources. The engine is synchronous; verify that first.
2. **Scan.** Mirror the rules in `fuzz.test.ts`'s `scanSource()`: a catch without the first-statement rethrow, a `finally` with a `return`/`throw`/`break`/`continue`, and `Promise`/`async`/`await`/`.then(`/`.catch(`/`.finally(`. Add the reviewer's W1, W2 and W4 forms to the probe table.
3. **Closure parser.** Make `engineImportClosure()` also follow string-named specifiers, `export { "x" as y } from "…"` (the reviewer's X1), or state in the ADR exactly what it follows, ESLint being the backstop.
4. **ADR-0024 §6.** Correct the three statements the reviewer named:
   - the number of catch clauses: five, including `parse.ts`;
   - the web behaviour on an `EvalError`. The web defines no error boundary; React Router's default error element would show. State it accurately and note that it is unreachable in practice;
   - what the closure parser follows.

   State that the rethrow rule is now enforced by lint and the scan. Keep the stated residuals (Q1–Q5-style run-time keys on unexercised paths) exactly true. Re-read every statement in §6 against the code, one by one.
5. **`p3-work-split.md` §9:** append item 27 under a round-5 heading.

## Proof (real output in the handback)

- In a disposable clone under `$TMPDIR` (never your tree; never edit the reviewer's files), run `node <copy of swallow-probe.mjs> <clone> W1 W2 W4 W5`. Report which layer refuses each form: lint, scan or run time.
  - **Expected:** W1, W2 and W4 are refused by lint and the scan, and W5 still at run time.
- Re-run the round-3 `guard-layers-probe.mjs` (S1 S2 S3 V1 V2) and the round-2 `guard-bypass-probe.mjs` (18 forms). Show that all stay refused.

## Acceptance

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts`
2. `pnpm test` passes on Node 24 and Node 22, with the locale unset and with `C.UTF-8`, in both invocations. Report the counts; the round-4 baseline is 1593 + 199 passed, 1 skipped.
3. The integration suite passes: `QA_PG_PORT=<23100-23149> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`. The baseline is 793.
4. The per-form tables above.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-G-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-G-evidence/`. Leave your changes uncommitted for the orchestrator to integrate.
