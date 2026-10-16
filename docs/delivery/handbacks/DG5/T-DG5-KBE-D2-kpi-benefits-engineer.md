# Handback T-DG5-KBE-D2 (kpi-benefits-engineer): the minutes, executive-dashboard, handover and meeting-pack assemblers, and the export content label table

## Continuation run (T-DG5-KBE-D2B)

- **Interrupted run:** `DG5-T-DG5-KBE-D2-kpi-benefits-engineer-20261016T011110Z-cd89881e` (session `cd89881e-004f-449f-ae1f-7eba1bc86c11`). A container restart stopped it at about 03:01Z on 2026-10-16. Its material is kept for provenance under `docs/delivery/test-evidence/DG5/KBE-D2-orphaned/` in the main repository. Its work is WIP commit `7cbf544` on `dg5/kbe-d2`.
- **This run:** `DG5-T-DG5-KBE-D2B-kpi-benefits-engineer-20261016T030651Z-7d7db98a` (session `7d7db98a-7a83-4054-b257-f0c0e2ae2c65`). Started 03:12:57Z (`date -u`); finished 04:47Z (`date -u` after the last check).

### What I found

I compared the handback with the tree.

- **Files.** Every file in §1 exists and contains what §1 says, and none of them is truncated:
  - the four assemblers each end with their complete `Assembler` export;
  - the registry has the four lines;
  - `exportRunnerDeps()` passes `labels: REPORT_CONTENT_LABELS` in `apps/worker/src/handlers/reports.ts`;
  - the barrel line is in `packages/shared/src/index.ts`;
  - the label table has 863 keys in both `en` and `ar`. I counted them by importing the module: no Arabic value is empty, and every Arabic value contains Arabic script;
  - the test counts match: `kbe-d2.test.ts` 13, `content-labels.test.ts` 5, `kbe-d2-assemblers.test.ts` 6, `export-labels.test.ts` 2.
- **§F.4 and the D-157 (a) scope** were complete in the code. No implementation item was unfinished, so I changed no source file.
- **Placeholders and incomplete records in the handback.**
  - The placeholders for the end time, the C.UTF-8 exit code and the C.UTF-8 unit-web counts were never filled in.
  - The first run's `unit-c-utf8.log` is **truncated**: it stops in the middle of unit-web, with no unit-web or formula counts and no exit line.
  - The first run's full integration run (`integration.log`) never completed (IPC channel closed after 82/260 files).
  - §3 and §7 still described the acceptance checks as open.
- **Environment debris.** Five **empty `.claude/` directories** were in source folders, all created at 02:15Z during the first run: `packages/db/migrations/.claude`, `apps/api/.claude`, `apps/api/src/modules/reporting/reports/.claude`, `apps/api/src/modules/reporting/reports/assemblers/.claude` and `apps/worker/.claude`. They are not tracked by git. My pre-test search looked only for `.cc-writes` directories, so it missed them. The one under `packages/db/migrations` breaks `packages/db/test/integration/migrate.test.ts`, which copies that folder without `recursive` (see row I-1 below). I removed all five with `rmdir`.
- **Read-only placeholder files.** The worktree also has empty, read-only, untracked files at its top level: `.bashrc`, `.bash_profile`, `.profile`, `.zshrc`, `.zprofile`, `.gitconfig`, `.gitmodules`, `.ripgreprc`, `.mcp.json`, `CLAUDE.local.md`, `.idea` and `.vscode`. These are the sandbox's mount placeholders, not my files. I left them alone.

### What I finished

- I filled in every placeholder:
  - the header now carries both runs' times and invocation references;
  - §3 is relabelled as the first run's historical record, and its row 8 and its C.UTF-8 counts now say plainly that the log is truncated with no exit;
  - §7 is rewritten to match the re-run results.
- No code change was needed.

