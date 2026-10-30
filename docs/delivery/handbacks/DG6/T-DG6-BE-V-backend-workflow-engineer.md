# Handback T-DG6-BE-V (backend-workflow-engineer): cursor pagination for the 17 unbounded lists

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Scope: `docs/architecture/p6-work-split.md` §D.5; ADR-0007 §4 and §4a (D-199); the contract extension was approved by D-200 item 2 under D-196 item 4.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-V.md`, sha256 `47dd93ae8916b619b0d49b9beeec63fad11b5b131fd765ed241d4c79fea6dc66` (verified before starting).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-V-backend-workflow-engineer-20261030T174021Z-c30542d3","session_id":"c30542d3-d2e5-442f-bb0c-5c8aea7b8620"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-v`, branch `dg6/be-v`, base `HEAD` `22b7693b1439f933a191c9ee20747685ea69ae65`. The changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` at start `Fri Oct 30 17:40:50 UTC 2026`; at end `Fri Oct 30 19:37:16 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (run at the start, before any change; run again at the end, §4).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. The tests create synthetic weight-set proposals and formula versions in disposable databases; none is approved, and nothing grants a real business, Finance or IT approval. Product G6 never implies DG7.

## 1. Files changed

### Server (the 17 operations' list lines, and one shared helper)

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/cursor.ts` | **New helpers** next to the existing cursor code: `pageQueryFields` (`cursor` + `limit`, 1–100, default 25), `keysetPage` (one SQL keyset page over a sort that ends with the identifier), `memoryPage` (the same for a list resolved in memory), `decodeKeysetCursor`, `keysetHash`, and the `SortKey`/`PageRequest` types. Keys travel as Postgres text (`json_build_array(key::text, …)`), so a `timestamptz` keeps its microseconds. Every cursor value is checked against its key type (uuid, integer, text, UTC timestamptz, date or `infinity`, a real calendar day and time) before it reaches SQL. A Postgres data exception (class 22) from a cursor value maps to 400 as a backstop. |
| `apps/api/src/modules/platform/index.ts` | Exports the new helpers (named lines in the existing `./cursor.ts` export block). |
| `apps/api/src/modules/workflows/approval-routes.ts` | `listApprovalRoutes`: `memoryPage` by `routeKey` (the routes are resolved from the published configuration, not one table). The resolved version id is bound into the cursor. |
| `apps/api/src/modules/kpi/formula-versions.ts` | `listBenefitFormulaVersions`: keyset `(version_no desc, id desc)`. It now parses its query (strict). |
| `apps/api/src/modules/kpi/business-case-lines.ts` | `listBusinessCaseLines`: keyset `(created_at, id)`; `includeArchived` is bound into the cursor. |
| `apps/api/src/modules/portfolio/deliverables.ts` | `listDeliverables`: keyset `(ordinal, id)`. `countWarning` still counts **every** active deliverable of the initiative (a separate count), not the page. |
| `apps/api/src/modules/workflows/dependency-types.ts` | `listDependencyTypes`: keyset `(ordinal, code, id)`, the order `loadDependencyTypes` already used. |
| `apps/api/src/modules/health/schemes.ts` | `listHealthCheckSchemes`: keyset `(key, version_no, id)` over the published scheme versions. `listPublishedHealthSchemes` takes a `PageRequest` (its only caller is the route). |
| `apps/api/src/modules/portfolio/links.ts` | `listInitiativeGapLinks`, `listInitiativeOutcomeContributions`, `listInitiativeDecisionLinks` (one shared route closure): keyset `(created_at, id)`; the kind, the initiative and `includeArchived` are bound into the cursor. |
| `apps/api/src/modules/kpi/restatement-offers.ts` | `listKpiRestatementReissueOffers`: keyset `(s.definition_code, o.series_id, coalesce(s.issue_version, 0), o.snapshot_id)`. Its comment no longer says the list "needs no pagination". |
| `apps/api/src/modules/portfolio/milestones.ts` | `listMilestones`: keyset `(coalesce(forecast_date, 'infinity'), id)`, which keeps undated milestones last as before. |
| `apps/api/src/modules/reporting/reports/routes.ts` | `listReportSnapshotVersions`: keyset `(version_kind, reference_key, id)`. |
| `apps/api/src/modules/portfolio/capacity.ts` | `listResourceRoles`: keyset `(code, id)`. |
| `apps/api/src/modules/portfolio/waves.ts` | `listRoadmapWaves`: keyset `(ordinal, id)`, the order `loadWaves` already used. |
| `apps/api/src/modules/methodology/source-links.ts` | `listTemplateSourceLinks`: keyset `(ordinal, block_ref)` over the linked playbook blocks. Before, it truncated silently at 50 (`.limit(50)`, `maxItems: 50`); now every block is reachable through the pages. A template without linked blocks still checks the cursor it is given. Its local zod schema becomes `max(100)` plus `nextCursor`. |
| `apps/api/src/modules/workflows/workshops.ts` | `listTomWorkshopParticipants`: keyset `(id)`. |
| `apps/api/src/modules/portfolio/prioritization.ts` | `listWeightSets`: keyset `(version_no desc, id desc)`. It now parses its query (strict). |

### Contract and mirrors

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | For each of the 17 operations: the `Cursor` and `Limit` parameters (added to `parameters`, or a new `parameters` block), and `nextCursor: { type: [string, "null"] }` as an **additive required** property of its list schema (each of the 17 schemas is referenced once). The 200 descriptions that said "All …" now describe a page and its order; two summaries that started "All …" are reworded. `TemplateSourceLinkList.items.maxItems` 50 → 100 (the page maximum). No operation added or removed: `openapi:lint` still counts 932. |
| `packages/shared/src/schemas/{approval-routes,benefit-formula,business-case,design,kpi-restatement,portfolio,prioritization,report,roadmap}.ts`, `packages/shared/src/health/contract.ts` | The zod mirrors of the 17 list schemas gain `nextCursor: z.string().nullable()`. |

### Web callers (screens that show every item keep doing so)

| File | Purpose |
|---|---|
| `apps/web/src/api/portfolio.ts` | Gap links, outcome contributions, decision links, milestones and waves go through `fetchAllPages`. The unpaged `getList` helper, now unused, is removed. Deliverables read every page and keep the first page's `countWarning`, which the server computes over the whole list. |
| `apps/web/src/pages/automation/api.ts` | `useApprovalRoutes` reads every page and pins later pages to the first page's `methodologyVersionId`. |
| `apps/web/src/pages/playbook/api.ts` | `useTemplateSourceLinks` reads every page; `TemplateSourceLinkList` gains `nextCursor`. |
| `apps/web/src/pages/{benefit-formulas,business-cases,dependencies,health-check,kpi-restatement,prioritization,reports}/api.ts`, `pages/business-cases/CaseLines.tsx`, `pages/capacity/editing.tsx`, `pages/change-requests/subjects.ts`, `pages/traceability/TracePanels.tsx` | The single `api.get<{ items }>` calls of these lists become `fetchAllPages` (the 20 × 100 cap of ADR-0061 §9). |

### Tests

| File | Purpose |
|---|---|
| `apps/api/test/integration/hardening/list-pagination.test.ts` (new) | The §D.5 tests against a real disposable PostgreSQL (§2). |
| `apps/api/src/modules/platform/cursor.test.ts` (new) | Unit tests: cursor value checks (impossible day or hour, another UTC offset, SQL text in a value, wrong type or arity, another hash or sort) and `memoryPage` walking a resolved list. |
| `apps/api/test/integration/contract/response-validation.test.ts` | The pin `UNPAGINATED_LISTS_AT_HEAD` shrinks from 38 to the **21** names of ADR-0007 §4a. It is checked equal to the ADR's list (`diff` → identical). The header comment is updated. |
| `apps/api/test/integration/portfolio/unpaged-lists.test.ts` (DG3 test, **another owner's file**) | It asserted the old behaviour (400 on `limit`, no `nextCursor`) for 8 of these lists, which this task reverses by design. It now asserts 200 with `nextCursor` with and without `limit`, and 400 on `limit=0`, `limit=101` and an unknown parameter. |
| `apps/api/test/integration/kpi-restatements/decisions.test.ts` (DG5 test, **another owner's file**) | One added block (22 lines) at the point where the restatement world has two reissue offers and an issued register with pinned versions. Both lists are walked one item per page and compared with one page of 100, and a forged cursor value gets a 400. No existing assertion is changed. |
| `apps/api/test/integration/workflows/approval-routes.test.ts` (DG5 test, **another owner's file**) | Its exact `toEqual` of the `listApprovalRoutes` body gains `nextCursor: null` (one line). |
| `apps/web/src/pages/{dependencies/dependencies,dependencies/slips,benefit-formulas/benefit-formulas,capacity/fe-e,prioritization/prioritization,change-requests/change-requests}.test.tsx` (**other owners' files**) | GET mocks anchored on the bare path (`…/dependency-types$`) now accept the query string (`(\?|$)`), because the screens send `?limit=100`. No expectation changed. |

**No migration** (the highest file is still `0120`), **no new dependency**, **no new operation**. There is no `p6-pending-be-v.ts` or `p6-exercises-be-v.ts`: the 17 operations were already routed and exercised (§5).

## 2. Behaviour delivered

### 2.1 D-199 / ADR-0007 §4a: the list-pagination rule (p6-work-split §D.5, §D.9)

§D.9's proof for this row: "`response-validation.test.ts` pin equal to the 21 bounded names". The pin now lists exactly the 21 names that ADR-0007 §4a exempts. `diff` of the ADR's names against the pin is identical. The pin's own test (`expect(unpaginated.sort()).toEqual([...UNPAGINATED_LISTS_AT_HEAD].sort())`) derives the unpaginated set from the contract, so it passes only if all 17 now declare `nextCursor`. The same test requires a validated 200 **with** `nextCursor` for every paginated list in the contract sweep (`successes.filter((r) => r.hasNextCursor !== true)` must be empty, and `listsWithoutSuccess` must be empty).

§D.5 lists four tests. Each is covered in `list-pagination.test.ts` unless stated otherwise:

- **"each of the 17 returns `nextCursor`".**
  - Every answer walked by the test asserts the key `nextCursor` is present.
  - For all 17, the contract sweep validates a 200 against the contract (where `nextCursor` is now required) and the zod mirrors.
- **"a foreign or tampered cursor → 400".** Every case asserts 400 with `errors[0].code = "validation.cursor"`. The cursors used:
  - a cursor of **another list** (e.g. milestones on deliverables, waves on resource roles, milestones on dependency types);
  - a cursor of **the same list for another parent** (another initiative's decision links and milestones; another transformation's waves);
  - a cursor of **the same list with other filters** (`includeArchived=true` against `false`, for decision links and business case lines);
  - a **forged** cursor: same hash, key values replaced by `x'); select 1; --`. This proves a forged value never reaches SQL as a 500. The hash is not secret, so the value check is what matters here.
  - a cursor that is **not base64url JSON**.
  - `limit` 0, 101 or `x` is also a 400.
