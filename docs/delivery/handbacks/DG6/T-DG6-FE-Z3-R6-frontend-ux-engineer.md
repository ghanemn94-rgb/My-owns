# Handback T-DG6-FE-Z3 (frontend-ux-engineer), round-6 repair: an all-restricted report table hides its totals (F-DG6-440, Medium)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-Z3-frontend-ux-engineer-20261107T191902Z-0c5bc62d","session_id":"0c5bc62d-5b8c-4598-80c9-b241d142da6c"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-Z3.md`. I verified its sha256 `d300c7ed…5d964` before starting.
- **Base:** branch `dg6/fe-z3` at `9eee33177` ("DG6: D-219 scope of D-218"). The tree was clean at the start. My changes are **uncommitted**, as the assignment asks.
- **Time:** 19:19:15 to 19:54:56 UTC (`E/00-start-time.log`, `E/99-end-time.log`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` gives `PASS gate DG5 (historical)` and exit 0, both before the work (`E/00-validate-historical-DG5.log`) and at the end (`E/50-validate-historical-DG5-end.log`).
- **Scope:** web only. There is no API, worker, schema, migration, OpenAPI or dependency change.

Evidence folder: `docs/delivery/handbacks/DG6/T-DG6-FE-Z3-R6-evidence/`, written `E/` below.

## 0. Contradictions in the assignment (please confirm)

1. **Handback path.** The assignment names `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md`, with evidence in `T-DG6-BE-Z8-evidence/`.
   - Both of those already exist. They are backend-workflow-engineer's record of a different task (F-DG6-380).
   - The default path, `T-DG6-FE-Z3-frontend-ux-engineer.md`, is also taken, by this task id's round-4 handback (F-DG6-320/301/281).
   - I overwrote neither. This handback is `T-DG6-FE-Z3-R6-frontend-ux-engineer.md`, with evidence in `T-DG6-FE-Z3-R6-evidence/`. Please rename it at merge if you want a different path.
2. **Acceptance item 3 has backend boilerplate.** It lists the worker job, failure-queue, automation-recovery, operations and operational-exception integration files and the BE-Z6 race test. My change touches none of them, because it is a web rendering change only. I ran them anyway (§3), together with the reporting sensitivity integration file that covers the API side of this rule.
3. **Pending operations.** This repair routes no API operation, so there is no delta to a `p6-pending-*.ts` list.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/reports/ui.tsx` | **The fix, in `SectionView` case `'table'`.** The totals row (`<tfoot><tr data-totals="true">`) is now built once. When there are no rows but there are totals, the section still renders its table: the column header, one `<tbody>` row with a single cell (`td[data-empty-table=<key>]`, `colSpan` = every column) holding the empty text in the page language, and the totals row. The table keeps its focusable `role="region"` labelled by the heading and its hidden caption. This mirrors the exporters (`@mth/reporting` `sectionBlocks`: header, `empty`, `totals`). When there are no rows and no totals, the section shows the plain `<p data-empty-table>` text as before. Sections with rows are unchanged. |
| `apps/web/src/pages/reports/section-totals.test.tsx` (new) | A unit test of SectionView through `ReportDocumentView`, which is the component the live preview, the snapshot page and presentation mode all render. It runs en and ar, 3 tests per locale. (1) Every row restricted: the label shows; the region is labelled by the heading and focusable; the table is named; it has 3 column headers; the empty text sits in a `td` with `colSpan` 3; there is no record row; there is one totals row whose row header reads "Total"/"الإجمالي"; its text is byte-identical to the admitted section's totals row; and the Provisional chip is kept. (2) No rows and no totals: the plain empty text and no table. (3) Rows without totals: no empty cell and no `tfoot`. |
| `apps/web/e2e/p6-report-restricted-totals.spec.ts` (new) | The QA probe ported into a product e2e spec on the real demo stack, chromium-en and chromium-ar. The details and its budget are in §2. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-Z3-R6-*` | This handback and its logs and screenshots. |

## 2. Behaviour delivered

### REQ-S10-002 (F-DG6-440)

> Acceptance: "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"

The finding's binding rule is ADR-0051 §2 "Totals and rollups" with its 2026-11-06 amendment, and D-195 Q3: table totals are the same for every reader.

- **The literal clause still holds.** A reader who is not admitted sees no row of the benefit and no trace of its id in the DOM. The e2e spec asserts both, on the live preview and on the snapshot page.
- **The totals are now on screen.**
  - A section whose every row is restricted for the reader now shows its totals row, identical to the admitted reader's, with "Includes restricted records" / "يشمل سجلات مقيدة". Its empty text "No records" / "لا توجد سجلات" sits inside the table, above the totals.
  - Demo data: the TL now sees "Revenue uplift" with Total SAR 222,750.00 · Validated by Finance and SAR 99,000.00 · Submitted (pending Finance validation), Provisional.
  - Measured counts: TL 3 totals rows, TO 3, and TL before marking 3. Before the fix they were TL 2, TO 3, before 3.
- **The e2e spec**, `apps/web/e2e/p6-report-restricted-totals.spec.ts`, runs on `e2e/support/with-demo-stack.sh`.
  - roaming.user.to marks demo benefit B01 sensitive.
  - **API:** every table section's totals are equal for TL and TO, and the TL has no row of B01. The spec finds the sections that have rows for the TO, none for the TL and totals (here `totals_sar_revenue_uplift`), and asserts their `includesRestrictedRecords` is true.
  - **Live preview on screen:** the TL has no B01 row and the TO does; the TO has no label; and the TL's totals rows equal the TO's and the TL's own rows before the marking. In each fully restricted section there are the label, the header, the empty cell with a `colspan` equal to the column count, one totals row with a "Total" row header, and a text equal to the TO's.
  - **Snapshot page:** the TO generates a registers/benefits snapshot. When the TL opens it, the same checks hold and its totals rows equal the TO's.
  - **Both pages:** html `lang`/`dir` match the language, and axe finds 0 serious or critical issues on the TL's live and snapshot screens. The benefit is unmarked in `finally`.
- **Budget, measured:** the spec sets 240 s. The loaded worst case was 10.1 s (chromium-en) while the full `pnpm test` ran on the same machine (`E/12-e2e-restricted-totals-loaded.log`). The unloaded runs took 8.7 s and 8.2 s (`E/11`). 240 s is more than 20× the loaded worst case.
- **Presentation mode** renders the same `ReportDocumentView`/`SectionView` (`PresentationPage.tsx:181`). The unit test covers that shared component. I wrote no presentation-specific e2e, because the existing `p5-reports-exports.spec.ts` "Presentation" test still passes (§3) and no demo meeting pack holds a sensitive benefit.

### The other section kinds (requested check)

- **`list`:** the API omits restricted items (`reports/restricted.ts`). A list section has no totals member (`packages/shared/src/schemas/report.ts` `listSection`), so an all-restricted list showing its empty text with the label withholds no aggregate. This is correct and unchanged.
- **`fields` / `metrics`:** the API never omits fields; only sources are filtered and the flag set. The `fields.length === 0` branch therefore cannot be reached through restriction, and metrics stay identical for every reader. Unchanged.
- **`text`:** nothing is omitted. Unchanged.
- **Exporters** (`packages/reporting/src/layout/blocks.ts`): they already render header, empty text and totals together. No change was needed, and exports stay refused for a reader who is not admitted (D-199).

## 3. Checks actually run

The environment for every check: Node 24.21.0, offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, ports 31051–31090 only.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | Unit, **before the fix** (`ui.tsx` from HEAD): `npx vitest run src/pages/reports/section-totals.test.tsx` | **exit 1** as expected. 2 failed (the "every row restricted" test in en and ar), 4 passed. | `E/01-unit-section-totals-before-fix.log` |
| 2 | Unit, after the fix: section-totals, restricted-labels and fee tests | exit 0, 35 passed | `E/02-unit-reports-after-fix.log` |
| 3 | e2e, **before the fix** (web rebuilt from the HEAD `ui.tsx`): `e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/p6-report-restricted-totals.spec.ts --workers=1` | **exit 1** as expected. 2 failed (en and ar) at "live: the TL's totals rows equal the TO's", with TL 2 totals rows, TO 3, before 3. | `E/10-e2e-restricted-totals-before-fix.log` |
| 4 | The same e2e after the fix | exit 0, 2 passed (8.7 s, 8.2 s) | `E/11-e2e-restricted-totals-after-fix.log` |
| 5 | The same e2e under load (alongside check 9) | exit 0, 2 passed (10.1 s, 9.8 s) | `E/12-e2e-restricted-totals-loaded.log` |
| 6 | `pnpm -r typecheck` | exit 0 | `E/20-typecheck.log` |
| 7 | `pnpm lint` | exit 0 | `E/21-lint.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `E/22-prettier.log` |
| 9 | `pnpm -r build` | exit 0 | `E/24-build.log` |
| 10 | `pnpm openapi:lint` | exit 0: "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations" | `E/23-openapi-lint.log` |
| 11 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL`) | exit 0. unit-node 190 files, 2899 passed; unit-web 123 files, 2077 passed; unit-formula-nocodegen 3 files, 259 passed and 2 skipped | `E/30-pnpm-test-locale-unset.log` |
| 12 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | exit 0, with the same counts as check 11 | `E/31-pnpm-test-cutf8.log` |
| 13 | `tests/qa/support/with-pg.sh npx vitest run --project integration` on 12 files (listed after this table) | exit 0, 12 files, 90 passed | `E/40-integration-touched.log` |
| 14 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1` | exit 0, 4 passed (en and ar) | `E/41-e2e-a22-a13.log` |
| 15 | Report-screen regression on with-stack.sh: `p5-snapshot-page`, `p5-reports-exports` (which includes Presentation), `p6-report-aggregate-label` and `e2e/a15-reporting` | exit 0, 16 passed (en and ar) | `E/42-e2e-report-screens-regression.log` |
| 16 | `node tools/gates/validate.mjs --historical --stage DG5` | exit 0, run at the start and at the end | `E/00-…`, `E/50-…` |

The 12 integration files in check 13:
- `access/sensitive-reach-dashboards-reports`
- `jobs/job-operations`
- `jobs/job-schedules`
- the worker's `automation-failure-queue`, `job-runs` and `operations-freshness`
- `operations/exceptions`
- `operations/exception-recurrence-race` (the BE-Z6 race test)
- `operations/concurrent-exception-recurrence`
- `operations/exception-last-known-value`
- QA's `a13-job-idempotency` and `a13-jobs-rerun`

Disclosures:
- **The two skipped tests** in unit-formula-nocodegen were already skipped; this change does not touch that project.
- **The first runs of checks 6 and 8 failed** (exit 2 and exit 123). The typecheck failure was TS4111 on the new spec's `Record<string, any>` body type, and prettier flagged the two new files. I switched to `any`, as `e2e/a02-demo-labels.spec.ts` does, and ran prettier `--write`. Every check in the table was re-run after those fixes and exits 0.
- **Timing of the budget comment.** Check 4 ran before the type-only edit to the spec, and check 5 ran after it. The only later edit to the spec is its budget comment line.

**Visual evidence** (Playwright full-page screenshots, synthetic demo data):
- `E/shots/en/fez3-tl-live-restricted-totals.png` and `E/shots/ar/fez3-tl-live-restricted-totals.png`: the TL's live preview, where "Revenue uplift" shows the label, "No records" inside the table, and the Total row.
- `E/shots/en/fez3-to-live-restricted-totals.png` and `E/shots/ar/…`: the TO's preview, with B01's row and no label.
- `E/shots/en/fez3-tl-snapshot-restricted-totals.png` and `E/shots/ar/…`: the TL's view of the stored snapshot, RTL in ar.

I inspected the en live preview and the ar snapshot by eye.

**Interaction and accessibility checks run:**
- The table region is focusable (`tabindex=0`) and labelled by the section heading.
- The table is named by its caption and has its column headers.
- The totals row header uses `scope=row`.
- The empty cell spans every column.
- axe finds 0 serious or critical issues on the TL's live and snapshot screens, in en and ar.
- The status is not shown by colour alone: the Provisional chip keeps its icon and text.

## 4. Operations routed, contracts, dependencies, migrations

- **Operations:** none routed, so the pending-list delta is empty.
- **Contract, schema, OpenAPI and zod:** no change. The fix uses the existing `totals` and `includesRestrictedRecords` members.
- **Dependencies:** none new.
- **Migrations:** none.

## 5. User-facing texts

No en or ar string became untrue, and I added no new string: the fix reuses `reportsP5.noRecords`, `reportsP5.total` and `access.includesRestrictedRecords`. The existing text `access…intro`, "Totals still include it for everyone, labelled 'Includes restricted records'", was untrue on screen for an all-restricted table before this fix, and is now true.

For the orchestrator and the analyst (not a user-facing string): the REQ-S10-002 analyst note in `docs/delivery/requirements.csv` quotes BE-Z7B residual (4), "A report table whose rows are all omitted shows the empty-table text, not its totals, on screen". This repair resolves it. The register is the analyst's file, and I did not edit it.

## 6. What remains

- F-DG6-440 stays OPEN until a non-author reviewer verifies it.
- No presentation-mode-specific e2e with a restricted section exists. That path is covered through the shared component's unit test and the unchanged presentation e2e (§2).
- Merge: no ordering constraints and no expected conflicts. Only `apps/web/src/pages/reports/ui.tsx` is modified; the other files are new.