### What I re-ran (all on the final tree; logs under `docs/delivery/handbacks/DG5/T-DG5-KBE-D2-evidence/`, each with a `-B` suffix)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg5-kbe-d2`, 4 CPUs. The other W13 agents were running at the same time (load average 4 to 20 during the runs).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| B-1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4-start-B.log` |
| B-2 | `pnpm -r typecheck` | **0** | every package Done | `typecheck-B.log` |
| B-3 | `pnpm -r build` | **0** | every package Done, including web | `build-B.log` |
| B-4 | `pnpm lint` (`eslint . --max-warnings=0`) | **0** | no output | `lint-B.log` |
| B-5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (at the end, after the handback edits) | **0** | `All matched files use Prettier code style!` (run after the last handback edit) | `prettier-B.log` |
| B-6 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (unchanged) | `openapi-lint-B.log` |
| B-7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **0** | unit-node **129 files, 2117/2117**; unit-web **74 files, 1429/1429**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped (261)**. No failure and no timeout. | `unit-locale-unset-B.log` |
| B-8 | `pnpm test`, `LC_ALL=C.UTF-8` (`LANG` and `LC_CTYPE` unset) | **0** | unit-node **129 files, 2117/2117**; unit-web **74 files, 1429/1429**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped (261)**. No failure and no timeout. | `unit-c-utf8-B.log` |
| I-1 | `QA_PG_PORT=24850 MTH_PORT_POOL=24851-24899 tests/qa/support/with-pg.sh pnpm test:integration` (first attempt) | **1** | **259 of 260 files passed; 2481 passed, 3 failed (2484).** The 3 failures are all in `packages/db/test/integration/migrate.test.ts`: `Error: Recursive option not enabled, cannot copy a directory: …/packages/db/migrations/.claude/`. They were caused by the stray empty directory described above, not by a code defect. Every other suite passed, including `contract.test.ts` (78/78), `kbe-d2-assemblers.test.ts` (6/6) and `export-labels.test.ts` (2/2). | `integration-B.log` |
| I-2 | the same command, after removing the five empty `.claude/` directories | **0** | **260 of 260 files, 2484/2484 tests passed** (30 min 55 s; PostgreSQL on port 24850, first attempt). This includes `migrate.test.ts` 7/7, `contract.test.ts` 78/78 with its pinned counts, `kbe-d2-assemblers.test.ts` 6/6 and `export-labels.test.ts` 2/2. **This is the acceptance-3 result.** | `integration-rerun-B.log` |
| B-9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4-end-B.log` |

- **Pinned counts:** no change. No operation was routed (§4), and `contract.test.ts` passed with its pinned counts unchanged.
- **Flaky tests and timeouts:** the load timeouts of the first run (`pdf.test.ts`, `architecture.test.ts`) did not recur in B-7 or B-8. The whole `architecture.test.ts` file took 30.2 s under C.UTF-8 (139/139 passed). Under heavier load its slowest test can still exceed its 30 s limit (the F-DG4-143 to F-DG4-148 class, seen in the first run). The I-1 failure has the deterministic cause described above.

- **Stage / gate:** P5, DG5 (BUILDING). Task T-DG5-KBE-D2, p5-work-split §F.4, with the D-157 (a) added scope (the export content label table, REQ-S13-009).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-D2-kpi-benefits-engineer-20261016T011110Z-cd89881e","session_id":"cd89881e-004f-449f-ae1f-7eba1bc86c11"}`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-KBE-D2.md`. Its SHA-256 `8fb089e9…7a522` matched before I started.
- **Continuation invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-D2B-kpi-benefits-engineer-20261016T030651Z-7d7db98a","session_id":"7d7db98a-7a83-4054-b257-f0c0e2ae2c65"}`. Assignment `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-KBE-D2B.md`; its SHA-256 `32f8c8ff…17440` matched before I started.
- **Base:** worktree `/home/user/wt/dg5-kbe-d2`, branch `dg5/kbe-d2`. The first run worked on `cca2ba571e2030f7a35a4667961ca5625543cc80`. After the restart the orchestrator committed that work as WIP `7cbf544` (D-158), and that commit is the continuation run's `HEAD`. The continuation run's own changes (this handback and the `-B` logs) are **uncommitted**, for the orchestrator to integrate.
- **Time:** the first run started at 01:14:58Z and was stopped by the container restart at about 03:01Z. The continuation run started at 03:12:57Z and finished at 04:47Z (`date -u` after the last check) (see the continuation section).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** at the start ("PASS gate DG4 (historical)"; `T-DG5-KBE-D2-evidence/validate-historical-DG4-start.log`). The first run re-ran it at its end (§3). The continuation run ran it again at its start and at its end (rows B-1 and B-9).
- **Approvals:** none granted. Product gates G1-G6 are business approvals inside the product. Approving minutes, accepting a handover, the G1 submission and issuing a pack are in-product record steps on SYNTHETIC test data, and they approve nothing real. Nothing here touches DG0-DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/reports/assemblers/meeting-minutes.ts` (new) | The `meeting_minutes` assembler, plus the meeting helpers the pack shares: `loadMeetingFacts`, `meetingFields`, `meetingActions`, `linkedDecisions`, `SourceSet` (one source row per record) and `minutesApprovalState`. |
| `apps/api/src/modules/reporting/reports/assemblers/meeting-pack.ts` (new) | The `meeting_pack` assembler: agenda items, the executive asks with their seven B0102 elements (`askElements`, `missingElementCount`), linked decisions and actions. It is the assembler BE-O's live presentation consumes (ADR-0045 §7). |
| `apps/api/src/modules/reporting/reports/assemblers/handover.ts` (new) | The `handover` assembler: the M0217 content, the M0217 item presence (`handoverItems`), controls, cited evidence, open improvement items and `handoverApprovalState`. |
| `apps/api/src/modules/reporting/reports/assemblers/executive-dashboard.ts` (new) | The `executive_dashboard` assembler over the DG4 Template 10 read model with the period filter. Item values go into one column per value basis and unit kind (`valueColumns`, `itemRow`); Unknown/Stale values carry no number (`itemValueState`, `itemReportValue`). |
| `apps/api/src/modules/reporting/reports/assembler.ts` | Four registry lines and their imports (the KBE-D2 slot). All twelve definitions now have an assembler. |
| `apps/api/src/modules/reporting/reports/assemblers/kbe-d2.test.ts` (new) | Unit tests of the pure rules, with worked fixtures (13 tests). |
| `packages/shared/src/reports/content-labels.ts` (new) | **The export content label table** `REPORT_CONTENT_LABELS`: 863 keys, each in en and ar. |
| `packages/shared/src/reports/content-labels.test.ts` (new) | Checks that every value of 83 closed sets has an en and an ar label, that every Arabic text is in Arabic script, and the honesty rules (5 tests). |
| `packages/shared/src/index.ts` | One barrel line: `export * from "./reports/content-labels.ts";`. |
| `apps/worker/src/handlers/reports.ts` | `exportRunnerDeps()` = `{ store: workerExportStore(), labels: REPORT_CONTENT_LABELS }`. The production `reports.export` handler now passes it to `runExport` (previously `{ store }` only). |
| `apps/api/test/integration/reporting/kbe-d2-fixtures.ts` (new) | Synthetic API-built fixtures. Two meetings: a Transformation Review with attendance, an item, an output, an action and minutes; an Executive SteerCo with a published ask (a T16 decision) and a draft brief. A BAU handover with a control and an evidence item. |
| `apps/api/test/integration/reporting/kbe-d2-assemblers.test.ts` (new) | Integration tests of the four assemblers (6 tests). |
| `apps/api/test/integration/reporting/export-labels.test.ts` (new) | Integration test of the label table: all twelve definitions × every listed format × en and ar, rendered by the real `@mth/reporting` renderers with the production labels, report no `missingLabels` (2 tests). |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-D2-evidence/*` | Check logs (§3). |

