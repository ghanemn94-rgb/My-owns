# Handback T-DG6-BE-Q: saved views and the list registry (backend-workflow-engineer)

- **Stage / gate:** P6 "Integration and system hardening", DG6 (BUILDING). Section: `docs/architecture/p6-work-split.md` §H/G.3.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Q.md` (sha256 `7ee19a0f36491affbaa462ed98e2ed98433238f1520750cd7a9d1138e623a862`, verified at start).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Q-backend-workflow-engineer-20261030T020338Z-adafeb0e","session_id":"adafeb0e-b476-41c3-a691-556117007f7e"}`.
- **Working tree:** `/home/user/wt/dg6-be-q`, branch `dg6/be-q`, base `HEAD` `b4510ca73` ("Merge branch 'dg6/be-g' …"); clean at start. Changes are left **uncommitted** for the orchestrator.
- **Time:** started `Fri Oct 30 02:03:59 UTC 2026`; ended: see "Checks" (the closing `date -u`).
- **Product gates:** nothing here grants, records or implies a G1–G6 business approval, a Finance validation or an IT approval, and nothing touches DG0–DG7. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/saved-views.ts` (new) | Exported through the `@mth/shared` root. The list registry of ADR-0057 §4: for each of the 12 `list_key`s, the operation, the column keys (= the list item schema's properties), the filter keys with their value format (uuid, enum member, text, boolean; `multiple` for repeatable parameters), and the sort keys. Also `savedViewUnknownKey` (the first unknown column/filter/sort key with its JSON pointer) and `savedViewFilterValueError` (a value of the wrong format; a list for a single-valued filter). Dependency-free; for the API and the web client. |
| `packages/shared/src/index.ts` | **One re-export line**, `export * from "./saved-views.ts";`, with a comment. The registry is dependency-free, as the root surface requires, so the API and the web import it from `@mth/shared` without a new `package.json` subpath or a change to the API package allow-list (`architecture.testkit.ts`). A first attempt with a `./saved-views` subpath failed `architecture.test.ts` ("imports package @mth/shared/saved-views") and was reverted (§3). `packages/shared/package.json` is unchanged. |
| `apps/api/src/modules/search/saved-views.ts` | Fills BE-A's stub with the 6 operations, the refusals of ADR-0057 §10, the registry checks, default switching in one transaction, sharing under lock 730319 with the permission re-checked at commit, and the list's keyset pagination. |
| `apps/api/src/modules/platform/db-errors.ts` | New `mapP6SavedViewError` block after the slice B/A block (BE-L/BE-O), plus one dispatcher line. The mappings are exactly those of §H/G.3. |
| `apps/api/src/modules/platform/db-errors-p6-saved-views.test.ts` (new) | Unit test of the mappings: codes, statuses, English texts and pointers. |
| `apps/api/test/integration/search/saved-views.test.ts` (new) | The §H/G.3 integration tests against the disposable PostgreSQL (30 tests), including the registry-vs-contract test. |
| `apps/api/test/integration/contract/p6-exercises-be-q.ts` | Exercises all 6 operations through `ctx.mirrored` (success and each reachable refusal); `P6_MIRRORS_BE_Q` restates the `SavedView` and `SavedViewPage` schemas. |
| `apps/api/test/support/p6-pending-be-q.ts` | Emptied (all 6 routed). |
| `apps/api/test/integration/contract/contract.test.ts` | **The pinned JSON-request-body count only**, following the BE-K/BE-L/BE-M2 precedent: `[410, 408, 1]` → `[413, 411, 1]`, with a comment line. To be reconciled by the orchestrator (§2 rule 16). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Q-backend-workflow-engineer.md`, `…/T-DG6-BE-Q-evidence/*` | This handback and its logs. |

No migration, no new dependency, no change to `docs/api/openapi.yaml`, `schema.ts`, `P6_OPERATION_IDS`, the outbox registry, `apps/worker/**` or any web file.

## 2. Behaviour delivered

### Requirement rows (acceptance texts quoted from `docs/delivery/requirements.csv`)

