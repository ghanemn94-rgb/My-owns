# Handback T-DG6-BE-R: server-side filters and sorts on register lists (backend-workflow-engineer)

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §H/G.5.
- **Invocation:** `DG6-T-DG6-BE-R-backend-workflow-engineer-20261030T042053Z-a829d2c1` (session `a829d2c1-b1c6-49bf-9bb7-a52885ec76e2`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-R.md`, sha256 `c2723d561663e2f5977639d5d1b792c0937901989648ab25b6e2c9b2f95366d6` (verified).
- **Base:** branch `dg6/be-r`, `HEAD` `ff1e975a346cf41dcfd5a86ec7514c06c3ba1fae`; the tree was clean at the start. Changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-30T04:21:12Z`, end `2026-10-30T06:23:30Z` (`date -u`; about 2 h 3 min, at the hard limit).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited 0 (`PASS gate DG5 (historical)`; `T-DG6-BE-R-evidence/validate-historical-DG5.start.log`). It was re-run at the end: exit 0, `PASS gate DG5 (historical)` (`validate-historical-DG5.end.log`).
- **Approvals:** no business, Finance or IT approval is granted or implied. Product gates G1–G6 are untouched, and nothing here reads or writes DG0–DG7 records. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/initiatives.ts` | Only the `listInitiatives` lines: the optional `q` (code or name, case-insensitive substring, 1–200), `executiveOwnerUserId`, `workstreamLeadUserId` and `sort` (8 values, ADR-0057 §5). The keyset `(sort value, id)`, nulls last ascending and first descending. `name` sorts on `lower(name)` (the `initiative_name_sort_idx` expression). Each filter and the sort are in `filterHash`. A malformed keyset in a hand-made cursor gives 400, not a database error. With `sort` absent, the DG5 code path runs unchanged. |
| `apps/api/src/modules/transformations/routes.ts` | Only the `listTransformations` lines: `sort` also accepts `-updatedAt`, `updatedAt`, `code` and `-code`. The DG1 values (`updatedAt:desc` …) are kept, and so is the default `updatedAt:desc`, so an absent `sort` keeps the DG1 hash, order and cursor. A malformed keyset (time or uuid) in a cursor is now 400 instead of a cast error. |
| `apps/api/src/modules/transformations/register-kit.ts` | `RegisterSpec.searchColumns` and `RegisterSpec.sortColumns` (+ `RegisterSortColumn`, `registerSortColumns` with the `status`/`createdAt`/`updatedAt` tail). The per-spec list query adds `q` and `sort` only when the spec declares them; otherwise the DG2 strict schema still refuses them as `validation.unknown_field`. The list route adds the `q` filter and the keyset sort. With both absent, the DG2 code path, hash and cursor are unchanged. |
| `apps/api/src/modules/transformations/registers.ts` | The two new spec fields in the 9 specs (declared columns only; see §2). |
| `apps/api/test/integration/portfolio/initiatives-filters.test.ts` | New. The 1,000-initiative test (21 tests). |
| `apps/api/test/integration/transformations/register-filters.test.ts` | New. The 9 register-kit lists and `listTransformations` (13 tests). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-R-backend-workflow-engineer.md`, `T-DG6-BE-R-evidence/**` | This handback and its logs. |

No migration, contract, schema, permission, i18n, dependency or shared-package change.

## 2. Behaviour delivered

### REQ-S15-013, acceptance (quoted): "Tables use server-side pagination and filtering through the API and persist column choices in saved views"

**A-test (quoted):** "A20: on a register with 1,000 initiatives, sorting, filtering, paging and hiding a column all work, and the API returns paginated results".

This task delivers the API part of the row: server-side sorting, filtering and pagination for the 11 list operations of ADR-0057 §5.
- Column choices in saved views belong to BE-Q (merged).
- The table, chips, column hiding and the A20 e2e belong to FE-D.
- QA-D runs A20.

The row is **not complete** until those parts land; BE-R's part is complete.

- **`listInitiatives`.** The new parameters are `q`, `executiveOwnerUserId`, `workstreamLeadUserId` and `sort` ∈ {`-updatedAt`, `updatedAt`, `code`, `-code`, `name`, `-name`, `plannedEnd`, `-plannedEnd`}.
  - On 1,000 initiatives in one transformation, every sort key in both directions pages through all 1,000 rows (10 pages of 100), with no duplicate and no gap. The order equals the database's `ORDER BY <expr> <dir> NULLS LAST|FIRST, id <dir>`.
  - For `plannedEnd`, the 200 null rows come last ascending and first descending.
  - `q` and the owner filters return exactly the matching set, alone and combined, including the literal `%`, `_` and `\`.
  - A cursor issued for another filter, another sort, or the DG5 (sort-absent) path is 400 at `/query/cursor` (`validation.cursor`).
  - An unknown `sort` is 400 at `/query/sort`.
  - `q` that is empty or longer than 200 characters is 400 at `/query/q`. A malformed owner id is 400 at its pointer.
- **The 9 register-kit lists** (`listStrategicGuardrails`, `listOutcomes`, `listDiagnosticItems`, `listDiagnosticFindings`, `listWorkstreamOutputs`, `listTomGaps`, `listCapabilityHeatmapEntries`, `listJourneies`, `listJourneyPainPoints`): `q` and `sort`.
  - The sort keys equal exactly the saved-view registry's `SAVED_VIEW_LISTS[listKey].sorts` (BE-Q), and a test asserts the equality.
  - `searchColumns` are `text` columns only, also asserted. Each list's declared columns:

| List | `searchColumns` | own sort keys (+ `status`, `createdAt`, `updatedAt`) |
|---|---|---|
| strategic guardrails | title, category, statement | title, category |
| outcomes | statement, description | statement, topRank (integer) |
| diagnostic items | dimension_code, current_state, root_cause, impact_text | dimensionCode |
| diagnostic findings | workstream_code, statement, detail | workstreamCode, kind |
| workstream outputs | workstream_code, title, note | workstreamCode, title |
| TOM gaps | dimension_code, current_state, target_state, gap | dimensionCode |
| capability heatmap | name, description, dimension_code | name, dimensionCode (nullable) |
| journeys | name, description | name, kind |
| journey pain points | description | stepKey (`uuid`, nullable; sorted as uuid) |

  Each key in both directions pages through every row in the database order, with nulls last ascending and first descending (checked on capability dimension, pain-point step and outcome rank). `includeArchived=true` works together with a sort.
- **`listTransformations`:** `sort` ∈ {`-updatedAt`, `updatedAt`, `code`, `-code`}. Each one orders like its DG1 twin and pages all rows. The cursor is bound to the spelling sent. `name`/`-name` are 400 at `/query/sort`; the DG1 `name:asc` stays.
- **Absent parameters (§H/G.14 item 7):** the response is byte-identical to the pre-P6 response, by golden comparison on every page.
  - `listInitiatives` at limits 25 and 100, with the DG5 status filter.
  - The 9 kit lists at limit 2.
  - `listTransformations` at limit 2.
  - The golden re-states the DG1/DG2/DG5 query, keyset predicate, presenter and cursor/hash in the test, and compares `res.raw.body` byte for byte.
- **Authorization:** unchanged. The read gate runs before any filter. AUD reads with `q` and `sort` (200) on all 11 operations. A caller without `transformation.read` gets 404 with or without the new parameters.
  - The kit registers that declare neither field (dependencies, actions, TOM workshops) still refuse `q`/`sort` with 400 `validation.unknown_field`, as at DG2.
  - No mutation was added or changed, so no audit, If-Match or commit-time check applies.
- **Query plan:** `EXPLAIN` of the `sort=code` page query on 1,000 initiatives shows `Index Scan using initiative_code_sort_idx` (logged in the integration log; not timed). The statement EXPLAINed is the route's SQL, re-stated in the test.

### REQ-S15-010 (the "filter chips" part, BE-R's share in §H/G.13)

Acceptance (quoted): "Search returns only records the user may read; lists support saved views and chips; bulk and inline edits go through the same validation, authorization and concurrency checks as single edits; unsaved drafts are recoverable".

BE-R supplies the server parameters that chips and saved views set. A view or chip grants nothing, because each list applies its own read rules first (tested). The chips themselves are FE-D's.

## 3. Checks (real exit codes; logs in `docs/delivery/handbacks/DG6/T-DG6-BE-R-evidence/`)

Environment: Node 24.21.0 offline. PostgreSQL 16.15 (`/usr/lib/postgresql/16`) through `tests/qa/support/with-pg.sh`, ports 25500 (+ pool 25501–25549). The host was shared with other P6 runs: load average 16–20 on 4 CPUs throughout, so every run was slow.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5.start.log` |
| 2 | `pnpm -r typecheck` (run 1) | **2** | `apps/api`: one TS2322 in my new test file `register-filters.test.ts` (the `Case.spec` union type; types only). Fixed by typing it `unknown`. | `pnpm_-r_typecheck.log` |
| 3 | `pnpm -r typecheck` (run 2, after the fix) | **0** | all 8 projects Done | `pnpm_-r_typecheck.run2.log` |
| 4 | `pnpm -r build` | **0** | | `pnpm_-r_build.log` |
| 5 | `pnpm lint` | **0** | | `pnpm_lint.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | run after the run-2 fix (the fix line is prettier-clean) | `prettier-check.log` |
| 7 | `pnpm openapi:lint` | **0** | | `pnpm_openapi_lint.log` |
| 8 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset) | **1** | unit-node **2722/2722** (176 files); unit-web **1786 passed, 1 failed** (1787; 97/98 files); unit-formula-nocodegen **259 passed, 2 skipped** (261). The failure is `traceability.test.tsx` "Portfolios and workstreams (en) > workstreams list WS-nn codes; assigning an initiative twice shows the translated refusal" (6759 ms, `Unable to find role="button" and name "Assign initiative"`). See the note below. | `pnpm-test.locale-unset.log` |
| 8a | `env -u LANG -u LC_ALL -u LC_CTYPE npx vitest run --project unit-web apps/web/src/pages/traceability/traceability.test.tsx` (the failing file alone) | **0** | **32/32** passed | `unit-web-rerun-portfolios.log` |
| 9 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** (finished at 06:43Z, after the handback was first written) | unit-node **2719 passed, 3 failed** (2722); unit-web **1786 passed, 1 failed** (1787); formula **259 passed, 2 skipped**. All 4 failures are timeouts: `architecture.test.ts` (30 s), `server.test.ts` route registration, `branding-layout.test.ts` PDF and `ExecutionPanel.test.tsx` (5 s each). None of these files is touched by this task. Not re-run alone. | `pnpm-test.C.UTF-8.log` |
| 10 | `QA_PG_PORT=25500 MTH_PORT_POOL=25501-25549 tests/qa/support/with-pg.sh pnpm test:integration` | **none: killed** at the 2 h background limit (07:33Z) mid-run; no final count | Partial log only: 1,227 passing test lines and 7 failures before the kill. `register-filters.test.ts` **13/13** ran and passed; `initiatives-filters.test.ts` had not run yet. Three failures are timeouts: form export at 60 s, and two `contract.test.ts` sweeps at 30 s. Four are assertion failures in areas this task does not touch: the worker event registry (`kpi.deviation_evaluated`/`connector.run_failed` queues), the 0116 catalogue triggers, the KPI freshness scan, and `p5-exercises-be-j.ts`. I did not check whether those four also fail on the base `ff1e975`. **Acceptance item 3 is not met by this run.** | `integration.log` (partial) |
| 11 | focused: `with-pg.sh npx vitest run --project integration apps/api/test/integration/portfolio/initiatives-filters.test.ts` | run 1 **1**, run 2 **0** | run 1: 3 failed / 16 passed, which found the DG5 paging defect of §5.1, a non-owner `ANALYZE` (no statistics) and a golden that ignored the DG5 cursor. Run 2: **21/21** passed (including the `it.fails` reproduction). | `focused-initiatives-filters.run1-failed.log`, `focused-initiatives-filters.run2.log` |
| 12 | focused: `with-pg.sh npx vitest run --project integration apps/api/test/integration/transformations/register-filters.test.ts` | run 1 **1** (setup), run 2 **1**, run 3 **0** | Run 1: a fixture body (a workstream output needs a target). Run 2: 6 failed, which found that `journey_pain_point.step_key` is `uuid` (an `ilike` on it was a 500, now a sort-only `uuid` column) and that `z.never()` changed the DG2 refusal code of the non-declaring registers (now the strict schema again). Run 3: **13/13** passed. | `focused-register-filters.run2-failed.log`, `focused-register-filters.run3.log` |
| 13 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5.end.log` |

After the focused runs, two changes were types only, with no runtime effect: the explicit `z.ZodType<RegisterListQuery>` return type in `register-kit.ts`, and `Case.spec: unknown` in the test. The focused tests were not re-run after them. #3 typechecks them, and the full integration run (#10) would re-run them.

**The unit-web failure (#8)** is in a file this task does not touch (no `apps/web` change). The same file passes alone (#8a). Its 6.8 s `findByRole` wait under a load average of ~17 matches the F-DG4-143…148 load class. It is disclosed, not hidden; I did not change it, and it is for the orchestrator's merged-tree run.

**Background chain still running at handback.** #9 and #10 run in one background chain (`… pnpm test (C.UTF-8) …; with-pg.sh pnpm test:integration …`). It appends its exit lines to `T-DG6-BE-R-evidence/test-exits.txt`. Update: the chain then finished #9 (06:43Z) and was killed during #10 (07:33Z); rows #9–#10 record what it wrote. Apart from that, any line or log written there after `2026-10-30T06:23:30Z` (`date -u`; about 2 h 3 min, at the hard limit) was **not seen or verified by me**, and this handback does not claim it.

**Pinned counts:** none changed by this task. No `contract.test.ts`, catalogue or seed pin was edited, and no operation or media type was added.

## 4. Operations routed (pending-list delta)

**None.** §H/G.0: "BE-R adds parameters to routed operations, so it has no pending list." No `p6-pending-*` file changed, and the operation count is unchanged.

The 11 operations' new parameters are exercised through the validating `call` (each response is checked against its contract) in the two new test files, as §H/G.0 directs. `contract.test.ts` is unchanged.

**Pinned-count deltas:** none (operations, media types, rate-limit floor, CSRF-exempt routes and JSON-body pin all unchanged).

## 5. For the orchestrator: contract, schema, dependency and raised items

1. **Raised defect, DG3/DG5 behaviour, kept unchanged here: `listInitiatives` with `sort` absent skips rows across pages.**
   - **Cause.** The DG5 cursor stores `updated_at` as `Date#toISOString()` (millisecond precision; `pg` parses `timestamptz` to a JS `Date`). The column holds microseconds. So on the next page `updated_at < V_ms OR (updated_at = V_ms AND id < …)` drops the rows that tie with the page's last row (same `updated_at`, for example one transaction) or that share its millisecond.
   - **Reproduction.** On the 1,000-row fixture (300 distinct µs timestamps), the sort-absent walk returns fewer than 1,000 distinct rows, and the owner filter walked sort-absent returned 327 of 333 rows. See `focused-initiatives-filters.run1-failed.log`. The test `it.fails("DG5 defect, raised: with sort absent, paging returns every one of the 1,000 rows once")` documents it.
   - **Why it is not fixed here.** §H/G.14 item 7 and ADR-0057 §5 bind this task to "byte-identical" absent-parameter responses, and changing approved behaviour goes to the user/orchestrator first (D-195 reopen rule).
   - **Proposed fix (one place).** Have the sort-absent path use the microsecond keyset that `sort=-updatedAt` already uses: `to_char(... 'US')` key, `(updated_at, id) < (v::timestamptz, id)`. Then remove the `it.fails` mark and update the golden test's cursor to the µs form. Only `nextCursor` bytes and the pages after a tie change; page 1 items stay identical.
   - **Proposed severity.** Medium to High (rows silently missing from a paged register; A20 "paging … work"). The severity is for a reviewer to set; I don't set it myself.
   - **Workaround in this task.** Every `sort` value, including `-updatedAt` (today's order), pages correctly.
2. **Contract defect: `listTransformations` declares `sort` twice** (`docs/api/openapi.yaml`, the `/api/v1/transformations` GET: the DG1 enum `updatedAt:desc…` with its default, and the P6 enum `-updatedAt, updatedAt, code, -code`).
   - Two parameters with the same `name` + `in` are invalid in OpenAPI 3.x, although `pnpm openapi:lint` passes.
   - The server accepts the union, with the DG1 default kept.
   - **Proposed contract fix (orchestrator; openapi.yaml is frozen to me):** one `sort` parameter with `enum: ["updatedAt:desc", "updatedAt:asc", "name:asc", "name:desc", "code:asc", "code:desc", "-updatedAt", "updatedAt", "code", "-code"]`, `default: "updatedAt:desc"`, and the description "Absent: today's order (updatedAt:desc). The ADR-0057 §5 values -updatedAt, updatedAt, code, -code order as updatedAt:desc, updatedAt:asc, code:asc, code:desc; a cursor is bound to the spelling sent."
   - The zod mirror `packages/shared/src/schemas/transformation.ts` `transformationListQuery.sort` could then carry the union. I extended it locally in `routes.ts` instead, because the shared schema is not in my ownership.
3. **Contract text.** The `listInitiatives` 200 description says "Page (`updatedAt` desc, `id` desc)." This stays true only for `sort` absent. Suggested wording: "Page; `sort` absent: `updatedAt` desc, `id` desc (today's order); otherwise the keyset `(sort value, id)` of ADR-0057 §5." The other kit-list 200 descriptions already say "(the register kit's order; `sort` absent)".
4. **Contract text.** `RegisterQuery` says "over the list's declared text columns". The pain-point list's `step_key` is a `uuid`, so it is a sort key only, not a `q` column.
5. **No migration** (the `0110` indexes are used as shipped). **No new dependency, permission, problem code or i18n key.**

## 6. User-facing texts made untrue

None found. I searched the en catalogues `apps/web/src/i18n/en/*.json` for texts that call server-side sort or filter "planned", "later" or "not yet", or describe table sorting as limited to the loaded page: no match. The contract-text items are §5.3 and §5.4.

## 7. What remains

- REQ-S15-013 and REQ-S15-010 need FE-D (table, chips, column hiding through saved views, the 1,000-initiative e2e with a measured budget) and QA-D (A20) before they are complete. DO-F's workload uses these parameters.
- **Acceptance item 3 (full integration) has no result:** the run was killed at the 2 h limit (#10). Its partial log shows 7 failures outside this task's files (3 timeouts, 4 assertions in worker, catalogue and freshness areas; not checked on the base). The orchestrator's merged-tree run must supply the count. The two new integration files passed alone (#11, #12).
- **Acceptance item 2 also fails with `C.UTF-8`:** 4 timeouts outside this task's files (#9).
- **Acceptance item 2 is not met as run:** `pnpm test` with the locale unset exited 1 on one unit-web test outside this task's files, which passes alone (#8, #8a).
- The decision and fix for §5.1, and the contract fix for §5.2–§5.3 (orchestrator).
- No e2e spec was added by this task, so there is no e2e budget to state.

## 8. Merge instructions

- No migration and no ordering constraint beyond §H/G.12 (after BE-Q, before FE-D).
- **Expected conflicts:** none in shared seam files. Other tasks touching the same four source files (for example BE-V's pagination work) would conflict only if they edit the same list-route lines. `register-kit.ts`: the `listQuery` block, the `RegisterSpecBase` tail and the `ops.list` route. `initiatives.ts`: the `listQuery` block and the `app.get(BASE…)` handler.