No migration (`0083` stays unused: no assembler needed an index), no OpenAPI or Zod contract change, and no new dependency.

## 2. Behaviour delivered, per requirement row

### REQ-S13-004

> A15: each of the ten outputs (charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard, handover) generates from the demo transformation and contains that transformation's ID and records

KBE-C and KBE-C2 delivered six of the ten outputs. This task delivers the remaining three, **meeting minutes, executive dashboard and handover**, plus the meeting pack. `assembledCodes()` now lists all 12 definitions (unit test).

How each output is assembled:

- **Assembly.** Each assembler reads, read only, inside the snapshot's single REPEATABLE READ transaction, the same tables with the same filters and order as the DG4 route the screen reads:
  - `meeting_minutes`: GET meeting, attendance, minutes, agenda-items, outputs and actions;
  - `handover`: GET bau-handovers/{h} (controls, evidence, open improvement items, missing items);
  - `executive_dashboard`: GET …/dashboard?periodId= (the same `resolveFilters`, `loadDashboardContext`, `computeAreas` and `presentAreas` calls);
  - `meeting_pack`: agenda items, linked T16 decisions with active options, and actions.
- **Why direct table reads.** `reporting` may import governance and sustainment only through their `index.ts`, and neither exposes these reads. I may not edit those files (§5).
- **Source rows.** Every record shown is a snapshot source row, exactly once, with its row `version` at the as-of instant. That includes each dashboard item: its version is read from its own table (`outcome`, `outcome_kpi`, `benefit`, `initiative`, `dependency`, `decision`, `adoption_metric_link`). Append-only `meeting_output` rows carry version 1, the `owner_update_revision` precedent.