- **REQ-S15-010**: acceptance "Search returns only records the user may read; **lists support saved views** and chips; bulk and inline edits go through the same validation, authorization and concurrency checks as single edits; unsaved drafts are recoverable". BE-Q delivers the **saved-views** part on the server: a list's columns, filters and sort, saved per user and list, optionally shared in the organization.
  - A view grants no data. It only stores list parameters, which the list then filters by its own read rules.
  - A shared view of a transformation the reader cannot read is neither listed nor returned.
  - Not BE-Q: search (BE-P/P2), chips (FE-D), bulk/inline (BE-Q2/FE-D2) and drafts (BE-Q2/FE-D2). The row is **not complete** until those and FE-D's UI land.
- **REQ-S15-013**: acceptance "Tables use server-side pagination and filtering through the API and **persist column choices in saved views**". BE-Q delivers the persistence: `columns` (1–50 keys), `filters` and `sort`, checked against the registry. That registry declares, for each list, exactly the contract's columns, filters and ADR-0057 §5 sorts.
  - The server-side filters and sorts themselves are BE-R. The `DataTable` integration is FE-D. Proof A20 is BE-R/FE-D/QA-D. The row is **not complete** until those land.

### §H/G.3 tests, each run and passing (`saved-views.test.ts`, 30/30)

| §H/G.3 test | Where |
|---|---|
| create, put, delete and share each write exactly one audit event and step the version | "create (v1), put (v2), share (v3), unshare (v4), delete (v5) each write exactly one audit event". Per request: exactly one `audit_event` with `record_type` `saved_view`, the action (`saved_view.created/.updated/.shared/.unshared/.deleted`), prior and new version, and the actor; the trigger-written `saved_view_event` has versions 1–5. |
| If-Match 409/428 | "If-Match: missing -> 428, stale -> 409 with currentVersion, malformed -> 400" for put, delete and share. No audit event; the row is unchanged. |
| another user of the organization reads a shared view and gets 404 for a personal one; a user of another organization gets 404 for both | the "visibility" tests: get, list and a write by another organization's user. |
| only the owner changes (403 `saved_view.not_owner`) | put, delete and share by a same-organization non-owner on a shared view give 403 `saved_view.not_owner` with the ADR text; on a personal view, 404. |
| share without `saved_view.share` → 403, unshare allowed | ADM_TECH (manage only) gets 403, recorded as `authorization.denied`. A user who shared while holding TO and now holds only SP can unshare (200) but not share again (403). |
| (share re-checked at commit) | `saved_view.share` is revoked while the share request waits on lock 730319 (held by the test). The result is 403, with version 1 unchanged and no audit event beyond the create. |
| AUD: list and get 200, every write 403 | AUD lists and gets a shared view (200). Create is 403. On a view the user saved under an earlier SP role, put, delete, share and unshare are all 403. |
| unknown column, filter or sort key → 422 `saved_view.unknown_key` with the key | each of the three: `params: {key}`, the pointer (`/columns/1`, `/filters/<key>`, `/sort/0/key`) and the ADR text with the key substituted. Nothing is written. Put is checked too. |
| duplicate name (case-insensitive) → 409 | create and rename give 409 `saved_view.name_taken`. Another list or another owner may reuse the name, and a deleted view frees it. |
| setting a default clears the previous one | Create with `isDefault`: the earlier default gets `is_default` false at version 2, with its own `saved_view.updated` event in the same request. Put back as default clears the other. Defaults are per list. Deleting the default leaves none. |
| (concurrent default switch) | Deterministic: an open transaction inserts an uncommitted default. The create blocks on `saved_view_one_default_key`, detected through `pg_locks` on the racer's xid. After the racer commits: 409 `saved_view.default_conflict`, and only the racer's row exists. |
| a shared view of a transformation the reader cannot read is not listed | TL on X shares an `outcomes` view of X. TL on Y doesn't see it, in the list (with and without `transformationId=X`) or through get (404). TO and AUD (organization readers) do. The `transformationId` filter returns that transformation's views plus views for every transformation. A create for an unreadable transformation, or another organization's, gives 404. |
| the registry equals the §5 parameters (a test reading the contract) | "the list registry equals the contract", 14 tests. The 12 list keys equal `SavedViewListKey`. For each list: columns = the 200 item schema's properties; filters = the query parameters other than cursor, limit and sort, with format, enum values and repeatability; sorts = the ADR-0057 §5 `sort` enum without the `-` prefix (`listInitiatives`, `listTransformations`), or, for the `RegisterSort` pattern, keys that fit the pattern and are columns. |
| (list order and paging) | Own views come first, then shared, each by case-insensitive name. Paging with `limit=2` gives no duplicate and no gap. A cursor from another `listKey` is 400. |

