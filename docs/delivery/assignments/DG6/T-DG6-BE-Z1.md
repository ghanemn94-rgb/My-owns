# Assignment T-DG6-BE-Z1: DG6 round-2 repair: sensitive benefit calculation lineage (F-DG6-180, High) and two racy integration tests (F-DG6-200) (backend-workflow-engineer)


## What to change (read first)

Read both findings verbatim in `docs/delivery/reviews/DG6/round-2/code-security-reviewer.findings.json` (F-DG6-180) and `docs/delivery/reviews/DG6/round-2/qa-verifier.findings.json` (F-DG6-200), with their reproductions under `docs/delivery/test-evidence/DG6/code-security/round-2/repro/` and `docs/delivery/test-evidence/DG6/qa/`.

1. **F-DG6-180 (High, mandatory, REQ-S10-002).** `GET /api/v1/benefit-formulas/{formulaId}/versions/{n}/calculations` (`apps/api/src/modules/kpi/calculations.ts`) lists `benefit_calculation` rows (inputs, result) of measurements of sensitive benefits to readers who get 404 on the benefit. Apply the ADR-0051 §2 sensitive-reach clause: a calculation row linked to a measurement of a benefit the caller cannot read is omitted (not 403, no count leak). Add `benefit_calculation` to the sensitive child sources in `apps/api/src/modules/access/sensitive-reach.ts` if that is the established pattern, and sweep every other route that returns `benefit_calculation` (or another child of a sensitive benefit not yet in SENSITIVE_CHILD_SOURCES) and close it the same way. Port the reviewer's reproduction 'P-CALC' into a product integration test that fails before and passes after, plus a positive test that an authorized reader still sees the rows.
2. **F-DG6-200 (Low).** Make the two tests deterministic without weakening their assertions:
   - `apps/api/test/integration/reporting/exports-assembly.test.ts`, the 0125 `export_job_guard` test: wait until the rejected UPDATE's transaction has released the row (or retry the step until claimed, bounded) instead of racing it;
   - `apps/api/test/integration/workflows/change-requests-in-tx*` (see the finding): stop indexing an unordered query (order it, or match by key).
   Show each repeated (e.g. 40 iterations) with 0 misses.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 2).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-z1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** no other task runs at the same time. Touch only what your repair needs.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your scope:** the findings named above. The p6-work-split section that owns each touched file still applies.
- **The shared rules:** `p6-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0051 onward, and the DG1–DG5 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-193 to D-196 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p6-pending-*.ts` list. Exercise it in your `p6-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **Migrations (D-196):** if you need one, take the next id above the highest file in `packages/db/migrations/` on your branch and say so in the handback; the orchestrator renumbers at merge if needed. Never reuse a retired id.
- **e2e budgets are measured** (F-DG5-145/146/151 class): every new spec states a budget from a loaded measurement.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-195).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 28900–28949 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **Tests:** deterministic under load (F-DG4-143 to F-DG4-148); never read whole delivery folders (D-138); never stop processes with `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. The full `pnpm test:integration` is **not** required here (it takes over 2 hours on this host); the orchestrator runs it on the merged tree. Run every integration file your change touches (at least `reporting/exports*`, `workflows/change-requests*`, every `kpi/` and `benefits/` file, the sensitive-reach and access suites) inside `tests/qa/support/with-pg.sh`, and report the counts.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-Z1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z1-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