Integration tests (`kbe-d2-assemblers.test.ts`):

- **Minutes.** The snapshot's transformation and subject are correct. The attendance, agenda, outputs and actions rows equal the DG4 list routes' ids in the routes' order. The minutes body is the authored text. The source rows include the meeting, the minutes (with their version and `approved`), each agenda item, attendance row, output and action.
- **Handover.** The controls, evidence and open improvement items equal GET bau-handovers/{h}'s `controlIds`, `evidenceIds` and `openImprovementItemIds`. The `items` section's missing items equal its `missingItems`. The evidence is cited (`listReportSnapshotEvidence`).
- **Executive dashboard.** Every area's RAG and every area's items (record type and id, in order) equal GET …/dashboard?periodId=.
- **Meeting pack.** The agenda rows equal the agenda route. The ask, decision and action rows are listed below under REQ-S10-013.
- **Wrong subject.** A meeting of another transformation is 422 `report.subject_invalid`.

Literal test items in §F.4:

- **"The executive dashboard needs a period (422 `report.period_required` without one)."** Tested on generate and on live, with the exact ADR-0045 §11 text, and nothing is written. The refusal comes from `snapshots.ts`'s catalogue check. The assembler repeats it as a backstop.
- **"Shows Unknown/Stale values with no number."** A world with three outcome KPIs, built through the API: one accepted, one Stale (data as of 2020-01-01) and one with no actual.
  - The accepted one is `0.12`, `percentage`, basis `actual`, `validated`.
  - The Stale one is `value: null`, `stale`, reason `stale`, although the read model carries the stale figure.
  - The Unknown one is `value: null`, `unknown`.
  - No Unknown or Stale value anywhere in the document has a number, and an Unknown or Stale RAG has no code (`labelKey: null`, never green).
  - Each decimal column holds one unit kind and one value basis, and no table carries a report total (D-117, D-119, D-122).
- **"The meeting pack lists the agenda items with their linked decisions and asks."** See REQ-S10-013 below.
- **"Approval states as ADR-0045 §3 lists them."**
  - Minutes: `pending` while draft, `approved` once approved (published also maps to approved).
  - Handover: `not_submitted` (draft) → `pending` (submitted) → `changes_requested` (returned) → `approved` (accepted). The full path was walked through the DG4 API.
  - Dashboard and pack: `not_applicable`.
  - Unit tests cover every mapping.

### REQ-S13-008 (per assembler, the ADR-0045 §5 rules)

> A10;A15: a pending benefit value is labelled provisional in the PDF pack

My part is the labels in these four assemblers.

- **Executive dashboard.**
  - Headlines use executive-pack's `headlineFields`: submitted and forecast value are provisional, validated value is validated, planned value is n/a.
  - Item values: an accepted KPI actual is validated (rule 4), a Stale one is stale, a missing one is unknown, a benefit's validated value is validated (rule 1), and an initiative's planned value is a plan figure (n/a).
