# Handback T-DG6-BE-Z7B (backend-workflow-engineer): DG6 round-5 repair, a sensitive benefit in dashboards, the drill-down and report totals

- **Stage:** DG6, FIXING after review round 5. **Task:** T-DG6-BE-Z7B, the continuation of T-DG6-BE-Z7 (stopped by a container restart at about 00:51 UTC).
- **Invocation:** `DG6-T-DG6-BE-Z7B-backend-workflow-engineer-20261106T010213Z-60c2f6f3`, session `60c2f6f3-42b7-4c12-9d3e-b2ffe456561d`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z7B.md`, sha256 `5144ce1b…0d729`, checked before starting.
- **Base:** branch `dg6/be-z7` at `HEAD 5fa96009f9e9a9fc1df007b8ef723d1ffa8a85fa`. All changes are **uncommitted**, as instructed.
- **Time:** started `Fri Nov 6 01:06:40 UTC 2026`, ended `Fri Nov 6 01:47 UTC 2026`.
- **Findings:** F-DG6-360 and F-DG6-361 (High, mandatory), F-DG6-362 and F-DG6-340 (Medium). All four items are done; none is deferred.
- **Approvals:** I am an engineering agent. Nothing here grants a business, Finance or IT approval (G1–G6), and nothing implies DG7. All test data is SYNTHETIC: demo seed or fixtures.

## 0. Preceding gate and the BE-Z7 work I inherited

- `node tools/gates/validate.mjs --historical --stage DG5` exited 0 at the start and at the end: `PASS gate DG5 (historical)` (evidence `00-validate-dg5-historical.log` and `40-validate-dg5-historical-end.log`).

I read and judged BE-Z7's uncommitted diff.

**Kept:**
- The overview restriction.
- The rewrite of `hides()`: every line of the facts, keyed by `recordTable:recordId`, which takes in `benefit_plan_value`.
- `withoutRestrictedRefs`, which falls back to the shared SENSITIVE_CHILD_SOURCES rule instead of `default: false`.
- The drill-down filter on items, inputs and evidence.
- The schema and OpenAPI member on `ExecutiveOverview`.
- The rewritten sweep: query-parameter filling, every drill-down metric and value class, `limit` set to the maximum, every page followed, and the admitted-reader 4xx/5xx guard with a justified allow-list that cannot go stale.

**Fixed or added:**
- `includesRestrictedRecords` now cannot say "nothing restricted" (absent or false) after the shared rule removed an entry.
- The adoption dashboard now uses the same filter.
- Admin control readers are leak-checked.
- Item 3 (report totals) is new, and so is the label on the screens.

**Earlier log:** I keep BE-Z7's `docs/delivery/handbacks/DG6/T-DG6-BE-Z7-evidence/01-sweep-before-fix.log`. It is the sweep's failing run at an intermediate stage of the test. It shows the same six overview and value.gap leaks. It also shows that the new admitted-reader guard bites: 37 operations refused to the admitted readers, which became justified entries or correct fills in the final test. My own before/after runs use the final tests (§3).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/executive-overview.ts` | F-DG6-360: `dashboardRestriction` and `withoutRestrictedItems` on the overview's areas. Same figures for every reader; the response carries `includesRestrictedRecords`. |
| `apps/api/src/modules/reporting/dashboards/restricted.ts` | F-DG6-361: `hides()` knows every value line of the facts (`benefit_plan_value` as well as `benefit_measurement`). `withoutRestrictedRefs` applies the shared SENSITIVE_CHILD_SOURCES rule to anything else. New `restrictedFieldAfter()`: the field is `true` whenever an entry was removed. |
| `apps/api/src/modules/reporting/dashboards/drilldown.ts` | F-DG6-361: items, inputs and evidence (also checked as the evidence item) of **every** metric go through `withoutRestrictedRefs`; `restrictedFieldAfter`. |
| `apps/api/src/modules/reporting/dashboards/transformation.ts`, `workstream.ts` | Use the async shared filter, and `restrictedFieldAfter`. |
| `apps/api/src/modules/reporting/dashboards/adoption.ts` | F-DG6-361 "every dashboard": the adoption area's items go through the same filter. The response is unchanged today, because its items are adoption KPIs. |
| `apps/api/src/modules/access/sensitive-reach.ts`, `access/index.ts` | New `recordRefSensitivity()`: which refs disclose a marked-sensitive record at all, and which are restricted for the reader. One policy decision. |
| `apps/api/src/modules/reporting/reports/restricted.ts` | F-DG6-340: `documentForReader` sets the per-section read-time member `includesRestrictedRecords`. |
| `packages/shared/src/schemas/report.ts` | Optional `includesRestrictedRecords` on every report section (zod mirror). |
| `packages/shared/src/schemas/dashboards.ts` | Optional `includesRestrictedRecords` on `executiveOverview`. |
| `docs/api/openapi.yaml` | `ExecutiveOverview.includesRestrictedRecords`; a description of the read-time section member on `ReportDocument.sections`, whose items are open `type: object`. |
| `apps/web/src/pages/executive-overview/ExecutiveOverviewPage.tsx` | Renders `RestrictedRecordsLabel` from the overview response. |
| `apps/web/src/pages/reports/ui.tsx` | `SectionView` renders `RestrictedRecordsLabel` from the section member. This covers the live report, the snapshot and the presentation pages, which all use `ReportDocumentView`. |
| `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` | F-DG6-362: the real guard (§2, item 4). |
| `apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts` (new) | Negative and positive tests for items 1–3. |
| `apps/web/src/pages/reports/restricted-labels.test.tsx` (new) | The label on report sections and on the overview, in en and ar. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z7B-evidence/*` | Logs. |

- **Migrations:** none.
- **Dependencies:** none added.

## 2. Behaviour delivered

**REQ-S10-002.** The acceptance text is: *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*. The rule applied is ADR-0051 §2 as amended on 2026-11-04, with "Totals and rollups" and D-195 Q3.

"Not admitted" below means TL at the transformation, AUD at the transformation or at the organization, and the admin roles: no grant and not a named party.

### Item 1: F-DG6-360, the Executive Overview

`GET /api/v1/overview`, both with and without `transformationId`:
- **Reader not admitted:**
  - no item of the benefit is listed;
  - the headlines, statuses and transformation rows equal the TO's byte for byte, compared without `items` and `generatedAt`;
  - `includesRestrictedRecords: true`.
- **TO (admitted):** sees the benefit; `includesRestrictedRecords: false`.

### Item 2: F-DG6-361, drill-downs and dashboards, per route

**`getDashboardDrilldown`, `value.gap`:** the planned and validated lines of a restricted benefit are no longer listed. `hides()` now resolves `benefit_plan_value`, and anything unresolved goes to the shared rule.

**Every other metric:** the test enumerates every `DASHBOARD_METRICS` entry, plus every `FINANCE_VALUE_CLASSES` value for the value-state metrics, plus both gap classes, each with and without `currency=SAR`. I skipped `outcomes.kpi_status`: it is a KPI subject metric and the sweep covers it with a KPI subject.

| Readers | What the test asserts |
|---|---|
| TL and AUD (not admitted) | No item, input or evidence entry names the benefit or its lines. `value` and `calculation.expression` equal the TO's. `includesRestrictedRecords: true` wherever the TO saw the benefit. |
| All readers, refused combinations | A combination the contract refuses gets the same status for every reader. |

**Findings on the other metrics:** only `value.gap` leaked at HEAD. The value-state metrics emit `benefit` items, which were already hidden. Investment, outcomes, risks, decisions, adoption and finance-pending emit no benefit-line items, or items that were already hidden.

**The dashboards:**

| Route | Finding at HEAD | Change |
|---|---|---|
| Executive Overview | Leaked (item 1) | Fixed |
| Drill-down | Leaked (`value.gap`) | Fixed |
| `getFinanceDashboard` | No leak: it lists no items and already carried `includesRestrictedRecords` (BE-B2) | Verified: same figures and the flag set |
| `getAdoptionDashboard` | No leak | Filter added as a guard; same figures |
| `getTransformationDashboard` | No leak (BE-B2) | Moved to the shared async filter |
| `getWorkstreamDashboard` | No leak (BE-B2) | Moved to the shared async filter |

- **Workstream coverage:** the demo dataset has no workstream, so the sweep cannot fill `getWorkstreamDashboard`. The new test creates a synthetic workstream over every initiative and checks it: TO sees the benefit; TL and AUD do not, get the same figures, and get the flag `true`.

### Item 3: F-DG6-340, totals that include a restricted value

`documentForReader` applies to the live report of every definition and to every snapshot response: GET, plus the generate, issue, discard and reissue bodies. A section (table, list, fields, metrics or text) that references a marked-sensitive record through a row, an item or a source carries `includesRestrictedRecords`:
- `true` when the reader is not admitted to at least one of them. Its rows are omitted; its totals and metrics are unchanged.
- `false` when the reader is admitted to all of them.

**Byte-for-byte guarantees:**
- A document with no sensitive reference is returned as the same object, so DG5 responses are unchanged.
- The member is read-time only: the assemblers never set it. Stored content and `contentSha256` are unchanged, and the test re-hashes the stored row.

**Tests:**
- The live benefits register, and a snapshot generated by the TO: TL and AUD get no row, the same totals and the flag `true` on the section. The TO gets the row and `false`.
- A register with no sensitive records (`kpis`) carries no member.
- `benefit-totals` keeps its BE-B2 behaviour.

**Coverage of the item's scope:**
- **Exports:** a snapshot or assembly with restricted sources is still refused to a reader who is not admitted (403 `export.includes_restricted_records`, D-199). An admitted reader's export contains every row, so no hidden value exists there.
- **Other routes that total benefit values:** I found none outside `benefits/**` and `reporting/**` (portfolio budgets are not benefit values).

**Screens:** the label "Includes restricted records" / "يشمل سجلات مقيدة" (existing key `access.includesRestrictedRecords`, existing component) is now rendered:
- on every report section with the member: live report, snapshot and presentation;
- on the Executive Overview.

The new web test covers both, in en and ar.

### Item 4: F-DG6-362, the sweep is a real guard

**Query parameters:** required parameters are filled from the contract: ids, enums enumerated, dates and the like. The drill-down gets every metric with every value class it accepts, with and without a currency and a subject, plus `transformationId` variants.

**Pagination:** `limit` is set to the contract maximum, and every page is read through `nextCursor`, for every reader and every control. 2,428 pages were read.

**Readers:** TL, AUD at the transformation, and AUD at the organization are leak-checked. In the final version the admin control readers are leak-checked too.

**Admitted-reader guard:**
- A request id that answers 4xx/5xx to every admitted or control reader fails the test, unless `ADMITTED_ERROR_ALLOWED` justifies it. The control readers are tried in this order: admitted TL, TO, then ADM_TECH/ADM_ACCESS/ADM_METHOD and AUD(org), for admin-only and audit reads.
- There are 7 justified entries: `startOidcLogin` (no IdP), `getWorkItem` (assignee only), the two evidence content routes and `getBrandingLogo`/`getBrandingVersion`/`getBrandingVersionContrast` (no stored bytes, branding version or logo in the demo).
- The facts behind those justifications are asserted against the database.
- An allowed id that answers 2xx fails the test as stale.

**Floor:** it counts operations that an admitted reader actually **read** (2xx): 364, above the floor of 330. Before, it counted resolved ids.

**Positive control:** kept, and extended to `getExecutiveOverview` and to the drill-down of the benefit's class.

**Red before, green after:**
- With the source reverted to HEAD, the sweep fails and names the overview and value.gap leaks for TL, AUD and AUD(org): 9 leak lines.
- With the fixes, it passes (§3).

## 3. Checks run (Node 24.21.0, offline; integration on disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`, ports 31000–31049)

| Command | Result | Evidence |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | exit 0, `PASS gate DG5 (historical)` | `00-…`, `40-…` |
| Sweep and new test, **source reverted to HEAD**, final tests | **exit 1**: 6 failed, 4 passed (10). Sweep: 9 leak lines (overview, value.gap). New file: overview, both drill-down tests, live and snapshot register totals fail. | `01-before-fix-sweep-and-z7b.log`, `01-before-fix-tree.txt` |
| The same two files on the final tree | **exit 0**: 10/10. `555 requests per reader over 371 operations (520 ids); 75 operations not fillable`, `2428 pages read`, `364 operations read (2xx)` | `02-after-fix-sweep-and-z7b.log` |
| `vitest --project integration` over `access/` (all 12 files), `reporting/` (all files: dashboards, drilldown, registers-report, report-snapshots, report-synthetic, traceability, exports*, finance-drilldown-k1, scope and the rest), `access-scope.test.ts` and `contract/contract.test.ts` | exit 1: 48 of 49 files passed; tests 428 passed, 8 skipped. The one failed **suite** is the new `sensitive-reach-dashboards-reports.test.ts`. The batch loaded it while I was editing it: a synthetic workstream code `WS-Z7B` violated `workstream_code_check`, so its `beforeAll` failed. I fixed the code (`WS-77`), and that file passes 8/8 on the final tree. | `30-integration-touched.log`, `02-…` |
| `pnpm -r typecheck` | exit 0 | `10-typecheck.log` |
| `pnpm -r build` | exit 0 | `14-build.log` |
| `pnpm lint` | exit 0 | `11-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `13-prettier.log` |
| `pnpm openapi:lint` | exit 0, `OpenAPI 3.1.1, 932 operations` | `12-openapi-lint.log` |
| `pnpm test`, locale unset | exit 0. unit-node 190 files / 2899 tests; unit-web 122 / 2062 (includes the new `restricted-labels.test.tsx`, 8 tests); unit-formula-nocodegen 3 / 259 passed, 2 skipped | `20-pnpm-test-locale-unset.log` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | exit 0, the same counts | `21-pnpm-test-C.UTF-8.log` |

**Disclosures:**
- **Source unchanged after the batch:** product source did not change after the 49-file batch started. After it, I changed only the two integration test files (the workstream code fix and the admin-control leak check), and both pass in `02-…`. The batch's other 47 files ran on the final source.
- **Not run:** the full `pnpm test:integration` (not required) and e2e.

## 4. Operations routed

None. No new operation was added, so my `p6-pending-*` list has no delta, and `contract.test.ts` passes.

## 5. Contract, schema and dependency needs (for the orchestrator)

These are additive optional members, already written to the zod mirrors and `openapi.yaml`. Please record them as contract changes:
1. `ExecutiveOverview.includesRestrictedRecords` (boolean, optional).
2. The read-time `includesRestrictedRecords` (boolean, optional) on every `ReportDocument` section. This closes BE-Z5's "contract need" (its handback §6).

In OpenAPI the section items are open `type: object`, so the member is documented in the `sections` description. If you want typed section schemas there, that is a separate contract task.

No dependency need.

## 6. User-facing texts

- No existing string became untrue.
- The labels use the existing `access.includesRestrictedRecords` (en "Includes restricted records", ar "يشمل سجلات مقيدة", Arabic provisional per ADR-0051). Both are now rendered on the Executive Overview and on report sections, live and snapshot.
- Screen owner (FE): `ExecutiveOverviewPage.tsx` and `reports/ui.tsx` `SectionView` each gained one `RestrictedRecordsLabel` line. Please review the placement, which is under the section title.

## 7. What remains

1. **Operations the sweep cannot fill: 75** (BE-Z5 had 71), listed by name in the log.
   - Three of the new ones (`getInitiativeSchedule`, `getMeetingMinutes`, `getMeetingCutoffPack`) are now resolved only through a row that has the sub-resource. The demo has no such row, so they moved from "answered 404" to "not fillable", which is the honest state.
   - `getWorkstreamDashboard` is not swept, but the new test covers it.
   - Seeding those sub-resources would bring them back into the sweep.
2. **Search index:** `searchRecords` still runs without the worker's indexer (BE-Z5 residual 2).
3. **Flag-only adoption filter:** if the adoption filter ever removes an item, there is no response member to label it. The schema has none, and no item can be restricted today.
4. **Placeholder in totals:** a fully omitted table shows the empty-table text and not its totals on screen. That is unchanged from DG5; the label is still shown on the section.