- **"a second page continues the stable sort ending with `id`".** For each list with at least 2 rows, the walk at `limit=1` returns exactly the items of one `limit=100` page, in the same order with no duplicates, and in as many pages as items. Lists covered:
  - milestones (4 rows, including two on the same date and one undated, which is sorted last);
  - deliverables (3);
  - decision links (3, `created_at` with microseconds, checked against the database order);
  - waves (3);
  - resource roles (3);
  - weight sets (2 or more, newest first);
  - workshop participants (4);
  - benefit formula versions (3: `[3, 2, 1]`);
  - business case lines (3);
  - dependency types (the 5 or more seeded rows);
  - template source links (the template with the most linked blocks);
  - reissue offers and report snapshot versions (2 or more each, in `decisions.test.ts`).
- **"the web screens that showed every item still do".**
  - Every web caller of these lists that showed a whole list now reads every page (`fetchAllPages` or a page loop that keeps the list's header fields).
  - The web suites of the affected screens pass (§4) with their mocks; no expectation changed.
  - The template source-link badge used to stop at 50 blocks; it now shows every linked block, up to the 2,000-item cap of `fetchAllPages`.

**What is shown with fewer than 2 rows, stated plainly:**

- `listInitiativeGapLinks` and `listInitiativeOutcomeContributions` share the decision-link route closure in `portfolio/links.ts`, so the 3-row decision-link walk exercises the same code. For these two the test asserts `{ items: [], nextCursor: null }` and the 400 for a foreign and a forged cursor.
- `listHealthCheckSchemes` has one published scheme in a fresh database. The test walks it (1 page) and asserts the 400s.
- `listApprovalRoutes` resolves to an empty list in a fresh database: the seeded methodology has no `approver_route` element. The test asserts a single empty page and the 400s. `memoryPage` paging over a longer resolved list is proven by the unit test.

### 2.2 REQ-S16-027 (related row; not assigned to this task alone)

Acceptance text: "A12;A08: contract tests validate responses against the OpenAPI document; invalid input returns the uniform 400 body; an unauthorized call returns 403". This task changes no authorization.

- Each of the 17 handlers keeps its existing read check, made before the page is read: `requireTransformationRead`, `readableInitiative`, `requireMethodologyRead`, or the session check.
- An invalid `cursor` or `limit` returns the uniform 400 problem body (`validation.cursor` at `/query/cursor`, or the strict-query validation).
- The contract sweep validates every 200 against the amended contract.

The row's own status stays with its owners and the reviewers.

### 2.3 Design notes for reviewers

- **Sort order unchanged where it existed.**
  - Each list keeps the order it had.
  - Lists whose order did not end with the identifier now add it last: dependency types (`ordinal, code` → `+ id`), resource roles (`code` → `+ id`), report snapshot versions (`version_kind, reference_key` → `+ id`), reissue offers (`… issue_version` → `+ snapshot_id`), formula versions and weight sets (`version_no desc` → `+ id desc`).
  - Approval routes are now sorted by `routeKey`. Before, the procedure branch already sorted by `code`, which is the same order; the methodology branch used the resolver's order.
- **Default page size.** A caller that sends no `limit` now gets 25 items (ADR-0007 §4), not all of them. Every web caller was moved to read every page. A non-web API client that relied on the whole list now has to follow `nextCursor`, which is the point of the change.
- **Strict queries.** `listBenefitFormulaVersions`, `listWeightSets` and `listHealthCheckSchemes` did not parse their query before. They now use strict objects (`cursor`, `limit`), so an unknown parameter is a 400 like everywhere else.

## 3. Checks (exact commands, real exit codes)

Environment: Node 24.21.0, offline. The harness ports were 26150–26199 only. The evidence logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-V-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, before any change) | **0** | `PASS gate DG5 (historical)` | `validate-dg5-historical-start.log` |
| 2 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | **0** | `PASS gate DG5 (historical)` | `validate-dg5-historical-end.log` |
| 3 | `pnpm -r typecheck` | **137** on the final tree | Run 1 (before the last edits): **0**. Runs 2 and 3: **137**. Each time `apps/api` was killed for memory while two integration runs and the unit suite were running; every other package finished `Done` in run 3. **`cd apps/api && npx tsc -p tsconfig.json` on the final tree, once memory was free: exit 0.** | `typecheck.log` (run 3), `typecheck-run2-killed-137.log`, `typecheck-api-alone.log` |
| 4 | `pnpm -r build` | **0** | every package built | `build.log` |
| 5 | `pnpm lint` (final tree) | **0** | `eslint . --max-warnings=0` clean. An earlier run had 2 errors (an unused import in `dependencies/api.ts`, a value import used only as a type in `cursor.ts`); both are fixed. | `lint.log`, `lint-run1-two-errors-fixed.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (run before the last test edits; those files and this handback were then formatted with `prettier --write`) | `prettier.log` |
| 7 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.log` |
| 8 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **0** | unit-node 180 files / **2749 passed**; unit-web 102 files / **1850 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped**. Started before the final `source-links.ts` and `approval-routes.test.ts` edits; neither is in a unit project. | `unit-locale-unset.log` |
| 9 | `env -u LANG -u LC_CTYPE LC_ALL=C.UTF-8 pnpm test` | **1** (both runs) | Run 1: every test passed (unit-node **2749/2749**, unit-web **1850/1850**, nocodegen **259 + 2 skipped**). Run 2: unit-node **2749/2749**, unit-web **1848/1850** (2 load flakes in unrelated screens, passing alone: check 17), nocodegen **259 + 2 skipped**. The non-zero exit is Vitest's own `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` (1 in run 1, 2 in run 2) in the unit-node invocation. It happened while two full integration runs, a typecheck and a build were running at the same time. It is not an assertion failure. | `unit-c-utf8-run1-rpc-timeout.log`, `unit-c-utf8.log` |
| 10 | `QA_PG_PORT=26150 MTH_PORT_POOL=26151-26199 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/hardening/list-pagination.test.ts` (final version) | **0** | **4/4 passed** | `list-pagination-final.log` |
| 11 | `npx vitest run --project unit-node apps/api/src/modules/platform/cursor.test.ts apps/api/src/architecture.test.ts` | **0** | 153 passed (12 cursor tests, the architecture suite) | in `unit-*.log` too |
| 12 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/kpi-restatements/decisions.test.ts` | **0** | **4/4 passed** (with the offers and versions paging block) | `iter-decisions.log` |
| 13 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/portfolio/unpaged-lists.test.ts` | **0** | **1/1 passed** | (console; rerun in 14) |
| 14 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/workflows/approval-routes.test.ts` (after the fix in §7) | **0** | **9/9 passed** | `approval-routes-fixed.log` |
| 15 | `QA_PG_PORT=26175 MTH_PORT_POOL=26176-26199 tests/qa/support/with-pg.sh pnpm test:integration` (final run; it finished after the first version of this handback was written) | **1** | **385 files: 380 passed, 5 failed. Tests: 3949 passed, 6 failed, 7 skipped, 2 todo** (4800 s, under the parallel load in §7). None of the 6 failures remains in this task's code (§7). | `integration-final.log` |
| 17 | `LC_ALL=C.UTF-8 npx vitest run src/pages/p2.test.tsx src/pages/gates/g5-g6.test.tsx` (apps/web) | **0** | **91 passed.** These two files failed in C.UTF-8 run 2 under load (a 20 s timeout, and an element lookup on the G5 view); they passed in run 1 and in the locale-unset run. | `unit-web-c-utf8-rerun-2-files.log` |
| 16 | `npx vitest run src/pages/{dependencies,benefit-formulas,capacity,prioritization,change-requests}` (apps/web) | **0** | 7 files / **92 passed** | (console) |

## 4. Operations routed: delta to the pending list

None. The 17 operations were already routed at DG2–DG5 and are exercised by the existing exercise files. Pending lists: no change. `contract.test.ts` pins: **operation count unchanged (932)**, media types unchanged, rate-limit floor unchanged, CSRF-exempt routes unchanged. The only pin that changes is `UNPAGINATED_LISTS_AT_HEAD` in `response-validation.test.ts`: from 38 names to 21.

## 5. For the orchestrator: contract, schema, dependency

- **Contract extension (approved by D-200 item 2):** 17 × (`Cursor`, `Limit`) parameters, and 17 × additive required `nextCursor`. One constraint change: `TemplateSourceLinkList.items.maxItems` 50 → 100 (the page maximum; before, the route cut the list at 50 without saying so). The `info.version` (`1.5.0-p6`) is left as it is for the orchestrator.
- **ADR text now outdated (architect-owned; not edited here):** ADR-0007 §4a says of the 17 lists "Until that task ships they stay in `UNPAGINATED_LISTS_AT_HEAD` and return every item". After merge that sentence is history. Suggested wording: "T-DG6-BE-V paginated them (`{ items, nextCursor }`); the pin holds the 21 bounded names." ADR-0021 §11 item 6 (unpaged P3 child lists) is superseded the same way for the 8 P3 lists.
- **Shared-file touches outside the §D.8 row, for merge reconciliation:**
  - `platform/cursor.ts` and `platform/index.ts` (new helpers; the architecture test forbids importing `platform/cursor.ts` directly);
  - `unpaged-lists.test.ts` and `decisions.test.ts` (DG3 and DG5 tests);
  - six web test files (mock regexes only).
- **No dependency, no migration, no secret.**

## 6. User-facing texts

- No en/ar string described these lists as complete, unpaged or planned. The template source-link badge's texts are unchanged; it now shows every linked block, where before it silently stopped at 50.
- No user-facing text was made untrue. The contract's "All …" response descriptions, which are API texts, are corrected (§1).

## 7. Failures, flakiness and overlaps disclosed

- **Final integration run result (check 15, completed after the first draft):** 6 failing tests. One was caused by this task and is fixed; none of the other five is in this task's code:
  - `workflows/approval-routes.test.ts`: caused by this task (the exact body now has `nextCursor`), **fixed**, 9/9 alone (check 14). The run had loaded the old file.
  - `assistant/conversations.test.ts`: pre-existing at HEAD (see item 1 below).
  - `admin/security.test.ts` › getSecurityRateLimits: the `webhook` class now lists `receiveWebhook` where the test expects `[]`. BE-W reports the same failure (`T-DG6-BE-W-backend-workflow-engineer.md`, §"the `webhook` rate-limit class"). Not related to pagination.
  - `response-validation.test.ts` › P5 BE-J operations: `p5-exercises-be-j.ts:61` expects the dependency-slip list to have 1 item and gets 0. That endpoint is not one of the 17 lists; the same test name fails in BE-C's and BE-D's logs.
  - `response-validation.test.ts`: two 30 s timeouts (U+0000 sweep, media-type sweep) under the parallel load.
  - In the same run, `contract.test.ts` (103 tests), `list-pagination.test.ts`, `unpaged-lists.test.ts` and `decisions.test.ts` passed, and the pin check passed; the log reads `[response-validation] list operations: 219; cursor-paginated 198 (250 validated 200s, all with nextCursor); unpaginated, pinned and reported: 21`.
- **Earlier snapshot (before the run finished),** kept for the record:
  1. `assistant/conversations.test.ts` › "the rate-limit class `assistant` and the log line …": expected `replyKind: "no_sources", dataItems: 0`, received `"answer", 1`. **Pre-existing at HEAD, not caused by this task.**
     - It fails the same way alone in this tree (`assistant-conversations-alone.log`: 16 passed, 1 failed).
     - BE-Q2 recorded the same failure on a HEAD baseline (`T-DG6-BE-Q2-evidence/head-baseline-assistant-conversations.log`). BE-W and DO-FB report it as the BE-T/BE-U merge seam.
     - The assistant module imports none of the code changed here.
  2. `workflows/approval-routes.test.ts` › "listApprovalRoutes: the version's routes …": **caused by this task and fixed.** The test compared the whole body with `toEqual`, which now has `nextCursor`. I added `nextCursor: null` to the expected body (another owner's DG5 test; one line). Rerun alone: 9/9 passed (check 14). The final full run had loaded the old file.
  3. `contract/response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)": **not diagnosed.** The detail prints only when the run ends.
     - `p5-exercises-be-j.ts` calls none of the 17 operations (`grep` finds none).
     - The same failing test name appears in BE-C's and BE-D's integration logs (`T-DG6-BE-C-evidence/integration.log`, `T-DG6-BE-D-evidence/integration-full.log`).
     - I could not prove it independent of this change before the limit.
  4. and 5. `contract/response-validation.test.ts` › "U+0000 in the query is a declared 400" and "an undeclared request media type is a declared 400": both stopped at the **30 s test timeout** (30020 ms, 42814 ms) under the load described below. Not diagnosed further.
     - `contract.test.ts` (103 tests) passed in the same run.
