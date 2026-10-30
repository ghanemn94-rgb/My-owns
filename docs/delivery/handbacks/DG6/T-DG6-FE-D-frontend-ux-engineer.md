# Handback T-DG6-FE-D (frontend-ux-engineer): slice H search, saved views, filter chips, breadcrumbs, help, the 1,000-initiative register

- **Stage:** P6, gate DG6 (BUILDING). This is engineering work only. Nothing here grants or records a G1–G6 business approval, and nothing reads or writes DG0–DG7.
- **Invocation:** `claude-code-cli-session`, run `DG6-T-DG6-FE-D-frontend-ux-engineer-20261030T154224Z-ce2d5509`, session `ce2d5509-ab49-4862-aa10-1cc059532a57`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-D.md` (sha256 `e1f024b7…518ed`, verified). Binding scope: `docs/architecture/p6-work-split.md` §H/G.6, the FE-D bullet, and §2.
- **Starting revision:** `92b86e1ca` on branch `dg6/fe-d`, clean tree. Changes are left **uncommitted**.
- **Time:** started `Fri Oct 30 15:42:38 UTC 2026`. The end time is in §9.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0. It was run before implementation and again at the end (§4).

## 1. Files changed

### Inside the FE-D ownership (§H/G.6)

| File | Purpose |
|---|---|
| `apps/web/src/pages/search/SearchPage.tsx` | The `/search` results page. It has the query field, record-type filters, include archived, chips and saved views (list `search`). Results show their type, transformation and code, with client-side `<mark>` highlighting (plain text only, never markup). It also has the designed states: prompt, loading, error (503 or 429 translated) or no permission, the **stale** banner ("This information may be out of date. Last updated {time}.", Unknown when there is no time), the **empty** state, and a separate **empty-while-stale** state. Results use the server cursor for paging. |
| `apps/web/src/pages/search/GlobalSearchBox.tsx` | The header's global search landmark. It does not send a query of fewer than 2 characters and shows the §10 text instead. It navigates through `useSessionNavigate`. |
| `apps/web/src/pages/search/api.ts` | The `searchRecords` client (`useSearch`, the `SearchHit` and `SearchResultPage` types) and `hitPath` (where a hit opens). |
| `apps/web/src/components/saved-views/api.ts` | The client for `listSavedViews`, `createSavedView` (Idempotency-Key), `putSavedView`, `deleteSavedView` and `shareSavedView` (each with If-Match). |
| `apps/web/src/components/saved-views/useListView.ts` | A list's working state: columns, filters, sort and the active view. It applies the owner's default view and drops unknown keys (the §10 notice). It reads the old per-browser choice once. It also provides `listQueryOf` (filters plus `sort`/`-sort`). |
| `apps/web/src/components/saved-views/SavedViewBar.tsx` | Pick, save changes, save as new (name, make default), rename, set or remove default, share or stop sharing, and delete with a confirmation. Share is offered only with `saved_view.share`; stop sharing only to the owner. The auditor (no `saved_view.manage`) gets apply-only, with an explanatory text. The bar has one form-level alert, session-guarded writes, a reload on 409, and a text-and-icon label for the view state (unsaved, saved, changed, shared, default). It never uses colour alone. |
| `apps/web/src/components/saved-views/productivity.css` | Styles for the slice H screens. Design tokens and logical properties only, and no status colour for views or chips. |
| `apps/web/src/components/saved-views/provisional-ar.ts` | Marks every slice H Arabic text as provisional (bound by the test). |
| `apps/web/src/components/saved-views/productivity.test.tsx` | 16 component tests (8 each in en and ar), §5. |
| `apps/web/src/components/saved-views/productivity-i18n.test.ts` | ADR-0057 §10 English verbatim, read from the ADR. Also checks Arabic present and different, the §9 stale text, the §10 notice, en/ar key parity, the provisional label, and that no text mentions DG0–DG7. |
| `apps/web/src/components/filter-chips/FilterChips.tsx` | One chip per active filter, with its translated name and value (value isolated with `<bdi>`). Each chip has a labelled remove button; there is also "Clear all filters". |
| `apps/web/src/components/breadcrumbs/Breadcrumbs.tsx` | The breadcrumb trail. It takes the names the page has already loaded, isolates each label with `<bdi>` (codes LTR), marks the last item `aria-current="page"` and follows the document direction. |
| `apps/web/src/components/help/HelpPanel.tsx` | The help disclosure for a `screenKey` (`listHelpTopics`). It shows topics in the interface language, adds the provisional label to Arabic topics marked `arabicProvisional`, and lists the source refs. Loading, empty and error states are explicit. |
| `apps/web/src/components/DataTable.tsx` (saved-view lines) | `visibilityFromViewColumns`, `viewColumnsFromVisibility` and `readLegacyVisibility`, which reads the old `mth.table.<id>.columns` once and never writes it. The header comment is updated. |
| `apps/web/e2e/p6-register-1000.spec.ts` | The 1,000-initiative register e2e, with a measured budget (§5). |

### Named lines outside the list, disclosed for the orchestrator to accept or move

| File | Lines | Why |
|---|---|---|
| `apps/web/src/pages/portfolio/InitiativeRegister.tsx` (new) | The whole file | The initiative register needed to become server-side (sort, filters, cursor paging), with saved views, chips and help, for the REQ-S15-013 acceptance and the FE-D e2e. Before, it loaded every page and sorted, filtered and paged in the browser (`RegisterTable`). No §H/G task owns `pages/portfolio/**`. |
| `apps/web/src/pages/portfolio/PortfolioPage.tsx` | The filter block and `QueryState`/`RegisterTable` of `InitiativeList` are replaced by `<InitiativeRegister>`. The column ids `wave`→`waveId` and `funding`→`fundingState` now match the registry keys. Two new columns, `plannedEnd` and `updatedAt`, are the remaining server sort keys. | As above. Labels and the status and wave filters are unchanged, so the DG3 tests and the `p3-portfolio` e2e selectors still hold (portfolio.test.tsx 32/32). |
| `apps/web/src/components/Page.tsx` | `PageHeader` renders `<Breadcrumbs>`. `Crumb` is re-exported from it, and the now-unused `Link` import and `t` are removed. | This is the breadcrumb slot. FE-A's handback §7 left it to FE-D, and no FE-A2 task exists. |
| `apps/web/src/app/Shell.tsx` | 3 lines: the import and `<GlobalSearchBox />` in the header. | The global search box slot (FE-A's §7 item 1). This follows the FE-E precedent. |
| `apps/web/src/app/router.tsx` | 3 lines: the lazy `SearchPage` and the route `search`. | The shared route table. |
| `apps/web/src/i18n/index.ts` | 6 lines: the `productivity` namespace (en/ar). | The shared i18n index. |
| `apps/web/src/i18n/{en,ar}/productivity.json` (new) | The new namespace. | The FE-D catalogue (ADR-0057 Consequences: "the FE catalogues of FE-D"). |
| `apps/web/src/i18n/{en,ar}/problems.json` | 9 keys appended at the end: the 8 ADR-0057 §10 codes and `saved_view__unknown_key_noParams`. | FE-A was to add the slice H codes (§H/G.6 FE-A bullet), but they were missing at `HEAD`. The append is additive. |

No migration, no API code, no contract change, no new dependency and no file under `tools/**`, `.claude/**` or `docs/source/**`.

## 2. Behaviour delivered, per requirement row

### REQ-S15-013: "Give data tables sorting, filtering, pagination and column selection"

Acceptance: *"A20: on a register with 1,000 initiatives, sorting, filtering, paging and hiding a column all work, and the API returns paginated results"*. Procedure: *"Tables use server-side pagination and filtering through the API and persist column choices in saved views"*.

FE-D's share is the table, the chips and the views. BE-R owns the API test, and QA-D owns A20.

- **Server-side sorting, filtering and paging on the initiative register.** Every filter (`status`, `waveId`, `q`, `executiveOwnerUserId`, `workstreamLeadUserId`) and the sort (`code`/`-code`, `name`, `plannedEnd`, `updatedAt`) are `listInitiatives` query parameters. A page is one API page (`limit` 10/25/50/100 plus `cursor`). Previous works through the remembered cursors. Nothing is sorted or filtered in the browser.
- **Proven against the real API by `p6-register-1000.spec.ts`** on 1,000 initiatives, in en and ar:
  - the first page response has 25 items and a `nextCursor`;
  - "Code, descending" puts the API's own `sort=-code` first item first, and "Name" ascending puts the API's `sort=name` first item first;
  - three pages forward give 75 distinct initiatives, and Previous returns;
  - `q` narrows 1,000 to 1, the chip names the filter and removing it restores 25;
  - hiding the Wave column and saving the view as the default, then clearing browser storage and reloading, keeps Wave hidden. That proves the choice is persisted on the server.
- **Column choices are saved in views.** A column the registry names can be hidden and is stored in the view. Derived columns (owners, proposed rank, selection) are not properties of the list item and cannot be stored (422), so they always stay shown. The old per-browser choice is read once as the unsaved state and never written again (component test).

### REQ-S15-010: "Provide global search with permission filtering, saved views, filter chips, breadcrumbs, … contextual help"

Acceptance: *"A12;A14: search as a user scoped to transformation X returns no Y records; a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload"*. Procedure includes *"Search returns only records the user may read; lists support saved views and chips"*.

FE-D's share is below. A12 is proved by BE-P2's parity test and QA-B; the bulk and draft parts are BE-Q2's and FE-D2's.

- **Global search.** The header box and the `/search` page. The page shows only what `searchRecords` returns: it never filters, caches a scope or guesses a hit. It shows the stale state above results and keeps the empty state distinct from the stale-empty state, so results are never shown as "nothing exists" while the index is behind (ADR-0057 §2). It is component-tested in en and ar. In the e2e stack (API only, no worker, so the index is never fed) the page honestly shows the stale-empty state with "Last updated Unknown" (screenshot `p6-search.png`).
- **Saved views.** Pick, save, rename, set default, delete, and share for holders of `saved_view.share`. The auditor sees and applies views only, with no write control and no write request (component test and e2e as `dev.auditor`). A view grants no data: applying it only sets the list's parameters.
- **Filter chips.** On the initiative register and the search page.
- **Breadcrumbs.** Every `PageHeader` crumb is rendered by `components/breadcrumbs`.
- **Contextual help.** On the search page (`search`) and the initiative register (`lists`). It is checked in the e2e (topic `lists.saved_views` visible) and the component test (`?screenKey=search`, Arabic provisional label).

The ADR-0057 §10 refusal texts are translated in en, verbatim, and in ar (provisional).

### Not in FE-D (FE-D2's split, §H/G.6)

Draft recovery, compare-and-reapply, inline edit, and the stale and conflict texts in `States.tsx`. None of these was touched.

## 3. Operations routed

FE-D is a web task: it has no `p6-pending-*.ts` list and routes no operation. **Pending-list delta: none.** It consumes 9 contract operations that BE-P2, BE-Q and BE-Q2 already routed: `searchRecords`, the six saved-view operations, `listHelpTopics`, and `listInitiatives` with its ADR-0057 §5 parameters. There are no contract pin changes: the operation count stays 932 (`pnpm openapi:lint`).

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG6/T-DG6-FE-D-evidence/`)

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | exit 0, `PASS gate DG5 (historical)` | (start-of-run output, see §9) |
| 2 | `pnpm -r typecheck` | **First attempt exit 137.** `apps/api` `tsc` was killed (memory: 16 GB, no swap, while the integration and unit suites ran; every other package was Done; `typecheck-attempt1-oom.txt`). **Re-run `pnpm -r --workspace-concurrency=1 typecheck`: exit 0.** | `typecheck.txt` |
| 3 | `pnpm -r build` | exit 0 (final tree; `apps/web` built before e2e run 4) | `build.txt` |
| 4 | `pnpm lint` | exit 0 (`eslint . --max-warnings=0`) | `lint.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!". The only later edit is the budget comment of the e2e spec, which `npx prettier --check` passed separately. | `prettier.txt` |
| 6 | `pnpm openapi:lint` | exit 0, "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations" | `openapi-lint.txt` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`), final tree, 16:54 | **exit 1.** unit-node 178/178 files and **2734/2734 tests passed**, but Vitest reported 1 unhandled error, `[vitest-worker]: Timeout calling "onTaskUpdate"` (worker RPC timeout at load average about 22–25), which fails the invocation. unit-web **1837/1837** passed. unit-formula-nocodegen **259 passed, 2 skipped**. | `test-locale-unset.txt` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, final tree | **exit 1.** unit-node 2733/2734: `server.test.ts` "declares access on every /api route" hit its 5 s timeout, plus 2 worker RPC timeouts. unit-web 1829/1837: 8 failures in `session-bound`, `extension-hosts-twelve`, `g5-g6` and `portfolio` (Initiative Card), each a 20 s timeout or a missing element at load average about 25. unit-formula 259 passed, 2 skipped. **Re-run of exactly the failed files in C.UTF-8** (load about 12): web **4 files, 127/127 passed, exit 0**; node `server.test.ts` **6/6, exit 0**. A clean full C.UTF-8 run was **not** obtained. | `test-c-utf8.txt`, `test-c-utf8-rerun-failed-web.txt`, `test-c-utf8-rerun-failed-node.txt` |
| 9 | `QA_PG_PORT=26070 MTH_PORT_POOL=26071-26099 tests/qa/support/with-pg.sh pnpm test:integration` | **NOT COMPLETED.** The agent harness stopped it at its 60-minute background limit (16:50 → about 17:50; load average 14–25 with the e2e and unit suites alongside). Before the stop: **154 files passed and 3 files had failures** (5 tests). `webhooks.test.ts`: "refuses unsigned, wrongly signed, stale … deliveries". `assistant/conversations.test.ts`: "over the per-minute budget a post is 429". `contract/response-validation.test.ts`: "P5 BE-J operations", plus two 30 s timeouts ("U+0000 in the query" and "an undeclared request media type"). This change touches only `apps/web/**`, no API, contract or database file, so these cannot come from it. I could not re-run them to tell load from a pre-existing defect. **No pinned count changes.** | `test-integration.txt` |
| 10 | `E2E_PG_PORT=26050 E2E_API_PORT=26051 MTH_PORT_POOL=26052-26069 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-register-1000.spec.ts --workers=1` (run 4, final tree) | exit 0, **6 passed** (2.7 min) | `e2e-p6-register-1000-run4.txt` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | exit 0, `PASS gate DG5 (historical)` | `validate-dg5-end.txt` |

### Non-zero exits during development (disclosed)

- **e2e runs 1–3** (`e2e-p6-register-1000-run1.txt` … `run3.txt`): each failed in the register test. Setup, sorting and the server first page passed in every run. All three failures were real defects found and fixed:
  1. **Run 1:** the paging check read the rows before the next page had arrived (a test race; the previous page stays visible with `aria-busy`). The test now waits for the table to settle and the first code to change.
  2. **Run 2:** my `aria-busy` locator also matched the saved-view select. Narrowed to `:has(table)`.
  3. **Run 3:** after "Save as new view" the bar said "Changed, not saved". The view had saved correctly (the status text says so), but the "changed" comparison included derived columns that a view cannot store. **This was a product defect**, fixed in `useListView.ts` (only registry columns are part of the state).
- **First full `pnpm test` (locale unset, before the final fix)** exited 1, with 13 unit-web failures in 5 files: `session-identity`, `sustain` (lesson search), `kpi` ("no form"), the playbook reader `feg`, and `reader-tables`. My header search box added a second `<form>`, `searchbox` and "Search" button to every page, which those tests rightly treat as unique. Fixed: the box is now a `role="search"` region with no `<form>`. Its input is `type="text"` with `inputMode="search"`, and its button's accessible name is "Search records", which contains the visible "Search". The 5 files then passed (106/106), and the final full runs are rows 7–8.
- **First component-test runs:** the portfolio test failed 4/32 because the cell renderers were recreated on every render, so TanStack's `flexRender` remounted every row. That was a real defect (DOM identity and focus loss); the column definitions are now stable. A glossary test also failed on "تحول" without shadda, now fixed to "تحوّل". Both are green in the final runs.

## 5. Tests added

- `productivity.test.tsx`, 16 tests, en and ar:
  - the register sends `sort`, `limit`, `cursor` and filters to the API, with chips that remove their parameter;
  - the default view applies columns, filters and sort, and "save as" POSTs exactly `{listKey, transformationId, name, columns, filters, sort, isDefault}` with an Idempotency-Key;
  - Share appears only with `saved_view.share` and sends If-Match `"2"`, and the unknown-key notice shows;
  - the auditor applies a view and has no write control and no write request;
  - the legacy column choice is read once and never written;
  - search: a 1-character query is not sent, hits are shown with `<mark>`, a hit's link opens its record, the stale banner shows, `recordType` is repeated as a parameter with a chip, empty differs from stale-empty (with Unknown time), and 503 is translated;
  - help topics load per `screenKey` with the Arabic provisional label, and breadcrumbs mark `aria-current`.
- `productivity-i18n.test.ts`, 4 tests (§1).
- `p6-register-1000.spec.ts`, 3 tests × 2 languages. **Budget: 300 s per test**, measured on run 4 at load average 14.1–19.9 while the integration suite ran. Worst case 35.2 s (the Arabic setup), so the budget is about 8x. Every screen is axe-checked (no serious or critical violation) and captured.

**Screenshots (en and ar)** are in `T-DG6-FE-D-evidence/screenshots/{en,ar}/`:
- `p6-register-1000-filtered.png` (q filter, chip, 1 row of 1,000);
- `p6-register-1000-save-view.png` (save dialog);
- `p6-register-1000-view.png` (the default view after a reload, Wave hidden);
- `p6-register-1000-help.png` (list help);
- `p6-register-1000-auditor.png` (apply-only);
- `p6-search.png` (stale-empty search state).

**Interaction checks actually run:**
- keyboard: Enter in the header box and in the register `q` field;
- `aria-sort` on sortable headers;
- `aria-expanded` on Help and Columns;
- labelled chip remove buttons;
- `aria-current` on the last breadcrumb;
- RTL direction in ar (component test asserts `dir`);
- no request leaves the origin (`trackRequests`, e2e).

## 6. Needs for the orchestrator (contract, schema, dependency)

1. **No contract, schema or dependency need.** No migration.
2. **Ownership:** please accept or move the named lines in §1 (`pages/portfolio/{InitiativeRegister,PortfolioPage}.tsx`, `components/Page.tsx`, `app/Shell.tsx`, `app/router.tsx`, `i18n/index.ts`, `i18n/{en,ar}/problems.json`). Expect union conflicts only where FE-B, FE-C or FE-D2 also append to the router, Shell header, `i18n/index.ts` or `problems.json`.
3. **Behaviour changes on the initiative register, by design (REQ-S15-013 server-side):**
   - Only server sort keys are sortable: code, name, planned end and last changed. Sorting by status, wave, rank, funding or warnings was a client sort over the whole loaded list, which the API does not offer (ADR-0057 §5).
   - The old free-text box searched every column in the browser. It is replaced by the server `q` filter (code or name).
   - Derived columns (owners, rank, selection) can no longer be hidden, because a view cannot store them.

   If these columns must stay sortable or hideable, that needs new `listInitiatives` sort keys or registry columns, a BE-R/BE-Q change.
4. **Search in the e2e stack:** `with-stack.sh` starts no worker, so the search index is never fed and any search e2e shows only the stale state. QA-B (A12) needs a stack that runs `search.index_feed`, or a `runJobNow` of `search.reindex` before searching.
5. **`hitPath` for deliverable, RAID entry, dependency, decision, evidence and lesson** opens the register page, because those types have no single-record route (deliverable opens the transformation's portfolio).

## 7. User-facing texts made untrue

- I swept the en catalogues for planned, later and not-available texts and for wording about search, saved views, columns, chips and help. **None is made untrue by this task.**
- `nav.portfolioPlanned` ("A cross-portfolio view of this area … is planned for a later release") stays true. Global search finds records across transformations, but it is not a cross-portfolio *register view* of an area.
- `portfolio.filter.*` and `portfolio.list.*` still describe the list correctly.

## 8. What remains

- **Acceptance 2 and 3 are not met cleanly. The orchestrator must re-run them on a quieter machine:**
  - `pnpm test` in both locales: every failure was a timeout under load, and the failed files pass when re-run.
  - `pnpm test:integration`: it did not finish within the harness limit, and 3 API files had failures (§4 row 9).
  - I cannot report either as passed.

- **FE-D's own scope:** no item is open. Saved views and chips are delivered on the **initiative register** and the **search page**.
  - The `transformations` list and the 9 register-kit lists (`RegisterTable`, used by the P2 registers) still sort and filter in the browser, with the per-browser column choice.
  - Moving them onto `useListView` and `SavedViewBar` is mechanical: the components are generic over `listKey`. But it touches `pages/transformations/**` and every P2 register page, outside §H/G.6's file list. I name it here as a follow-up for the orchestrator, not done.
- **FE-D2 (separate task):** draft recovery, compare-and-reapply, inline edit, and the stale and conflict texts in `States.tsx` with the six-state test.
- **Arabic review:** every slice H Arabic text is provisional (`components/saved-views/provisional-ar.ts`) and awaits a Mobily language review.

## 9. Merge instructions and end of run

- No migration and no ordering constraint.
- Leave `test-results/` and `playwright-report/` out (both are ignored).
- End time: `Fri Oct 30 17:53 UTC 2026` (about 131 minutes, past the 2-hour limit while waiting for the suites).
