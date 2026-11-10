# Handback T-DG6-BE-B2 (backend-workflow-engineer): sensitivity on the record reads, rollups and export selection

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Task T-DG6-BE-B2, p6-work-split §E/F.3, plus the D-198 navigation items.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-B2.md`, sha256 `4aa2d49f358daf7e23df66f8e9f57cca125b698fdd0c8bdc4965291f0a7d3651` (verified before starting).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-B2-backend-workflow-engineer-20261027T010222Z-579516f4","session_id":"579516f4-8458-4a43-9705-caef0f2ccb49"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-b2`, branch `dg6/be-b2`, base `HEAD` `5e4cbad20917cb4f50517981d15fb87441fedfc5`. Changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` at start `Tue Oct 27 01:02:34 UTC 2026`; at end `Tue Oct 27 02:51:50 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (run before any change, and again at the end: §4).
- **Product gates:** G1–G6 are business approvals inside the product. Nothing here grants, records or simulates one. Marking a record sensitive and granting access are access decisions. All test data is synthetic. Nothing reads or writes the DG0–DG7 records, and product G6 never implies DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/benefits/restricted.ts` (new) | `restrictionOf` (which included records are sensitive and not admitted for this reader; same clause as `ReadScope.admits`), `restrictedField` (the optional `includesRestrictedRecords`, absent when nothing included is sensitive), `markedSensitiveIds`. |
| `apps/api/src/modules/benefits/index.ts` | Exports the helper above (used by `reporting`, which already depends on `benefits`). |
| `apps/api/src/modules/benefits/register.ts` | Benefit **GET** (`readBenefitRow`: `requireSensitiveRead`, covering every benefit sub-resource read that loads its benefit there: values, lifecycle, enablers, allocations, measurements list) and benefit **list** (`readScopeFor(...).predicate` with the named-party columns). |
| `apps/api/src/modules/benefits/totals.ts` | `totalsOf` also returns `sourceIds` (the benefits and the business cases of the investment lines it sums; never in a body). Both totals routes add `includesRestrictedRecords` and drop a restricted benefit from `excluded` (its id and code are never shown). Figures unchanged. |
| `apps/api/src/modules/benefits/financial-metrics.ts` | The business-case read there (`cash-flows`, `financial-metrics` of a case) calls `requireSensitiveRead`; the transformation's financial-metrics list filters cases through the ReadScope. |
| `apps/api/src/modules/kpi/business-cases.ts` | Business-case **GET** (`readCase`: `requireSensitiveRead`; also covers the case's totals and its line reads) and **list** (ReadScope predicate). |
| `apps/api/src/modules/evidence/routes.ts` | Evidence **metadata** list and GET: the register kit keeps create/update/archive (`ops: { list: false, get: false }`); `registerEvidenceMetadataReads` registers the same list and GET (same query, cursor hash, order, archive filter and body) plus the ReadScope predicate (list) and `requireSensitiveRead` (GET). Content, upload and link lines untouched (BE-C, BE-D, BE-E). |
| `apps/api/src/modules/reporting/dashboards/restricted.ts` (new) | `dashboardRestriction` (over the dashboard facts' benefits and investment-line cases) and `withoutRestrictedItems`. An item that is a restricted record or a part of one (benefit, benefit measurement, business case, business-case line) is not listed. |
| `apps/api/src/modules/reporting/dashboards/transformation.ts`, `workstream.ts`, `finance.ts`, `drilldown.ts` | Add `includesRestrictedRecords`; drop restricted items (areas' items; drill-down items, inputs and evidence entries). A drill-down whose `subjectId` is a restricted benefit is refused exactly like a subject outside the scope (422 `dashboard.metric_subject_mismatch`). All figures, statuses and headlines unchanged. |
| `apps/api/src/modules/reporting/exports/jobs.ts` | The ReadScope at export selection: `includesRestrictedSources` checks the snapshot's `report_snapshot_source` rows (benefit, business case, evidence, business-case line → its case, benefit measurement → its benefit) against the requester. 403 `forbidden` at the request, again at commit time inside the write transaction (reloaded grants), and again at download. |
| `apps/api/src/modules/identity/navigation.ts` | D-198: the seven P6 Administration items (`audit`, `security`, `sensitiveGrants`, `operations`, `identity`, `storage`, `notifications`) with the codes and paths from the assignment. A new `P6Screen` type and `DELIVERED_P6_SCREENS` (empty) keep them `availability: "planned"` until FE-B ships each screen (F-DG4-160). |
| `apps/api/src/modules/identity/navigation.test.ts` | §9 table plus the 7 items. Each P6 code alone shows Administration with exactly that item (planned). TO and AUD item lists updated. The P6 items are planned. An item flips to working when its screen is delivered. |
| `apps/api/test/integration/navigation/navigation.test.ts` | TO and AUD Administration item lists updated: TO gains `sensitiveGrants` and `operations`; AUD gains `audit`, `security`, `sensitiveGrants`, `operations` and `identity`. These come from the 0100/0103 role defaults. |
| `apps/api/test/integration/access/sensitive-reads.test.ts` (new) | The REQ-S10-002 / REQ-S10-004 behaviour of this task (15 tests; §3). |
| `apps/api/test/integration/access/sensitive-reads-ab-transcript.test.ts` (new) | The byte-identity regression of every touched read path (A/B transcript, §3). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-B2-evidence/**` | Logs and the two A/B transcripts. |