### Order of checks per operation (as in the code comments)

- **create:** 400 (body; `transformationId` on the `transformations` list) → 404 (transformation not readable or in another organization) → 403 (`saved_view.manage` in the caller's organization) → 422 unknown key → 400 filter value → 409 name taken → transaction: commit-time re-check (`refreshPrincipal`), default switch, insert and audit.
- **put / delete / share:**
  1. 400.
  2. 404 when not visible to the caller.
  3. 403 `saved_view.not_owner`.
  4. 403 without the code. Share needs `saved_view.share` for `shared: true`, `saved_view.manage` for `false`.
  5. For put: 422, then 400 (filter value).
  6. 428 / 400 If-Match.
  7. The transaction: lock 730319 for share, then the row lock `FOR UPDATE`. Inside it: the commit-time re-check on the reloaded grants, the owner check, 409 `saved_view.deleted`, then 409 stale with `currentVersion`. Then the write and its audit event.
- **No remote I/O** in any transaction.

### Design choices for review

- **Codes are checked in the caller's own organization.** A view grants no data, so `saved_view.manage` and `saved_view.share` are required in a grant of the caller's organization, not narrowed to the view's transformation. A create for one transformation also needs `transformation.read` there (404).
  - Effect: the owner of a view whose transformation they can no longer read can still change, unshare or delete it. It stays theirs and admits nothing.
- **A no-op share writes nothing.** A share or unshare that asks for the state the view already has returns 200 with no version step and no audit event (after the If-Match check).
- **Deleted views:**
  - `getSavedView` returns the owner's own deleted view (status `deleted`; the contract's `SavedView` carries `status`/`deletedAt`). Others get 404.
  - `listSavedViews` lists active views only.
  - Every write on a deleted view is 409 `saved_view.deleted`.
- **Two problem details outside the ADR table:**
  - The filter-value 400 uses code `validation.format` at `/filters/<key>`.
  - A `transformationId` on the `transformations` list is 400 `validation.transformation_not_allowed` at `/transformationId`. The database's `saved_view_cross_transformation_lists` is mapped to 404 as §H/G.3 says, but the API refuses first with 400 (the contract declares 400 for create).
  - The ADR-0057 §10 codes are used verbatim.
