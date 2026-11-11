# T-DG6-BE-RG3: seeded product text that names engineering delivery gates (F-DG6-990)

## What to change (read first)

Read F-DG6-990 in `docs/delivery/findings.json`, the round-4 audit sidecar `docs/delivery/reviews/DG6/round-4/release-auditor.findings.json`, its probe `docs/delivery/test-evidence/DG6/audit/round-4/probes/zz-aud-r4-served-dg-labels.test.ts` and its log `docs/delivery/test-evidence/DG6/audit/round-4/11-served-dg-labels.log`. Reuse that probe as your before-fix reproduction.

1. **Reword the seeded texts (F-DG6-990, Low).** No string the product serves or renders may name an engineering delivery gate DG0–DG7 (M0007; REQ-S21-001 acceptance: "a text scan of UI strings and export templates finds no DG0-DG7 references"). Internal decision ids (such as `D-142`) are not product text either.
   - The 24 strings the audit lists: job schedule `kpi.freshness_scan` descriptionEn (0117), the 16 seeded automation starter version `changeSummary` values (0075), and the 6 seeded procedure definition `validationRulesEn` values (0069).
   - Search for every other seeded or served string of the same class (every migration's seed data, job/automation/procedure/template/notification/report seeds, en and ar), not only the 24. List what you found.
   - Do not edit an applied migration. Write a new migration (the next free id, 0130) that rewrites the stored texts in business terms (for example "the KPI freshness rule, unchanged", "the released starter behaviour", "the actual-submission rules apply unchanged"), as their Arabic counterparts already do. Respect each table's version, immutability and audit rules: if a stored version is immutable by design, say how you change what the user reads without breaking that rule, and justify it.
2. **Make the scan cover served seeded text.** Extend the REQ-S21-001 text scan (or add a test next to it) so that it fails on any DG0–DG7 reference in the seeded data the product serves, on a database migrated 0001 to the latest, with finding and task ids (`F-DGx-`, `T-DGx-`) excluded only where they are not user-facing. Show it fails before your migration and passes after.
3. **Tests**, each with a before-fix log (fails) and an after-fix log (passes): the audit probe and the extended scan.
4. **Records.** Update the data dictionary for 0130.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after the clean re-gate release audit round 4).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-rg3`, at the integrated `HEAD`.
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
- **Decisions:** D-193 to D-196 and D-212 to D-238 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
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
- **Your harness ports are 31400–31449 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over an hour on this host); the orchestrator runs it on the merged tree. Run every integration file your change touches inside `tests/qa/support/with-pg.sh`, and report the counts: at least the migration tests and every file that reads the reworded tables.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-RG3-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-RG3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
