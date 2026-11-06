# Assignment T-DG6-BE-Z7B: DG6 round-5 repair: a sensitive benefit through dashboards, the drill-down and report totals (F-DG6-360, F-DG6-361, High; F-DG6-362, F-DG6-340, Medium) (backend-workflow-engineer)


## Continuation (read first)

This is the continuation of T-DG6-BE-Z7. A container restart killed that run at about 00:51 UTC. Its uncommitted work is in your working tree (`git diff`), and its evidence is in `docs/delivery/handbacks/DG6/T-DG6-BE-Z7-evidence/`. That includes `01-sweep-before-fix.log`, the sweep's failing run before the fix.
- Read that diff first and judge it: keep what is right, fix what is not.
- Then finish all four items below.
- Write your handback as `docs/delivery/handbacks/DG6/T-DG6-BE-Z7B-backend-workflow-engineer.md`, with any new logs under `T-DG6-BE-Z7B-evidence/`. Cite the BE-Z7 log you keep.
- The time limit restarts from now.

## What to change (read first)

Read the findings verbatim in `docs/delivery/reviews/DG6/round-5/code-security-reviewer.findings.json` (F-DG6-360, 361, 362) and `docs/delivery/reviews/DG6/round-5/domain-reviewer.findings.json` (F-DG6-340), with the reviewers' probes in `docs/delivery/test-evidence/DG6/code-security/round-5/repro/` and `docs/delivery/test-evidence/DG6/domain/round-5/probes/`.

This is the fourth round in which a read path leaks a sensitive benefit (F-DG6-180, 220, 300/280, now 360/361). BE-Z5's sweep missed these because it accepted any answer. The guard itself is now part of the finding. Fix the routes and make the guard real.

1. **F-DG6-360 (High, mandatory): the Executive Overview.** `GET /api/v1/overview` (`getExecutiveOverview`) lists a sensitive benefit's code, title and validated value to readers who get 404 on the benefit (TL, AUD). Apply ADR-0051 §2 (as amended on 2026-11-04) and the dashboard rule of T-DG6-BE-B2 (`apps/api/src/modules/reporting/dashboards/restricted.ts`): do not list the item; keep the figures the same for every reader; set `includesRestrictedRecords`.
2. **F-DG6-361 (High, mandatory): the `value.gap` drill-down.** `getDashboardDrilldown` (metric `value.gap`) lists the planned lines of a sensitive benefit with its code, title and per-period amounts. Apply the same rule. Then check every other drill-down metric and every dashboard (Finance, adoption, and the rest) the same way, and say per route what you found.
3. **F-DG6-340 (Medium): totals that include a restricted value.** BE-Z5 omits the restricted row from report tables (for example the live `benefits` register and `benefit-totals`), but the total still includes its value and carries no restricted marker. A reader can then work out the hidden value from the difference. Under D-195 Q3 and ADR-0051 §2 "Totals and rollups", the total stays the same for every reader, and the response carries `includesRestrictedRecords: true` for a reader who is not admitted to at least one included record. Implement it on every report, register, snapshot and export that totals benefit values. If a screen needs the label "Includes restricted records" / "يشمل سجلات مقيدة" and does not show it yet, add it in both languages, or list the exact screen for the frontend owner in your handback.
4. **F-DG6-362 (Medium): make the sweep a real guard.** `sensitive-reach-sweep.test.ts` must:
   - fail an operation that answers 4xx/5xx to the admitted reader, unless an explicit, justified per-operation list in the test allows it; fill the required query parameters (31 operations now answer 400, including the overview, the Finance and adoption dashboards and the drill-downs: cover every metric and value class);
   - read every page of a paginated list;
   - keep its positive control (the admitted reader sees the benefit).
   Show that it fails on this tree before your fixes for 1–3 (record that run), and passes after.

The separable second half (D-059/D-070) is item 3, if you run out of time; 1, 2 and 4 come first.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 5).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-z7`, at the integrated `HEAD`.
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
- **Decisions:** D-193 to D-196 and D-212 to D-215 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
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
- **Your harness ports are 31000–31049 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over an hour on this host); the orchestrator runs it on the merged tree. Run every integration file your change touches inside `tests/qa/support/with-pg.sh`, and report the counts. At least: the sensitive-reach and access suites, your sweep test, and the `dashboards`, `overview`, `drilldown`, `reporting`, `report-snapshots`, `traceability` and `exports` files.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-Z7B-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z7B-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