- **Audit context:** each event carries the view's organization and its `transformation_id`, if any.
- **`params` on 422:** `saved_view.unknown_key` sends `params: {key}`, because its ADR text has the `{key}` placeholder (the Problem schema's `params` rule).

## 3. Checks (real commands and exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 25250–25299, PostgreSQL from `tests/qa/support/with-pg.sh`. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Q-evidence/`.

CHECKS_PLACEHOLDER

## 4. Operations routed (delta to `p6-pending-be-q.ts`)

| Operation | Before | After |
|---|---|---|
| `listSavedViews` | pending | routed `GET /api/v1/saved-views` (access `authenticated`); exercised |
| `createSavedView` | pending | routed `POST /api/v1/saved-views` (`saved_view.manage`, consumes `application/json`); exercised |
| `getSavedView` | pending | routed `GET /api/v1/saved-views/{savedViewId}` (`authenticated`); exercised |
| `putSavedView` | pending | routed `PUT /api/v1/saved-views/{savedViewId}` (`saved_view.manage`, `application/json`); exercised |
| `deleteSavedView` | pending | routed `DELETE /api/v1/saved-views/{savedViewId}` (`saved_view.manage`, bodiless); exercised |
| `shareSavedView` | pending | routed `POST /api/v1/saved-views/{savedViewId}/share` (`saved_view.manage` on the route; `saved_view.share` checked in the handler and at commit for `shared: true`; `application/json`); exercised |

`P6_PENDING_BE_Q` went from 6 entries to 0.

Not reached in the contract exercises, on purpose:
- the 403 on `listSavedViews` and `getSavedView` (only a service principal gets it; no session can be one);
- 409 `saved_view.default_conflict` (a race; proven in the integration suite);
- the 429s (the contract's live rate-limit sweep).

No new rate-limit class.

**Pinned-count delta for the orchestrator:** JSON request bodies +3 (`createSavedView`, `putSavedView`, `shareSavedView`), so `withBody` 410 → 413 and `application/json` 408 → 411. Applied in `contract.test.ts` with a comment; reconcile with the parallel deltas. The operation count (932) is unchanged.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **The `@mth/shared` root re-exports the registry** (one line in `packages/shared/src/index.ts`). §H/G.3 allowed a `package.json` `exports` entry "if a new subpath is needed". It isn't: the registry is dependency-free, so the root surface carries it, and neither `package.json` nor the API allow-list in `architecture.testkit.ts` changes. If you prefer a `./saved-views` subpath, add the exports entry and the allow-list line, then change the two imports (`search/saved-views.ts`, `saved-views.test.ts`).
2. **Contract defect, not mine to fix (`docs/api/openapi.yaml`, ARCH):** `listTransformations` declares **two** query parameters named `sort`.
   - The DG2 one: `updatedAt:desc|updatedAt:asc|name:asc|name:desc|code:asc|code:desc`, default `updatedAt:desc`, which `transformations/routes.ts` implements today.
   - The ARCH-04 one: `-updatedAt|updatedAt|code|-code`, "Absent: today's order (ADR-0057 §5)".
   - OpenAPI forbids two parameters with the same name and location, though `pnpm openapi:lint` passes.
   - The registry follows ADR-0057 §5, so the `transformations` sort keys are `updatedAt` and `code`.
   - BE-R owns `listTransformations` `sort`; the ARCH owner should pick one parameter.
3. **Register-list sort keys for BE-R.** The contract's `RegisterSort` is only a pattern, so the registry declares the 9 register lists' sort keys, and BE-R's `RegisterSpec.sortColumns` must equal them, or BE-R asks for a registry change.
   - Every list: its main text column(s), plus `status`, `createdAt` and `updatedAt`.
   - The text columns per list:
     - `strategic_guardrails`: title, category
     - `outcomes`: statement, topRank
     - `diagnostic_items`: dimensionCode
     - `diagnostic_findings`: workstreamCode, kind
     - `workstream_outputs`: workstreamCode, title
     - `tom_gaps`: dimensionCode
     - `capability_heatmap`: name, dimensionCode
     - `journeys`: name, kind
     - `journey_pain_points`: stepKey
4. **No migration, schema, catalogue, permission, lock-class or outbox change**, and no new dependency.

## 6. User-facing texts

- I searched `apps/web/src/i18n/{en,ar}/*.json` and the `0108` help seeds for text that calls saved views or per-list column choices "planned" or "later". There is none. The `0108` topic `lists.saved_views` (en, ar provisional) describes what BE-Q delivers and stays true.
- `nav.json` `portfolioPlanned` is about cross-portfolio areas, not saved views, so it is unchanged.
- For FE-A, the ADR-0057 §10 problem codes I use (`saved_view.unknown_key`, `.name_taken`, `.not_owner`, `.deleted`, `.default_conflict`) need their `i18n/{en,ar}/problems.json` keys (FE-A's planned list). Two codes are not in the ADR table: `validation.format` (existing) and `validation.transformation_not_allowed` (new).
  - Proposed English: "A view of the transformations list applies to every transformation; leave transformationId empty." The API sends this text.
  - Arabic: provisional, for FE-A.

## 7. What remains

- **BE-Q scope:** nothing known to remain. Every §H/G.3 file and test listed above is delivered.
- **Rows REQ-S15-010 and REQ-S15-013 stay incomplete**, waiting on BE-P/P2 (search), BE-Q2 (drafts list, compare, help, bulk A14), BE-R (server-side filters and sorts: it must implement the registry's register sort keys, §5 item 3), FE-D/FE-D2 (UI, chips, `DataTable` columns from views, the e2e tests) and QA-B/C/D.
- **For the orchestrator:** the root re-export line (§5 item 1), the duplicate `sort` parameter (§5 item 2) and the pinned count (§4).

## 8. Merge instructions

- No migration and no ordering constraint beyond §H/G.12: BE-Q comes before BE-Q2, which appends its block to `p6-exercises-be-q.ts` after mine.
- Expected conflicts:
  - `contract.test.ts`: one pinned line and its comment.
  - `platform/db-errors.ts`: the new function before `mapDatabaseGuardError`, and one dispatcher line after `p6Integrations`.
  - `packages/shared/src/index.ts`: one appended re-export line.