- **Meetings and handover.** These records have no validation state, so their values are `not_applicable` (rule 6). An element an ask does not state yet, a content item not written yet, an unresolved chair and an Unknown cut-off are `unknown` (missing) with no text, never a placeholder.

The PDF labelling itself belongs to BE-N, which is merged. My label table makes the Arabic file's headings Arabic.

### REQ-S10-013 (the meeting-pack assembler; BE-O owns presentation)

> A15: changing a linked decision before cut-off changes the presentation; the issued pack remains the snapshot

- **Content.** The `meeting_pack` contains:
  - the agenda in agenda order, each item with its linked decision (code and title) and status;
  - an `asks` table, one row per executive ask. A published ask is read from its T16 decision: title, why now, active options in ordinal order, recommended option, impact of delay, owner, due date. A draft brief is read from its own fields. Each row has the count of elements not yet stated (the `agenda.ts` `missingOf` rule);
  - the linked decisions;
  - the meeting's actions.
- **Integration test.** After PATCHing the linked T16 decision's title:
  - the **live** `meeting_pack` (GET …/reports/meeting_pack/live) shows the new title;
  - the generated snapshot still shows the old title, and its `contentSha256` is unchanged.

  BE-O's presentation route uses this assembler.

### REQ-S13-009 (D-157 a): the export content label table

> A15;A20: an Arabic PDF renders RTL with readable numbers and identifiers

The assignment's three requirements:

