# Assignment T-DG6-ARCH-15: DG6 round-5 repair: ADR-0053 records the shipped acknowledge/resolve and recurrence rules (F-DG6-341, Low), plus the round-5 ADR sweep (solution-architect)


## What to change (read first)

This task is documentation only. Do not change product code.

1. **F-DG6-341 (Low).** Read the finding verbatim in `docs/delivery/reviews/DG6/round-5/domain-reviewer.findings.json`. ADR-0053 still states a strict If-Match rule for acknowledge and resolve. Amend it to the shipped rule from T-DG6-BE-Z6 (D-213):
   - a version that is behind only by system recurrences is accepted;
   - a conflict between two humans still returns 409;
   - the audit event records the prior, new and base versions.
   Sources: `docs/delivery/handbacks/DG6/T-DG6-BE-Z6-backend-workflow-engineer.md`, and `rebaseOverSystemOccurrences` in `apps/api/src/modules/operations/exceptions.ts`.
2. **Record BE-Z8 in ADR-0053 §2.** The recurrence's `last_occurred_at` is `greatest(now(), <stored column>)`, computed in SQL. It is serialized by the advisory lock and `FOR UPDATE`, so every concurrent failure is captured once (F-DG6-380). Source: `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md`.
3. **Sweep ADR-0051 §2 against T-DG6-BE-Z7B.** Source: `docs/delivery/handbacks/DG6/T-DG6-BE-Z7B-backend-workflow-engineer.md`. Cover:
   - `includesRestrictedRecords` on the Executive Overview and on every report section;
   - totals that are the same for every reader;
   - the drill-down rule.
   Update the ADR where it enumerates these.
4. **Record two contract changes in the ADRs that own the API.** Both are additive and optional: `ExecutiveOverview.includesRestrictedRecords`, and the section-level `includesRestrictedRecords` on `ReportDocument`.

Record every change in each ADR's history. List as a proposed finding any code that contradicts the ADRs.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 5).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/arch-15`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** no other task runs at the same time in their own worktrees. Touch only what your repair needs.
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
- **Your harness ports are 31100–31149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over 2 hours on this host); the orchestrator runs it on the merged tree. Run the integration files your change touches, if any, inside `tests/qa/support/with-pg.sh`, and report their counts.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-ARCH-15-solution-architect.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-ARCH-15-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
