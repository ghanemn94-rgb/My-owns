# Assignment T-DG5-BE-T6: P5 implementation, p5-work-split §J.2 (this is a **repair task**, D-168: the Added scope below is binding and replaces §J.2's file list) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-t6`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three tasks run at the same time: T-DG5-BE-T5B and T-DG5-FE-D5B (continuations of W22) and this one, each in its own worktree. W1–W21 and W22's ARCH-R2, AN-P5A and AN-P5B are merged (D-167, D-168). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §J.2 (this is a **repair task**, D-168: the Added scope below is binding and replaces §J.2's file list). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope (D-168; T-DG5-AN-P5A's real gap; REQ-PB-090, B0146–B0147, M0347): the roaming chains read exactly as the playbook writes them.**
  - **Acceptance:** "A01: the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift'".
  - **Today** the demo chain has six nodes: `… -> Attach rate / activation -> Roaming attach rate -> Roaming revenue uplift`.
    - The outcome KPI carries KBE-H's name "Roaming attach rate" (`packages/db/src/demo/data/kpis.ts:308`).
    - The benefit is titled "Roaming revenue uplift" (`benefits.ts:109`).
    - No test asserts the literal line.
  - **Decided by D-168 (BE-T's own proposal, T-DG5-BE-T handback §6 item 1):**
    - the three chain KPIs are named as B0147 writes them: "Attach rate / activation", "Complaint rate", "Cost/MB, margin";
    - the three chain benefits are titled as B0147 writes them: "Revenue uplift", "CX + care cost", "Margin improvement";
    - `roaming-chains.ts` names the outcome KPI in the contribution (`outcome_kpi_id`), so each chain's line has exactly five nodes;
    - update every dataset text that cites the old names (for example `business-cases.ts`) so nothing contradicts them;
    - keep every value synthetic and the reset deterministic: two resets give identical counts and checksums.
  - **Tests:** an integration test reads the traceability view's own operation (the one the web traceability screen calls) on a seeded demo database. It asserts, for chain 1, the literal line 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift', and the corresponding literal lines of chains 2 and 3 from B0147. Update the demo dataset tests to the new names.
- **Ownership:** `packages/db/src/demo/data/{kpis.ts,benefits.ts,roaming-chains.ts,business-cases.ts}` and any other dataset text naming the old KPI or benefit, the demo dataset tests, and your new test.
- **Concurrent owners:** T-DG5-BE-T5B edits `packages/db/src/demo/data/{roaming-ids.ts,roaming-states.ts}` (the seeded pending approval), `packages/shared`, `apps/api` and `apps/worker`; T-DG5-FE-D5B edits `apps/web/**`. Do not edit their files. If you both touch a demo test file, keep your edits to your own `describe` blocks.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23900–23949 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. The Vitest projects your change reaches pass with the locale unset and with `C.UTF-8`, run one at a time (D-164). Report the counts. The repository-wide `pnpm test` is not yours to run; report it as "not run, D-164".
3. `packages/db/test/integration`, your new test, and `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts. `pnpm test:integration` and the full e2e suite are not yours to run (D-164).
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-T6-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-T6-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