No migration, no new dependency, no contract or zod-mirror file edited (§6). No `p6-pending-*.ts` / `p6-exercises-*.ts` change: BE-B2 routes no operation (§5).

## 2. Behaviour delivered, per requirement row

### REQ-S10-002 (BE-B2 share)

Acceptance text (quoted): *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*.

- **"A sensitive benefit is hidden from a workstream member without the grant."** A WL assigned to the transformation, with no grant, does not see a benefit marked sensitive:
  - it is absent from `GET /transformations/{t}/benefits`;
  - `GET …/benefits/{id}` is 404 `not_found`;
  - its `values`, `lifecycle`, `enablers`, `allocations` and `measurements` are 404.
  The non-sensitive benefit stays visible. AUD alone is not admitted either (ADR-0051 §2). Owner, creator and Finance validator are admitted as named parties, and the TO through `sensitive_record.grant`.
- **Grant and revocation.** After a TO grant the second member sees the benefit in the list and on GET; the first member still does not. After revocation the second member gets 404 and an absent row again on the next request.
- **Business cases.** The same holds for a sensitive business case:
  - absent from the list;
  - 404 on GET, `/totals`, `/lines` and `/financial-metrics`;
  - absent from `GET …/benefits/financial-metrics`.
  The creator (TL) reads all of them.
- **Evidence (metadata).** A sensitive evidence item is absent from the list and 404 on GET; its owner reads it. Evidence content and evidence of a sensitive parent are BE-C (ADR-0051 §4).
- **Rollups (D-195 Q3).** Totals and dashboards are computed exactly as in DG4 for every reader. In the test the planned margin uplift is 5000000.0000 for the member, BO and TO alike. A response that includes a sensitive benefit or business case carries `includesRestrictedRecords`:
  - `true` when the reader is not admitted to at least one of those records;
  - `false` when admitted to all;
  - absent when none is sensitive.
  The restricted record and its individual value are never listed: dashboard items, drill-down items, inputs and evidence, and the totals' `excluded` entries are dropped. **Unknown stays Unknown.** A sensitive case's cost line without an amount keeps implementation cost and net `unknown` with `benefit.cost_amount_missing` for every reader.

### REQ-S10-004 (BE-B2 share: exports)

Acceptance text (quoted): *"A12: a user without access to transformation Y receives no Y records in search, export, evidence URL or AI retrieval; a user scoped to transformation X exports a portfolio report and receives no Y records, and search returns no Y hits"*.