- **An overlapping first integration run.**
  - I started a full run (port 26150) and then rewrote `platform/cursor.ts`: the architecture checker forbids computed member access, which the first version used. That run therefore mixed two versions of the code.
  - I could not stop it: its process is not visible from my shell's sandbox, and I have no stop tool. It kept running in parallel with the final run, which doubled the load (and caused the memory kill in check 3, run 2).
  - Its log is kept as `integration-run1-overlapped-edit.snapshot.log` (and `integration.log`, which it was still writing). It showed the assistant failure above, plus the BE-J and media-type failures; it is **not** offered as evidence of the final tree.
- **The C.UTF-8 unit runs exited 1** only because of Vitest worker RPC timeouts under that load. Every test passed (check 9).
- **Errors I found and fixed during the work, for the record:**
  - the date-cursor check read a date's trailing `-01` as a UTC offset, which refused every date cursor;
  - V8 accepts 2026-02-31, so the calendar check needed a round trip;
  - the computed member access the architecture test forbids (F-DG1-124);
  - the web mocks anchored on bare paths;
  - `unpaged-lists.test.ts` asserting the old behaviour.

## 8. What remains

1. **Check 15 completed with exit 1; the 6 failures are explained in §7.** The orchestrator should run `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` once on the merged tree, with nothing else running, and look at:
   - `response-validation.test.ts`: the pin (expected to pass with the 21 names), the BE-J exercise failure and the two 30 s timeouts;
   - any other DG2–DG5 test that compares one of the 17 list bodies with an exact `toEqual({ items })`. Such a test fails only for the added `nextCursor` key; the fix is to add `nextCursor: null` to its expected body, as in `approval-routes.test.ts`.
2. **`pnpm -r typecheck` as one command on the final tree** was killed for memory twice under the parallel load (`apps/api` only). `apps/api` alone exits 0 and every other package finished. A rerun without parallel load should give one clean exit 0.
3. **The C.UTF-8 unit run** should be repeated without parallel load, for a clean exit 0. In run 1 every test passed; the run-2 flakes pass alone.
4. **ADR text:** the ADR-0007 §4a sentence about the 17 lists (§5) is now history; the architect owns it.
5. There is no separable second half (BE-V2): all 17 operations are done.