- **"One en/ar table covering every `report.*` key that every assembler emits."** `REPORT_CONTENT_LABELS` in `@mth/shared` has 863 keys.
  - **Where it lives.** p5-work-split §F.11 item 10 says "the API's i18n source the worker receives". The worker imports no API code (ADR-0002; `export-runner.ts`), so the table is in `@mth/shared`, which both import. This follows the `notifications/delivery.ts` precedent. Please confirm the placement (§5).
  - **Coverage.** The keys come from two sources:
    - every key the twelve assemblers emitted in the seeded worlds (477 keys, collected from the renderers' `missingLabels` with an empty table);
    - every value of 83 closed sets, taken from the shared Zod enums and constants (the API mirrors of the CHECK constraints) plus the code-only sets: the formula facts, the business-case measures, the benefit-counting exclusion reasons and the dashboard value columns.
  - **Text sources.** Seeded bilingual catalogue texts are reused verbatim: gate criteria (32), TOM dimensions, diagnostic dimensions and workstreams, Template 10 areas, roles. The 23 dashboard headline keys reuse the web's `dashboards.json` en/ar texts. Charter labels use the web's `define.json` wording (North Star "النجم الشمالي (الغاية العليا)", the four thesis parts, "صلاحيات القرار"). Gates are "البوابة Gn", as the web says.
  - **Honesty.** No label names DG0-DG7 or claims PMI status or a certification (unit test).
- **"Pass it as `ExportRunnerDeps.labels` from the production handler."** `apps/worker/src/handlers/reports.ts` `exportRunnerDeps()`. The integration test asserts `exportRunnerDeps().labels` **is** `REPORT_CONTENT_LABELS`.
- **"Test that no report definition's export reports `missingLabels`, in either language."** `export-labels.test.ts` covers 18 snapshots from three worlds:
  - charter, diagnostic, tom, business_cases and roadmap;
  - all six registers;
  - executive_dashboard and executive_pack, with a period;
  - gate_pack for an unsubmitted G2 and a submitted G1;
  - meeting_minutes, meeting_pack and handover.

  Every format of each definition's catalogue `formats`, in `en` and in `ar`, is rendered by the real `@mth/reporting` `render` with the production labels. The union of `missingLabels` is empty: **PASS**. `content-labels.test.ts` adds the closed-set completeness check for values the seeded worlds do not contain.

## 3. Checks of the first run (historical; superseded by the continuation run's re-runs)

This section records what the interrupted first run did, kept for provenance. **It is not the acceptance evidence.** The acceptance evidence is the continuation run's re-runs on the final tree (the `-B` logs in the continuation section at the top).

Environment: Node 24.21.0, pnpm workspace, offline, worktree `/home/user/wt/dg5-kbe-d2`. Harness ports: `QA_PG_PORT=24850`, `MTH_PORT_POOL=24851-24899`. Empty `.claude/.cc-writes` directories were removed before the tests.

All logs are under `docs/delivery/handbacks/DG5/T-DG5-KBE-D2-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | **0** | PASS gate DG4 (historical) | `validate-historical-DG4-start.log` |
| 2 | `pnpm -r typecheck` | **0** | First run: **2**, one `exactOptionalPropertyTypes` error in my new `export-labels.test.ts`. Fixed, re-run 0. After the last refactor, `apps/api` `tsc -p tsconfig.json --noEmit` also exited 0. | `typecheck.log` |
| 3 | `pnpm -r build` | **0** | All packages, including web. After the last two refactors (no API change), `pnpm --filter @mth/shared --filter @mth/api --filter @mth/worker build` exited 0. | `build.log`, `build-affected-after-refactor.log` |
| 4 | `pnpm lint` | **0** | First run: **1**, an unused variable in my fixtures. Fixed, re-run 0. After the refactor, eslint on every file I changed exited 0. | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | All matched files use Prettier code style. Re-checked at the end on `apps packages docs/delivery/handbacks`: 0. | `prettier.log`, `prettier-final.log` |
| 6 | `pnpm openapi:lint` | **0** | PASS, OpenAPI 3.1.1, 846 operations (unchanged) | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **1** | See below | `unit-locale-unset.log` |
| 8 | `pnpm test`, `LC_ALL=C.UTF-8` | **none recorded** | The log is truncated: the restart stopped it during unit-web. See below. | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=24860 MTH_PORT_POOL=24861-24899 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **Did not complete**: the fork crashed, see below | `integration.log` |
| 10 | Integration, the two KBE-D2 files (after the final code) | **0** | 2 files, **8/8** | `integration-kbe-d2-files.log` |
| 11 | Integration, all of `apps/api/test/integration/reporting/` (after the final code) | **0** | **27 files, 184/184** | `integration-reporting-folder.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **0** | PASS gate DG4 (historical) | `validate-historical-DG4-end.log` |

**Unit tests, locale unset (row 7), exit 1.**

- Counts: unit-node 2112 passed, **5 failed** (2117); unit-web 1429/1429; unit-formula-nocodegen 259 passed, 2 skipped.
- **Two of the five were real violations of mine**:
  - `architecture.test.ts` "every import respects dependsOn, public surfaces and allowed packages" flagged "computed member with a non-literal key" at `handover.ts:85` (`present[i.item]`) and `meeting-minutes.ts:228` (`owners[i]`).
  - `reporting.test.ts` "its declared boundary holds" failed on the same cause.
- I fixed both (a `Map` and `Array.prototype.at`; same behaviour). Re-run alone: `architecture.test.ts` **139/139** (`unit-rerun-architecture.log`), `reporting.test.ts` 4/4 and `kbe-d2.test.ts` 13/13 (`unit-rerun-affected.log`).
- **The other three were timeouts in BE-N's `packages/reporting/src/pdf/pdf.test.ts`**: three Arabic PDF tests at the 5 s default, taking 6-7 s at load average about 20 (the F-DG4-143 to F-DG4-148 class). My changes don't touch that file. Re-run alone: **13/13** (`unit-rerun-pdf.log`).
- In `unit-rerun-affected.log`, a first combined re-run with `architecture.test.ts` timed out again (43 s against its 30 s limit) while my integration run was also loading the machine. The single-worker re-run above passed.

**Unit tests, C.UTF-8 (row 8).**

- Counts: unit-node 2110 passed, **7 failed** (2117). unit-web was still running when the container restart stopped the run, so the log ends mid-run with **no unit-web or unit-formula-nocodegen counts and no exit line**.
- **All 7 are timeouts with no assertion failure**, at load average 24-26 (two integration runs and the other W13 agents were running): 6 in `pdf.test.ts` and `architecture.test.ts` (46 s against 30 s). This run started after the boundary fix.
- Re-run alone under `LC_ALL=C.UTF-8`: **152/152** (`unit-c-utf8-rerun-timeouts.log`).

**Full integration (row 9), exit 1: NOT COMPLETED.**

- 82 of the 260 integration files had passed (1219 tests, **0 failed**). Then the Vitest fork's IPC channel closed (`Error: Channel closed`, `ERR_IPC_CHANNEL_CLOSED`, an unhandled rejection in tinypool), the F-DG4-148 class D-157 (d) records.
- It was running in parallel with the unit run and other agents' runs, to fit the 2-hour limit; a serial full run takes about 70 minutes on this machine today.
- **The full integration suite therefore has no passing result from me.** Rows 10 and 11 cover my files and every reporting suite (the registry, snapshots, owner-updates/executive-pack and exports suites that my registry and worker-handler changes touch), on the final code.
- **Pinned counts:** no change (§4).


## 4. Operations routed (delta to my pending list)

None. §F.4 assigns no operation, and no `p5-pending-kbe-d2.ts` exists, so the pending lists, `p5-operations.ts` and the pinned counts of `contract.test.ts` are unchanged: media-type triple delta **0**, rate-limit floor delta **0**, operation count unchanged. `pnpm openapi:lint`: 846 operations, PASS.

BE-O's `getMeetingPresentation` stays in `p5-pending-be-o.ts`, as BE-O's file. Its live mode can now use `assemblerOf("meeting_pack")`.

## 5. Contract, schema or dependency needs (for the orchestrator)

1. **Label table placement.** `@mth/shared` root, `packages/shared/src/reports/content-labels.ts`, not an `apps/api` i18n file, because the worker may not import API code. If you prefer a subpath export (for example `@mth/shared/report-labels`), that is a `package.json` change for you. The table is dependency-free literal data.
2. **Public read services (optional, a reopen candidate for the owners).** `governance/index.ts` and `sustainment/index.ts` expose no meeting, agenda, minutes or handover read. The assemblers therefore read the same tables with the same filters and order as those routes, and duplicate two small pure rules: `agenda.ts` `missingOf` (count only) and `handovers.ts` `missingItemsOf`. The integration test pins both against the routes (`missingElements` and `missingItems`). If the owners export `missingItemsOf` and an agenda read from their indexes, the assemblers can switch to them.
3. **No new problem code**, no migration (`0083` unused), no new dependency.
4. **Calculation versions.** The dashboard read model does not expose the KPI version per item, so `executive_dashboard` snapshots record no `kpi_version` rows (as for `executive_pack`, KBE-D). The KPI actuals shown are the accepted ones of the period.

## 6. User-facing texts made untrue

I searched the en/ar web strings (`apps/web/src/i18n/{en,ar}/*.json`) and the API for texts that call the minutes, executive dashboard, handover or meeting-pack outputs, or their exports, "planned", "later" or "a later release". I found none. No text was changed.

The export headings were the remaining untrue output. Before this task an Arabic export printed English fallback content headings (BE-M §6, BE-N §5.2). With the label table in the production handler, it prints Arabic ones.

## 7. What remains

1. **Acceptance checks 1 to 4 are done.** The continuation run re-ran every one of them on the final tree, and each passed (rows B-1 to B-9 and I-2 at the top). Items 1 and 2 of the first run's list (the incomplete full integration run and the unit runs with load timeouts) are therefore closed.
2. **For the orchestrator and the owner of `packages/db/test/integration/migrate.test.ts` (not my file):** `copyMigrations` copies `packages/db/migrations/` file by file without `recursive`, so any stray directory there (here an empty `.claude/` left by the sandbox) fails three of its tests (row I-1). It would help to remove such directories before integration runs, or to have the test skip directories.
3. Optional, for the owners: public read services for meetings, agendas and handovers in `governance/index.ts` and `sustainment/index.ts` (§5 item 2).
4. For FE-E: the web generate screens for these four outputs (p5-work-split §F.10 "Completes with"). For BE-O: the presentation's live mode through `assemblerOf("meeting_pack")`.

There is no separable second half: every item of §F.4 and of the D-157 (a) scope is implemented and tested.

