# T-DG7-FE-C handback: Administration > Requirement register and About this release (frontend-ux-engineer)

- **Stage:** P7 / DG7 (BUILDING). Engineering work only. No business, Finance or IT approval was granted. Product gate G6 does not imply DG7, and a register status shown on these screens is an engineering delivery state, never an approval.
- **Run:** `DG7-T-DG7-FE-C-frontend-ux-engineer-20261113T072157Z-f0e2a1ff` (session `f0e2a1ff-9f35-4c23-8123-93457943e4f0`).
- **Base:** `HEAD` `f2f8806c5a1ff8d87d4f21e48f4019029467c05e` on `claude/mobily-transformation-platform-dg6-regate`. At start the tree was clean apart from this run's own `docs/delivery/runs/` folder.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-FE-C.md`. Its sha256 `de752882…8e90` was checked and matches.
- **Scope:** p7-work-split §I.2 only (the two slice I screens). The slice E Retention screens, also owned by "FE-C" in `P7_SCREEN_ROUTES`, are **not** in this assignment and still show the placeholder.
- **Time:** `date -u` start 07:22:06, end about 07:55 UTC.
- **Order:** the `--historical` DG6 validator ran **first**, before any implementation (exit 0, `PASS gate DG6 (historical)`). It ran again at the end (§3).
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-FE-C-evidence/`.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/web/src/pages/admin/requirements/RequirementsPage.tsx` (new) | **Administration > Requirement register:**<br>• four filters (class, status, area, final gate), kept in the URL and sent as the `listRequirements` query;<br>• the table (id, class, title, status, final gate, area, increments) with sort, search, column selection and pagination (`RegisterTable`), plus the API's cursor pager;<br>• the snapshot line;<br>• the detail panel at `/admin/requirements/:reqId`, which shows all 19 columns plus area, keeps the filters and receives focus when opened. |
| `apps/web/src/pages/admin/requirements/ui.tsx` (new) | Shared parts of both screens:<br>• contract shapes;<br>• status chips (label plus icon; none uses the success colour);<br>• `RegisterText` (plain text, `dir="ltr" lang="en"`, `pre-wrap`; an empty field reads "Empty in the register");<br>• `SnapshotLine` and `UnavailableChip`;<br>• `RegisterQueryState`, which maps the 503 `release.register_snapshot_unavailable` to `RegisterUnavailableState`;<br>• the not-an-approval note and the English-only note. |
| `apps/web/src/pages/admin/about/AboutReleasePage.tsx` (new) | **Administration > About this release:**<br>• versions, the snapshot line and the time of the check;<br>• counts by status with their total;<br>• unfinished items with the missing dependency;<br>• clauses that complete after the engineering gate;<br>• remaining external configuration dependencies.<br>A `null` is shown as Unavailable or Unknown (§2 below). |
| `apps/web/src/pages/admin/requirements/release-screens.test.tsx` (new) | T-I15, plus the `release` namespace tests (12 tests). |
| `apps/web/src/pages/admin/about/about.test.tsx` (new) | T-I16 (6 tests). |
| `apps/web/src/i18n/{en,ar}/release.json` (new) | The `release` namespace, 67 keys per language. It contains the 29 §I.3 screen texts verbatim, plus FE-C's own texts for filter options, detail labels, states and dependency statuses. |
| `apps/web/src/i18n/provisional-ar-p7-release.ts` (new) | The provisional-Arabic label (D-243 Q7) for every one of the 67 Arabic leaves, marked `work-split` (29) or `fe-c` (38). There is one quoted key per line, so `tools/release/release-notes.mjs` `countProvisional` counts it exactly: it returns **67** on this file. |
| `apps/web/src/i18n/index.ts` | Registers the `release` namespace: 2 imports, 2 resource lines and 1 comment line. **This is a shared file outside my directory list.** I followed FE-B's precedent (its handback §5 Q1). |
| `apps/web/src/app/router.tsx` | Adds:<br>• 2 lazy pages;<br>• `P7_FE_C_RELEASE_PATHS`;<br>• `P7_FE_C_RELEASE_ROUTES`, registered after `P7_FE_B_ROUTES`.<br>`P7_PLANNED_ROUTES` now also leaves out the three slice I paths. `P7_SCREEN_ROUTES` is unchanged. This is FE-A's file, edited under FE-A's merge note, as FE-B did. |
| `apps/web/src/app/p7-shell.test.tsx` | FE-A's test, two edits:<br>• the planned list is now expected to equal the slice E (Retention) routes only;<br>• the placeholder sample uses indices 9, 10, 11 and 13 (retention), instead of 15 and 16, which are now real screens. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-C-evidence/**` | Logs, the real-stack script `fe-c-shots.mjs`, screenshots, `summary.json` and the mutation-check log. |

