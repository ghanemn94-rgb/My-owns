# Assignment T-DG5-BE-Y1: DG5 round-3 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 3 on candidate `sha256:fc93b239…` (D-174).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-y1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three repair tasks run at the same time (D-174): T-DG5-BE-Y1, T-DG5-BE-Y2 and T-DG5-FE-Y1, each in its own worktree, at the round-3 candidate's tree plus the round-3 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-123** (Low; REQ-S18-002; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-3/domain-reviewer.json`): The demo's approved and launched portfolio INI-01..03 has no key deliverables: the portfolio screen keeps the T05 warning whose copy says it blocks at G4, and the orphan report now lists all three initiatives (undisclosed side effect of T-DG5-BE-X2).
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/domain/round-3/demo/text/en/d19-portfolio.txt`, `docs/delivery/test-evidence/DG5/domain/round-3/demo/text/ar/d19-portfolio.txt`, `docs/delivery/test-evidence/DG5/domain/round-3/demo/shots/en/d19-portfolio.png`, `docs/delivery/test-evidence/DG5/domain/round-3/demo/shots/ar/d19-portfolio.png`, `docs/delivery/test-evidence/DG5/domain/round-3/demo/text/en/d04-traceability.txt`, `docs/delivery/test-evidence/DG5/domain/round-3/demo/shots/en/d04-traceability.png`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-174** in `docs/delivery/decisions.md`. Read D-174 verbatim (and D-172, D-173 for the wave-X repairs it builds on); the scope below restates it.

## Binding scope

- **Decided (D-174): the demo's launched initiatives carry their key deliverables.**
  - BE-X2 (D-173) launched INI-01..03 (B0147) as the approved G4 portfolio, but seeded no `deliverable` row for them. So:
    - the portfolio screen shows the warning `initiative.deliverable_count` ('Key deliverables: the card should list 3 to 7.') on each, next to an approved G4, while its own introduction says warnings block only at G4;
    - the traceability orphan report grows from 2 to 5 entries, the three new ones being these initiatives ('Downstream link missing', expected step 'Initiative → Deliverable').
  - **Seed 3 to 7 active key deliverables for each of INI-01, INI-02 and INI-03 in `packages/db/src/demo/data/`, as the product records them** (`apps/api/src/modules/portfolio/deliverables.ts`, ADR-0021 §2):
    - each written by a demo role user who holds `initiative.edit` in the transformation, with exactly one audit event per write, like every other seeded record;
    - en and ar labels that fit the initiative's B0147 row (problem, TOM gap, KPI, benefit), marked synthetic like the rest of the dataset;
    - ordinals in order; dates (if the record carries any) consistent with the approved milestones and the synthetic clock;
    - not accepted, unless the demo's own timeline needs an accepted one. Acceptance is a separate business decision, `deliverable.accept`; if you seed one, the accepter is never the submitter.
    - new fixed ids from a new `RT_BLOCK` range. Never reuse an id or block.
  - **Then, on the demo database:**
    - the portfolio and initiative reads carry no `initiative.deliverable_count` warning for INI-01..03;
    - the orphan report lists none of them;
    - G4 stays approved with 8 of 8 criteria complete and no exception;
    - every total the demo shows, the three B0147 chains, the coverage (ADR-0050 §5), G1–G3 history, G5/G6 not submitted, the 12-step walkthrough and the deterministic reset (two resets give identical counts and checksums) are unchanged.
  - **Tests:**
    - the domain reviewer's reproduction as a product test: through the product's own read operations, signed in as a demo role user, assert that each of INI-01..03 has 3 to 7 active deliverables, that no portfolio warning `initiative.deliverable_count` is reported for them, and that the orphan report does not list them. Record its failing output before the seed change. Extend `apps/api/test/integration/environment/demo-gate-history.test.ts` or the demo traceability tests;
    - update every demo pin your rows change (counts, checksums of a pinned value, coverage), and list each change with its reason.
  - **The disclosed teardown budget (D-174, the D-173 precedent; test only).** Under review load the `afterAll` of `packages/db/test/integration/demo.test.ts`, which drops 11 scratch databases (about 4 s each at load 20), took 33.4 s against the integration project's 30 s hook budget. Domain and code-security disclosed it in round 3. Give that hook an explicit budget of at least 2x the loaded measurement (for example 120 s), with a one-line comment citing D-174. Change no assertion and no other hook.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-174 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 4.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `packages/db/src/demo/**`, the demo dataset tests (`packages/db/test/integration/demo*.test.ts`, `apps/api/test/integration/environment/demo-*.test.ts`), and pinned demo values in `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` only where a pin must change (list each one).
- **Concurrent owners:** T-DG5-BE-Y2 edits `apps/api/src/architecture.test.ts` and `apps/api/src/architecture.testkit.ts`; T-DG5-FE-Y1 edits `apps/web/**`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23050–23099 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared with two other tasks. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
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
2. The Vitest unit projects your change reaches pass with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. These pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`:
   - `packages/db/test/integration`;
   - `apps/api/test/integration/environment`;
   - `apps/api/test/integration/portfolio`;
   - `apps/api/test/integration/reporting/table-totals-demo.test.ts`;
   - `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts`.
   Report the counts and the failing-before output of the reproduction.
4. The demo e2e specs pass on a demo stack, once, `--workers=1`: `E2E_PG_PORT=<port> E2E_API_PORT=<port> MTH_PORT_POOL=<rest> e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list`, with `QA_EVIDENCE_DIR` and `E2E_SCREENSHOT_DIR` under your evidence folder. Report the counts.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-Y1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-Y1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R6);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
