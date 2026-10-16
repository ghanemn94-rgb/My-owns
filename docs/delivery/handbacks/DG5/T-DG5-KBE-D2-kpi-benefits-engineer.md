# Handback T-DG5-KBE-D2 (kpi-benefits-engineer): the minutes, executive-dashboard, handover and meeting-pack assemblers, and the export content label table

- **Stage / gate:** P5, DG5 (BUILDING). Task T-DG5-KBE-D2, p5-work-split §F.4, with the D-157 (a) added scope (the export content label table, REQ-S13-009).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-D2-kpi-benefits-engineer-20261016T011110Z-cd89881e","session_id":"cd89881e-004f-449f-ae1f-7eba1bc86c11"}`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-KBE-D2.md`. Its SHA-256 `8fb089e9…7a522` matched before I started.
- **Base:** worktree `/home/user/wt/dg5-kbe-d2`, branch `dg5/kbe-d2`, `HEAD` = `cca2ba571e2030f7a35a4667961ca5625543cc80`. All changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started 01:14:58Z; finished __END__ (see §3).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** at the start ("PASS gate DG4 (historical)"; `T-DG5-KBE-D2-evidence/validate-historical-DG4-start.log`). It was re-run at the end (§3).
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

## 3. Checks actually run

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
| 8 | `pnpm test`, `LC_ALL=C.UTF-8` | __CUTF8EXIT__ | See below | `unit-c-utf8.log` |
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

- Counts: unit-node 2110 passed, **7 failed** (2117); __CUTF8WEB__.
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

1. **Full integration suite (acceptance 3): not completed.** A serial `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` on the integrated tree is still needed. My run crashed on an IPC channel close after 82/260 files with 0 failures (§3, row 9). The reporting folder and my files pass on the final code (rows 10-11).
2. **Unit runs (acceptance 2)** show only load timeouts in BE-N's `pdf.test.ts` and in `architecture.test.ts`, and each re-run alone passes in both locales. A full `pnpm test` with both locales, on a quieter machine at merge, is still needed.
3. Optional, for the owners: public read services for meetings, agendas and handovers in `governance/index.ts` and `sustainment/index.ts` (§5 item 2).
4. For FE-E: the web generate screens for these four outputs (p5-work-split §F.10 "Completes with"). For BE-O: the presentation's live mode through `assemblerOf("meeting_pack")`.

There is no separable second half: every item of §F.4 and of the D-157 (a) scope is implemented and tested.