**Not changed:**

- No API, database, migration, OpenAPI, `api/**`, `nav.json` or `problems.json` file.
- `apps/api/test/support/p7-pending-be-h.ts` was already empty at base (BE-H routed and exercised all three operations), so there was no pending entry for me to remove.
- No migration was needed (§I.0: slice I adds no table).

## 2. Behaviour per requirement

**Common to both screens:**

- **Real API.** Both screens read the real API through FE-A's `useRequirements`, `useRequirement` and `useReleaseAbout` hooks.
- **Read-only.** There are only GETs, and no form posts anything (unit-tested; on the real stack, `writes: []` in both phases and languages).
- **Permissions.** The server decides access (`operations.read`, G2). A 403 shows the no-permission state, and that is unit-tested.
- **The assignment's "every mutation …" item.** It does not apply: slice I has no write operation (G5, REQ-S02-003 "edit: none in-app"), and this run made no server-side change.

### REQ-S02-003: the in-app register with filters (T-I15)

- **Filters.**
  - Class, status, area and final gate are selects that write `?class=&status=&area=&finalGate=` to the URL (replace, not push). They are sent as exactly those query parameters.
  - A value outside the contract's set, and any other URL parameter (`bogus`, `limit`, `cursor`), is never sent (`requirementQuery`, unit-tested).
  - Changing a filter remounts the list, so the old cursor is never reused with new filters (G3). This is unit-tested: after the change, no request carries `cursor`.
  - "Clear filters" appears when any filter is set.
- **Snapshot line.** It reads `Register snapshot: {{rowCount}} rows, SHA-256 {{sha}}…` with the first 12 hex digits. On the real stack it read "Register snapshot: 412 rows, SHA-256 f08ff839c7cb…", which matches `sha256sum docs/delivery/requirements.csv` (`f08ff839c7cb…`) and the generated snapshot's `rowCount` 412.
- **Detail panel.**
  - It shows every column verbatim as plain text. Tags in notes are shown as characters and nothing is interpreted: no `<b>`, `<i>` or `<script>` element exists, and a planted script did not run.
  - Line breaks are kept (`pre-wrap`).
  - An empty field shows "Empty in the register", not a blank.
  - Focus moves to the panel heading when it opens. "Close the details" keeps the filters.
- **Unavailable (G4).** A 503 `release.register_snapshot_unavailable` shows `register.unavailable` and the problem text. It never shows the empty text or an empty table (unit-tested in EN and AR, for both list and detail; also checked on the real stack).
- **Empty.** An empty page (with filters) shows `register.empty`. On the real stack, `status=BLOCKED` gives the empty text, because the real register has no BLOCKED row.

### REQ-S02-005: About lists unfinished items as such (T-I16)

- **Open items.** `openItems` rows are listed with their status chip (Specified, Planned or Blocked; never "Implemented") and the "Missing dependency" column, which holds the notes verbatim and left to right.
- **Later clauses.** `laterClauses` rows are listed under their own heading.
- **Nulls.** Each null shows the stated text, never a zero, an empty table or a success colour:

  | Field | Shown as |
  | --- | --- |
  | `register` | Unavailable |
  | `statusCounts` | Unavailable; no counts table, no `data-count` and no zero digit (unit-tested) |
  | `openItems` | Unavailable |
  | `laterClauses` | Unavailable |
  | `appVersion` `"unknown"` | Unavailable |
  | `externalDependencies` | `about.unknown`, never "none" |