- **Export selection.** It now applies the requester's ReadScope to the snapshot's source records, on top of the DG5 transformation scoping (unchanged: an export needs `export.create` in the snapshot's transformation; an out-of-scope transformation is 404).
  - A member without admission who exports the benefits register (`registers` / `benefits`, live selection or the owner's snapshot by id) gets **403 `forbidden`**. No export job is written, so no file can contain a row of the sensitive benefit.
  - The owner exports the same report (202).
  - A snapshot with no sensitive source (a RAID register) exports for the member as before.
  - The check is repeated at commit time and at download.
- **Design limit, disclosed.** The worker renders the snapshot's stored content and never re-assembles it (ADR-0046 §2). The assemblers are outside my file ownership. So the export is **refused**, not delivered with the row filtered out (§8 item 1).
- Search (H) and assistant retrieval (D) are other tasks. The evidence URL is BE-C.

### D-198 (navigation)

Each P6 Administration item is in the `administration` area with label `nav.contents.admin.<code>`, which already exists in en/ar. A caller holding only one of the listed codes sees Administration with exactly that item, for each of the 10 codes (unit test). The items are `planned` because FE-B has not yet shipped their screens: the web shows the "not available yet" placeholder (`P6_PLANNED_ROUTES`). FE-B adds each screen to `DELIVERED_P6_SCREENS` in the change that ships it.

## 3. Tests added

- `sensitive-reads.test.ts` (15 tests, integration, disposable PostgreSQL). Before marking:
  - every record is listed;
  - no aggregate carries the field (through the contract-validating client);
  - the member's export is 202.

  After marking:
  - every bullet of §2;
  - the dashboard JSON of the member contains no "Synthetic confidential" title;
  - the drill-down on a restricted subject gives the same status and code as on an unknown subject.

  Calls whose body carries `includesRestrictedRecords` use `contract: false`, because the optional property is not in `openapi.yaml` until the orchestrator merges §6. Every other call goes through the validating client.
- `sensitive-reads-ab-transcript.test.ts` (5 tests). This is the "byte-identical" regression, by the BE-M2 A/B method.
  - **Setup:** a reader of transformation X in which nothing is sensitive, while a benefit of another transformation of the same organization **is** sensitive. The ReadScope therefore runs with a non-empty sensitive set.
  - **Paths read:** every touched path (benefit list, GET and five sub-resources; case list, GET, totals, lines and metrics; transformation metrics; evidence list, GET and 404; benefit totals; transformation and finance dashboards; drill-down with and without a subject; a benefits-register export).
  - **A/B runs:** the transcript was recorded once on this task's source and once on the base source (my `apps/api/src` changes reverted with `git apply -R` of the saved patch and the two new files removed; restored afterwards, sha256-checked).
  - **Result:** `cmp ab-transcript-base.jsonl ab-transcript-new.jsonl` → **exit 0** (24 responses, identical bytes after the shared normalizer). Logs: `ab-base.log`, `ab-new.log`.
  - **Disclosed incident:** my first base attempt used `git checkout`, which failed (the worktree's `.git` index is read-only in this sandbox). Both runs therefore used the new source, so I deleted that transcript. The recorded result comes only from the second attempt with `git apply -R`, which changes the working tree only.
- `navigation.test.ts` (unit, 14 tests): the D-198 items (above).

## 4. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh`, ports 23800–23849 only. Empty `.claude/.cc-writes` directories inside source folders were removed before the tests.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | `PASS gate DG5 (historical)`, exit 0 | (console; re-run at the end below) |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm -r build` | exit 0 | `build.log` |
| `pnpm lint` | exit 0 (`eslint . --max-warnings=0`) | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 ("All matched files use Prettier code style!") | `prettier.log` |
| `pnpm openapi:lint` | exit 0 (`PASS … OpenAPI 3.1.1, 910 operations`; unchanged) | `openapi-lint.log` |
| `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/access/sensitive-reads.test.ts` | exit 0, 15/15 (fourth run; runs 1–3 failed on my own fixtures: a second transformation-level case is 409 by design, and planned values outside the drill-down's "to date" window; fixed in the test) | `sr4.log` |
| A/B transcript (base / new) | exit 0 / exit 0; `cmp` exit 0 | `ab-base.log`, `ab-new.log`, `ab-transcript-*.jsonl` |
| `npx vitest run apps/api/src/modules/identity/navigation.test.ts` | exit 0, 14/14 | (console) |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset), run 1, **while the integration run 1 was running** | **exit 1.** unit-node 155/155 files, 2427/2427 tests; unit-formula-nocodegen 3/3 files, 259 passed + 2 skipped (pre-existing); **unit-web 92/96 files, 1764/1768 tests: 4 failed** (`p2-blank-forms`, `p2`, `portfolio`, `transformations` pages: `Unable to find role=…` / 20 s timeout) | `unit-locale-unset-run1-concurrent.log` |
| The 4 failed web files alone, locale unset (while integration run 2 was running) | **exit 1: 2 failed, 159 passed** (`p2-blank-forms` ar "تسجيل القرار" button, `transformations` ar "تعديل" link; both `findBy…` timeouts; different cases from run 1) | `unit-web-4-files-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8`: `vitest run --project unit-node` then `--project unit-formula-nocodegen` (while integration run 2 was running) | **exit 1.** unit-node 155/155 files, 2427/2427 tests passed, but Vitest reported **1 unhandled error**, `[vitest-worker]: Timeout calling "onTaskUpdate"` (an RPC timeout, not a test), which sets exit 1. formula 3/3 files, 259 passed + 2 skipped. | `unit-cutf8-node-formula.log` |
| `LANG=C.UTF-8` unit-web | **NOT RUN** (time limit) | — |
| `QA_PG_PORT=23820 MTH_PORT_POOL=23821-23849 tests/qa/support/with-pg.sh pnpm test:integration`, run 1 (01:39Z, concurrently with the unit run) | **exit 1: aborted, no summary.** A Vitest worker died, `Error: Channel closed` (`ERR_IPC_CHANNEL_CLOSED`, tinypool); **0 failed tests** among the files completed before the crash. This is the same failure class as BE-B's attempt 1. | `integration-run1-aborted.log` |
| The same, run 2 (started 01:59Z, alone at first) | **NOT FINISHED within the time limit.** Snapshot at 02:51Z: **166 files passed, 0 failed, 0 failed tests**. These include `contract/contract.test.ts` 101/101, `access/sensitivity.test.ts` 22/22, `access/read-scope-parity.test.ts` 2/2 (`pairs=990 … mismatches=0`; the HTTP GETs for non-sensitive pairs now run through my changed routes), `access/sensitive-reads.test.ts` 15/15, `kpi/business-cases.test.ts` 17/17, `reporting/exports.test.ts` 16/16 and `evidence/evidence-register.test.ts` 9/9. The integration project runs one fork sequentially (BE-B measured 2883 s for 324 files); this host is shared and slower now. The run may still be writing `integration.log` when this handback is read; the orchestrator should read its final summary there, or re-run. | `integration-snapshot-at-limit.log`, `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` (end) | `PASS gate DG5 (historical)`, exit 0 | `validate-dg5-historical-end.log` |

**Acceptance status, plainly:**
- Acceptance 1 (typecheck, build, lint, prettier, openapi:lint): **met**, all exit 0.
- Acceptance 4 (the validator): **met**.
- Acceptance 2 (`pnpm test` in both locales): **not met as runs.** Every unit-node and formula test passed in both locales. However, the locale-unset unit-web project had load-timing failures, the C.UTF-8 node run exited 1 on a Vitest RPC timeout, and the C.UTF-8 unit-web project did not run.
  - The web failures are in `apps/web` page tests. This task changed no `apps/web` or `packages` file, and the web suite does not import `apps/api`.
  - I could not prove them pre-existing on the base commit within the time limit.
  - They need a clean re-run on an unloaded host.
- Acceptance 3 (integration): run 2 completed with 1 failure, my own navigation expectation. It is fixed and that file passes alone; see the addendum below. A full clean re-run is still to be done. Pinned counts are unchanged; no `contract.test.ts` pin moves.

**Addendum (after the handback, 03:08Z): integration run 2 finished.**
- **Result:** `exit 1`. Test Files 1 failed | 327 passed (328); Tests 1 failed | 3179 passed | 1 skipped | 1 todo (3182); Duration 4256 s (`integration.log`).
- **The one failure was mine:** `navigation/navigation.test.ts` "an ADM test user holding every role default sees the 14 areas…". Its `CONTENTS` table did not list the seven D-198 Administration items. I updated that table in the same file.
- **Re-run of that file alone:** exit 0, 8/8 (`integration-navigation-rerun.log`). Prettier and eslint on the file are clean.
- **Not done:** I did not re-run the whole integration suite after this fix (time limit). Every other file passed in run 2. Pinned counts are unchanged.

## 5. Operations routed (pending-list delta)

None. §E/F.3 assigns BE-B2 no operation ("Operations: none new"), and there is no `p6-pending-be-b2.ts`. Pinned counts in `contract.test.ts`: no change (910 operations, media types, rate-limit floor and CSRF-exempt routes untouched).

## 6. For the orchestrator: contract, schema, dependency

**Contract additions requested** (D-196 item 4: additive, optional; no other change). Add to each schema below `includesRestrictedRecords: { type: boolean, description: "Present when the response includes a sensitive benefit or business case: true when the reader is not admitted to at least one of them (ADR-0051 §2; label access.includesRestrictedRecords)" }` (not required), and the same `z.boolean().optional()` to the zod mirror:

| Operation | Schema (`openapi.yaml`) | Zod mirror |
|---|---|---|
| `getBenefitTotals`, `getPortfolioBenefitTotals` | `BenefitTotals` | `packages/shared/src/schemas/benefit-values.ts` `benefitTotals` |
| `getTransformationDashboard` | `TransformationDashboard` | `packages/shared/src/schemas/dashboards.ts` |
| `getWorkstreamDashboard` | `WorkstreamDashboard` | same file |
| `getFinanceDashboard` | `FinanceDashboard` | same file |
| `getDashboardDrilldown` | `DashboardDrilldown` (its response schema) | same file |

Until that merge:
- my test calls that receive the field skip the contract assertion (`contract: false`, commented);
- BE-F's response-validation sweep would report these operations only for a response that includes a sensitive record;
- a strict web parse of those bodies would reject them while a record is sensitive. FE-B consumes the field and shows `access.includesRestrictedRecords`.

**Problem code proposal (shared rule 17).** The export refusal uses the standard 403 `forbidden`. If the orchestrator wants a dedicated code, I propose `export.includes_restricted_records`, 403, "This report includes records you cannot see, so it cannot be exported for you." (Arabic for the owner of `problems.json`, provisional.)

**Migration and dependency.** No migration (the highest file on the branch is `0107`). No dependency.

**Inventory: aggregate responses that include a benefit or business-case value** (§E/F.3 "the BE-B2 inventory").

| Operation | File | Status |
|---|---|---|
| `getBenefitTotals`, `getPortfolioBenefitTotals` | `benefits/totals.ts` | **done** (field, `excluded` filtered) |
| `getTransformationDashboard`, `getWorkstreamDashboard`, `getFinanceDashboard`, `getDashboardDrilldown` | `reporting/dashboards/*` | **done** (field, items filtered, restricted subject refused) |
| `getBusinessCaseTotals`, `getBusinessCaseFinancialMetrics`, the transformation financial-metrics list | `kpi/business-cases.ts`, `benefits/financial-metrics.ts` | **done** as record reads (404 / absent), no field needed |
| `getAdoptionDashboard` | `reporting/dashboards/adoption.ts` | no benefit or case value (adoption indicators only): no change |
| `getExecutiveOverview` (`GET /overview`) | `reporting/executive-overview.ts` | **not done, outside my files.** It builds the same T10 areas from `loadDashboardContext` (value area items list benefits) and needs the same two lines: `dashboardRestriction` + `withoutRestrictedItems` + the field. Schema `ExecutiveOverview`. |
| `getWorkspaceHeader` (`GET /transformations/{t}/summary`) | `reporting/workspace-header.ts` | **not done, outside my files.** Planned and validated value headlines from the same facts; needs the field only (no items). Schema of the header. |
| Report snapshot reads (`reports/routes.ts`), and the assemblers in `reports/assemblers/*` (registers, business_cases, executive_pack, executive_dashboard, gate_pack) | `reporting/reports/**` | **not done, outside my files.** A snapshot's stored content is shown to every reader of the transformation. Exports are guarded (403); a filtered rendition per requester needs the assemblers or the snapshot service to take the requester's ReadScope (§8 item 1). |
| `getTraceability`, `/records/{type}/{id}/impact`, missing links, My Work | `reporting/traceability.ts`, `impact.ts`, `modular.ts`, `my-work.ts`, `transformations/missing-links-facts.ts` | **not done, outside my files.** They list benefit titles or codes (no aggregate value); they are record lists for the route-inventory sweep (BE-C2) and their owners. |

## 7. User-facing texts

- No en/ar text called sensitive records or the restricted-records label "planned". `access.includesRestrictedRecords` (en/ar, FE-A) now has a server field to show.
- The seven navigation items are served as `planned`, which matches the web's "not available yet" placeholders. No text became untrue. FE-B must add each screen to `DELIVERED_P6_SCREENS` (`identity/navigation.ts`) when it ships it, in the same change.

## 8. What remains (stated plainly)

1. **Export with the row filtered out.** The REQ-S10-002/004 acceptance is met by refusal. A user without admission gets 403 and never receives a file containing the sensitive benefit; an admitted user's export of the same register works. Delivering a file *without* that row needs `reporting/reports/assembler.ts` (`AssemblyContext` with a `ReadScope`), the assemblers (`registers.ts` `benefitRows` and the business-case and evidence sections) or `snapshots.ts`, none of which is mine. The same change would close the snapshot read path (§6 inventory). A reviewer who reads "exports … and receives no row" as "receives a file" will find the refusal instead.
2. **Aggregates outside my files:** `getExecutiveOverview` and `getWorkspaceHeader` (§6 inventory), two lines each with the helpers delivered here.
3. **Other benefit lists in `benefits/**` that name benefits but are not "benefit GET and lists".** These are not changed:
   - the Finance validation queue (`finance-validation.ts` `GET …/finance-validations` and its item; the item carries the measurement's value);
   - overlaps (`overlaps.ts`, benefit pairs with codes and titles);
   - groups (`groups.ts`, member ids);
   - scenarios (`scenarios.ts`).

   The Finance validator named on the benefit is admitted anyway; another FIN user of the transformation is not filtered there yet. Each needs the ReadScope predicate joined on `benefit`. This is BE-B2's natural **separable second half** (D-059/D-070), if the orchestrator wants it in this slice.
4. **Writes to a sensitive record.** Writes by a non-admitted user who holds the write permission are not refused (for example PATCH of a sensitive benefit by another BO, which returns the record body). This is outside "read and list lines". Proposal: `requireSensitiveRead` after the row lock in `updateBenefit`/`updateCase`/the register kit's update, or a route-inventory finding for BE-C2.
5. **BE-B's parity test still checks the sensitive pairs in process.** Its sensitive record-view leg still calls `requireTransformationRead` + `requireSensitiveRead` in process, not the HTTP GET. BE-B's handback asks BE-B2 to switch it. The file is BE-B's test (`read-scope-parity.test.ts`), not in my ownership. The HTTP GETs now call exactly that pair (and `sensitive-reads.test.ts` proves the HTTP 404 and visibility). The switch is a test-only change for the orchestrator to assign.

6. **Checks to finish** (§4):
   - read the final summary of integration run 2 in `integration.log`, or re-run it;
   - run `pnpm test` on an unloaded host with the locale unset and with `C.UTF-8`, including unit-web, which has not run under `C.UTF-8`.

## 9. Merge instructions

- Uncommitted on `dg6/be-b2`.
- **Conflicts to expect:**
  - `evidence/routes.ts`: my lines are the metadata list and GET plus the `registerRegister(...)` call; BE-C then edits the content read lines, BE-D the upload lines.
  - `reporting/exports/jobs.ts`: one helper block plus three call lines.
  - `identity/navigation.ts`: FE-B adds screens to `DELIVERED_P6_SCREENS`.
- No migration. Contract and mirror additions per §6.
- Unrelated untracked files in the worktree root (`.bashrc`, `.vscode`, `CLAUDE.local.md`, …) are environment artifacts, not part of this task.