- **Empty lists.** Only `openItems: []` shows `about.openItems.none`. `laterClauses: []` and `externalDependencies: []` have their own "none" texts (FE-C's).
- **Real stack.** This build has no `docs/handover/external-dependencies.json` (DOC-B's, W9). The snapshot has `externalDependencies: null`, and About shows "Unknown: this build did not include the list." The counts total is 412.

### Bilingual, accessibility and honesty

- **Languages.** The screens are checked in EN (LTR) and AR (RTL). Register text stays `dir="ltr" lang="en"` on the Arabic screen, which also shows `register.englishOnly`. The Arabic is **provisional** and labelled per key.
- **Status cues.** Every status uses a chip with a label and an icon. "Implemented" uses the neutral "closed" style. No `.status-chip--on-track` appears on either screen (unit and real-stack checks).
- **Notes shown.** Both screens show "These are engineering delivery states, not business approvals." (ADR-0071 §4).
- **Wording.** No `release` text names DG0–DG7 or G1–G6, or claims approval, certification or conformity (tested). Final-gate values such as `DG7` appear only as register data.

## 3. Checks run (real exit codes)

**Environment:**

- Node 24.21.0, `MTH_PNPM_OFFLINE=1`, in the agent sandbox with no Docker;
- PostgreSQL from the repository harnesses;
- Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG6` (at start, before implementation) | exit 0, `PASS gate DG6 (historical)` | console (shown in this run's transcript) |
| 1 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 2 | `pnpm lint` | exit 0 | `lint.log` |
| 3 | `pnpm openapi:lint` | exit 0 | `openapi-lint.log` |
| 4a | `pnpm test` (first run) | **exit 1**: `table-regions.test.tsx` failed, because my About counts table was not inside a scroll region. Fixed (`TableScrollRegion`). | `pnpm-test-run-1-table-region.log` |
| 4b | `pnpm test` (final tree) | see §3.1 | `pnpm-test.log` |
| 5 | `npx vitest run --project unit-web apps/web/src/pages/admin/requirements apps/web/src/pages/admin/about` | exit 0, 18/18 (T-I15 12, T-I16 6) | included in 4b |
| 6 | `QA_PG_PORT=27583 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` (disposable PostgreSQL) | exit 0, 111/111 | `contract-test-pg.log` |
| 7 | `node --test tools/release/tests/release-notes.test.mjs` (a new `provisional-ar*.ts` file is in that tool's input) | exit 0 | `release-notes-test.log` |
| 8 | `pnpm -r build` | exit 0. The snapshot was regenerated: 412 rows, sha256 `f08ff839c7cb…` = `requirements.csv`. The web app was rebuilt again (`cd apps/web && pnpm build`, exit 0) after the About fix. | `build.log` |
| 9 | `REPO_ROOT=$PWD OUT=… apps/web/e2e/support/with-stack.sh node fe-c-shots.mjs` (final) | exit 0, `20 checks, 0 failed` | `screenshots-run.log`, `screenshots/summary.json` |
| 10 | Mutation checks (§3.2) | each mutation made the intended tests fail; files restored byte-identical (`cmp`) | `mutation-checks.log` |
| 11 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3.1 | `prettier-check.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG6` (end) | see §3.1 | `validate-historical-DG6.log` |

### 3.1 Final results

| # | Command | Result |
| --- | --- | --- |
| 4b | `pnpm test` (final tree) | **exit 0**:<br>• unit-node: 202 files, 2992 tests passed;<br>• unit-web: 130 files, 2175 passed;<br>• nocodegen: 3 files, 259 passed, 2 skipped (pre-existing skips, not mine). |
| 11 | prettier check over `git ls-files -co --exclude-standard` | **exit 0**, "All matched files use Prettier code style!" |
| 12 | `node tools/gates/validate.mjs --historical --stage DG6` (end) | **exit 0**, `PASS gate DG6 (historical)` |

### 3.2 Interaction checks actually run on the real stack (row 9)

**The stack:**

- a disposable PostgreSQL with all migrations and the SYNTHETIC dev users;
- the API serving `apps/web/dist`;
- user `dev.admin` (ADM_TECH, which holds `operations.read`).

**Phase 1.** `apps/api/dist/release/register-snapshot.json` was moved aside before the API had loaded it. In EN and AR:

- the register shows the unavailable state once and the empty text zero times;
- About shows 4 Unavailable chips, 1 Unknown line, 0 rendered counts and no "every requirement implemented" text;
- no request left the origin, and there were no writes;
- the API log has exactly 6 × 503 `release.register_snapshot_unavailable`, which is phase 1's requests and their retries.

**Phase 2.** The file was restored, and the **same API process** recovered without a restart (G4). In EN and AR:

- the register lists 412 rows (25 shown per page). The snapshot line and the first title are `ltr`/`en`.
- the status filter set to BLOCKED puts `status=BLOCKED` in the URL and in the request, and the empty text is shown.
- **keyboard:** from the Class select, Tab reaches a requirement link. The focus outline is `solid 3px`. Enter opens the detail, focus is on `requirement-detail-title`, and 13 detail fields are shown.
- About shows a total of 412, an open-items table, "Unknown" for the dependency list, and 0 success-colour chips.
- at a 360 px viewport, both screens have 0 px of horizontal page overflow.
- axe (WCAG 2.0/2.1 A+AA) reports no violations on any of the 16 screen checks.
- no request left the origin, and there were no writes.

**Two earlier runs, kept as evidence:**

- run 1 (`screenshots-run-1-script-defect.log`) waited for `#p7-requirements`, but `RegisterTable` puts its id in `data-register`. That was a script defect.
- run 2 (`screenshots-run-2-filter-timing.log`, `screenshots-run-2-summary.json`, 19/20 passed) measured the EN filter result before the refetch had started. The script now waits for the request and the rendered result.

The run-1 defect also showed that two of my unit assertions (`#p7-requirements` / `#p7-open-items` absent) passed vacuously. They now use `[data-register=…]`, and I added positive counterparts that prove each selector matches when the table is there.

**Mutation checks (row 10):**

| Mutation | Tests that failed |
| --- | --- |
| `RegisterText` `dir="ltr"` → `dir="auto"` | 4 (detail EN/AR, About open items EN/AR) |
| The 503 state replaced by plain content | 2 (503 EN/AR) |
| `statusCounts: null` rendered as zeros | 2 (About nulls EN/AR) |

**Screenshots** (`docs/delivery/handbacks/DG7/T-DG7-FE-C-evidence/screenshots/{en,ar}/`):

- `requirements-unavailable.png`, `about-unavailable.png`;
- `requirements.png`, `requirements-filter-blocked.png`, `requirement-detail.png`;
- `about.png`;
- `requirements-360.png`, `about-360.png`.

## 4. Known gaps

1. **The slice E Retention screens (§E.6) are not built.** They are listed under "FE-C" in `P7_SCREEN_ROUTES`, but this assignment is §I.2 only. Their five routes still show the honest placeholder.
2. **T-I17** (FE-D's axe, RTL/LTR, 360 px and keyboard e2e specs over both screens) is not mine and was not written. This run's real-stack checks (§3.2) cover the same aspects as evidence only, not as T-I17.
3. **The server navigation catalogue still has no P7 items.** FE-A's gap 1: `apps/api/src/modules/identity/navigation.ts` is outside my ownership, so the Administration home's "Configuration" card does not link these screens. The sidebar entries do show (`screenshots/*/requirement-detail.png`). **Request:** add six `administration` items with the codes `dataExport`, `migrationStatus`, `configTransfer`, `retention`, `requirements` and `releaseAbout`, using the `access` values of `P7_SUBPAGES.requiresAny` and the existing `nav.contents.admin.<id>` labels. The web `test/navigation-fixture.ts` mirror would follow in the same change.
4. **The open-items table shows 25 rows per page** (`RegisterTable` client paging, with a page-size control). Every item is loaded and reachable, because the API returns the full list (ADR-0071 §4), but they are not all on screen at once.
5. **The Arabic is provisional** (67 entries) until a qualified reviewer checks it. No `arabic-review.json` entry was added.

## 5. Open questions

1. **Shared files.** `i18n/index.ts`, `app/router.tsx` and `app/p7-shell.test.tsx` belong to FE-A, but each later FE task has to append to them. I followed FE-B's precedent. Please confirm, or move these lines in at merge.
2. **Key path deviation.** The §I.3 key `about.openItems` (the heading) is stored at `about.openItems.title`, because its children `about.openItems.dependency` and `.none` share the JSON tree, and a key cannot be both a string and an object. The work-split test maps it explicitly. Should the work split record this path?
3. **Placeholders.** The §I.3 `{rowCount}` and `{sha}` are written `{{rowCount}}` and `{{sha}}` (i18next syntax). The test normalises them when it compares against the work split.
4. **Merge instructions.** There is no migration and no API change. The new files are independent of FE-B's. Expect conflicts only in `router.tsx` and `p7-shell.test.tsx` if the slice E retention screens land at the same time: their filter must then also exclude the retention paths, and the placeholder sample in `p7-shell.test.tsx` becomes empty.
