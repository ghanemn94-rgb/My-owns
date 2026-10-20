# Handback T-DG5-FE-Z1B (frontend-ux-engineer): DG5 round-4 repair of F-DG5-146

- **Run:** `DG5-T-DG5-FE-Z1B-frontend-ux-engineer-20261020T192106Z-520c5433`, session `520c5433-a4d0-4f6c-ae23-c2169c9143c8`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-Z1B.md` (sha256 `ff7d0c84…490583`, verified).
- **Working tree:** `/home/user/wt/dg5-fe-z1`, branch `dg5/fe-z1`, starting `HEAD` `d63afd42a981dad4fca5b503ba842d417d111e8c` (the FE-Z1 WIP commit on top of `43cc85a`).
- **Time:** start `2026-10-20T19:22:28Z`, end `2026-10-20T19:54:33Z` (about 32 minutes).
- **Changes:** left **uncommitted**, as the assignment asks.
- **Evidence:** everything is under `docs/delivery/handbacks/DG5/T-DG5-FE-Z1B-evidence/` (written `E/` below).

## Summary

- **The fix (D-176).** Every table of the P5 form builder and form framework now scrolls inside the shared `TableScrollRegion` (focusable, `role=region`, named in en and ar):
  - the Form builder's field table;
  - the form framework's Attachments and History tables;
  - the export preview.
  The unstyled class `table-scroll` is gone from the source.
- **The unit guard** now refuses:
  - the class `table-scroll`;
  - any `table.table` / `table--compact` rendered outside a scroll region.
  It failed before the fix and passes after it.
- **DB-free reproduction.** The product's own component renders are laid out in real Chromium with the built CSS.
  - Before the fix: the page overflows in 16 of 44 cases, by up to 562 px. These are exactly qa's figures.
  - After the fix: 0 cases, max 0 px.
- **The e2e regression on the real stack is BLOCKED in this session.** The Bash sandbox has `user.max_user_namespaces = 0` and only uid 0 mapped, so the harness cannot start PostgreSQL as a non-root user (the D-176 condition). See "Checks" and "What remains".

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/form-builder/FormSchemaPage.tsx` | The field table is wrapped in `TableScrollRegion` (was `div.table-scroll`, a class with no CSS rule). |
| `apps/web/src/components/form-framework/FormFramework.tsx` | The Attachments table (had no wrapper) and the History table (had no wrapper, same class of defect) are wrapped in `TableScrollRegion`. Most of the diff is Prettier re-indenting the two wrapped tables. |
| `apps/web/src/components/form-framework/ExportDialog.tsx` | The export preview's `div.table-scroll` is replaced by `TableScrollRegion` (D-176 "Remove `table-scroll`"; see note 1). |
| `apps/web/src/components/table-regions.test.tsx` | The guard is extended: no `table-scroll`; every `table.table` / `table--compact` is inside a region (TSX syntax tree, not regex). |
| `apps/web/e2e/p5-form-tables-reflow.spec.ts` | The FE-Z1 WIP spec, reviewed and kept, with two corrections (see F-DG5-146 → regression test). |

**Note 1: ExportDialog.** `ExportDialog.tsx` is not one of "the two components" named in the ownership line. It is the third use of the same unstyled `div.table-scroll`, which F-DG5-146 itself names (`ExportDialog.tsx:125`), and it sits in the form-framework component folder. D-176 requires "Remove `table-scroll`", and the guard must refuse that class, so the binding scope cannot be met without this 3-line change. I flag it here so the orchestrator can confirm.

No other file changed. There is no CSS change, no new i18n key, no contract or schema change and no dependency change.

## F-DG5-146: cause, fix, regression test

**Cause.**
- `FormSchemaPage.tsx:234` wrapped the field table in `div.table-scroll`, and no stylesheet defines `.table-scroll`, so the div was not a scroll container. The table (642 px en / 601 px ar at 390 px for a draft) widened its card and the page.
- `FormFramework.tsx:1001` rendered the Attachments `table.table--compact` with no wrapper at all.
- The History table (`FormFramework.tsx:760`) and the export preview (`ExportDialog.tsx:125`) had the same two shapes.
- The old guard only checked elements that already had the class `table-wrap`, so it could not see any of these.

**Fix.** Each table is wrapped in FE-X1's `TableScrollRegion`. That gives `.table-wrap` (`overflow-x: auto`), `tabIndex 0`, `role=region` and `aria-label` = the localized caption + "(scrollable table)" (`common.table.scrollRegion`).
- `apps/web/src/pages/form-builder/FormSchemaPage.tsx:31` (import), `:234-236` and `:287`: the field table, caption `forms.schema.caption`.
- `apps/web/src/components/form-framework/FormFramework.tsx:26` (import), `:760-762` and `:792`: History, `forms.history.caption`.
- `apps/web/src/components/form-framework/FormFramework.tsx:1004-1006` and `:1062`: Attachments, `forms.attachments.caption`.
- `apps/web/src/components/form-framework/ExportDialog.tsx:15` (import), `:126-127` and `:162`: the export preview, `forms.export.caption`.
  - The table keeps its export-language `dir`/`lang`.
  - The region's name is in the UI language.

### Regression test 1: the unit guard (`table-regions.test.tsx`), run before and after

New tests in the `no bare table wrapper in the web source` block:
- `:186` **no element uses the class `table-scroll`**.
- `:209` **every `table.table` / `table--compact` is rendered inside a scroll region**.

How the guard works:
- **Parsing.** Every `.tsx` source file is parsed with the TypeScript compiler's TSX parser (`typescript` 6.0.2, the root devDependency the build already uses; `apps/api` tests import it the same way). There is no new dependency and no lockfile change. The scan reads about 115 tables in under a second.
- **What counts as a region:** an enclosing JSX element that is `TableScrollRegion`, the P3 `TableRegion` or a `.table-wrap` element. The existing test at `:115` keeps checking that every `.table-wrap` is a focusable, named region.
- **Tables at a component's root.** Where a table's own JSX has no region (for example a render prop inside `QueryState`), the guard follows the component to its call sites in the same file, and every call site must be inside a region. This is how EvidenceRegisterPage's `Versions` passes: it is nested in a cell of the evidence-register table, which sits in a named `.table-wrap` region.
- **Set-up check:** the scan must see more than 100 tables, so a broken parser cannot pass trivially.

Results:
- **Before the fix** (`E/03-unit-guard-before-fix.log`, exit 1): 2 failed and 7 passed.
  - `table-scroll` uses: `components/form-framework/ExportDialog.tsx:125` and `pages/form-builder/FormSchemaPage.tsx:234`.
  - Outside a region: `ExportDialog.tsx > ExportPreview`, `FormFramework.tsx > AttachmentsTab`, `FormFramework.tsx > HistoryTab` and `FormSchemaPage.tsx > FieldsTable`, beyond the four listed pre-P5 tables.
- **After the fix** (`E/04-unit-guard-after-fix.log`, exit 0): 9 of 9 pass.

**The guard's closed list `OUTSIDE_P5_PENDING`** (`table-regions.test.tsx:202`) holds four pre-P5 tables outside my file ownership. The test compares the list *exactly*, so:
- a new bare table fails the test;
- fixing (or renaming) a listed table also fails it until the list shrinks.

The four tables:
- `components/RecordForm.tsx > FormConflict` and `components/States.tsx > ConflictPanel`: the 409 compare table in the `.conflict` banner (DG1/DG2). D-174 already stops it from widening the page (single `minmax` grid track), and `p5-diagnose-reflow.spec.ts` test 2 measures a real 409 at 390 px. My DB-free run confirms page overflow 0 for it (dumps 002/009).
- `pages/admin/UsersPage.tsx > UserEdit` (DG1) and `pages/define/DefinePage.tsx > GoodOutcomeTest` (DG2): no reflow measurement exists for these.

This is a known deviation from the literal "refuses **any** `table.table` … outside a region": the strict file ownership forbids me to edit these files. See "What remains".

### Regression test 2: the e2e spec `apps/web/e2e/p5-form-tables-reflow.spec.ts` (real stack)

Its final assertion is the finding's own condition, `document.documentElement.scrollWidth - innerWidth <= 1`. On each screen, at 390 x 900 and at 1280 x 900 with the root font at 200 %, in chromium-en and chromium-ar, it also checks:
- the table is in a `.table-wrap` with `tabIndex 0`, `role=region` and a non-empty name;
- the region fits the viewport.

The screens:
1. The Form builder `/admin/forms/T03`: a draft with an extension field added through the builder, as the SYNTHETIC methodology administrator.
2. The auditor's read-only view of the newest published version.
3. The T14 Attachments tab with one attachment.
4. The T14 export preview.

Set-up checks:
- the table is rendered with rows;
- at 390 px the table is really wider than its region (not required for the export preview).

**Review of the FE-Z1 WIP file: kept, with two corrections.**
- **The auditor view measured the wrong version.** `FormSchemaPage` opens the open draft by default whenever one exists (`fallback = sorted.find(isEditableDraft) ?? …`), and the test's own draft is still open during the auditor sweep. So the WIP spec would have measured the draft, not "the auditor's read-only view of the published version" that the finding describes. The auditor now selects the published version explicitly (`:211`, `:220`) and the spec asserts:
  - `[data-state='read-only-version']` (`:221`);
  - that the draft's extension field is absent.
- **The export preview's "must scroll" set-up check contradicted the spec's own comment** ("reported, not required"). There is now a `mustScroll` parameter (`:89`, `:99`, `:119`), set to `false` for the export preview.

I checked every selector, route and API call in the spec against `p5-forms.spec.ts` and the source: the version picker label, `editable-draft`, the add-field dialog labels, the methodology-versions draft/discard/create calls, `[data-form-framework='T14']`, the tab and attachment controls, `[data-export='T14']` and `[data-export-rows]`. `pnpm -r typecheck` (which includes `tsconfig.e2e.json`) and lint pass.

**Failing before / passing after: BLOCKED in this session.**
- Both the before run (`E/01-e2e-BLOCKED-before-fix-unset.log`) and the after runs (`E/30-…`, `E/31-…`) end with `unshare: unshare failed: Operation not permitted`, exit 1. No test executed.
- `with-stack.sh` starts PostgreSQL through `unshare --user` when run as uid 0.
- In this sandbox:
  - `cat /proc/sys/user/max_user_namespaces` is `0`;
  - `/proc/self/uid_map` is `0 0 1`;
  - `setpriv --reuid=1000` fails with `setresuid failed: Invalid argument` (`E/01-sandbox-userns-blocker.log`).
- This is the condition D-176 records (`sandbox.allowNestedUserNamespaces`). I did not try to get around it.

### Regression test 3 (substitute evidence, runnable here): DB-free layout of the real components in real Chromium

How it was built: my own scripts, in `E/scripts/`. qa's round-4 approach was read, not imported, and nothing was cloned.
1. The product's own component tests `form-builder.test.tsx` and `form-framework.test.tsx` (24 tests, synthetic fixtures) ran through `unit-web` with a dump hook. The hook is attached from a scratch Vitest config, so no product file changed. It writes each rendered document.
2. `layout.mjs` lays each dump out in the pre-installed Chromium with the **built** `apps/web/dist` stylesheet and fonts (local server on port 23110/23111), at 390 x 844 and at 1280 x 900 with 200 % text.
3. It asserts `scrollWidth - innerWidth <= 1`, and that every `table.table` has a focusable, named scroll region.

Results:
- **Before the fix** (`E/02-dbfree-layout-before-fix.log`, `.json`; exit 1): 16 of 44 cases scroll the page. These match qa's numbers exactly:

  | View | 390 px (en / ar) | 200 % text (en / ar) |
  |---|---|---|
  | Form builder draft | 281 / 240 px | 562 / 478 px |
  | Read-only view | 174 / 143 px | 365 / 300 px |
  | T14 Attachments | 130 / 85 px | 269 / 183 px |

- **After the fix** (`E/05-dbfree-layout-after-fix.log`, `.json`; built after the fix): **0 of 44 cases scroll the page (max 0 px)**.
  - The tables keep their widths (642/601/535/504/491/446 px) and scroll inside regions named "Fields of this form (scrollable table)" / "حقول هذا النموذج (جدول قابل للتمرير)" and "Evidence attached to this record (scrollable table)" / "الأدلة المرفقة بهذا السجل (جدول قابل للتمرير)".
  - **Why the script still exits 1.** 4 cases fail only its stricter structural check. They are the 409 compare table (`ConflictPanel`, dumps 002/009), which is in the guard's pending list and has page overflow 0.
- **Keyboard interaction check** (`E/06-dbfree-shots-and-keyboard.log`, exit 0): all 6 after-fix screens PASS (form builder draft and read-only view, T14 attachments; en and ar).
  - Tab from the page start reaches the region.
  - The focus outline is visible: `solid 3px rgb(0, 109, 233)`.
  - Four presses of ArrowRight (en) / ArrowLeft (ar) scroll the region (scrollLeft `0 → 160` / `0 → -160`; attachments ar `0 → -116`) while page `scrollX` stays 0.
  - The first attempt (`E/06a-…first-attempt.log`, exit 1) read `scrollLeft` immediately after the key presses and saw 0. Chromium animates keyboard scrolling, so that was a measurement artefact. The script now waits for the position to settle. Both logs are kept.
- **Limitation:** jsdom-rendered markup of the real components with the real built CSS, not the running stack. The real-stack confirmation is the BLOCKED e2e above.

## Screenshots (DB-free renders, 390 px; my own, D-162)

All in `E/shots/`:
- **Before:** `before-form-builder-{draft,readonly}-{en,ar}-390.png`, `before-t14-attachments-{en,ar}-390.png`. The page is shifted sideways, and the card and table are cut off.
- **After:**
  - `after-…-390.png`: the card fits the viewport and the table is clipped inside its region.
  - `after-…-390-focused-scrolled.png`: the region with its focus ring, scrolled by the keyboard.

The matching DOM dumps are in `E/dumps/{before,after}/`. **No real-stack Playwright screenshots exist (BLOCKED).** The spec writes `z1-*` shots under `E2E_SCREENSHOT_DIR` when it runs.

## Checks

| # | Command | Environment | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | worktree, offline | `PASS gate DG4 (historical)`, **exit 0** | `E/00-validate-dg4-historical-start.log` |
| 1 | `pnpm -r typecheck` | Node 24.21.0 | **exit 0** | `E/10-typecheck.log` |
| 2 | `pnpm -r build` | Node 24.21.0 | **exit 0** (Vite's chunk-size advisory is pre-existing; it is in earlier DG5 build logs, e.g. `T-DG5-BE-D-evidence/build.log`) | `E/11-build.log` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | | **exit 0** | `E/12-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | | **exit 0**, "All matched files use Prettier code style!" | `E/13-prettier.log` |
| 5 | `pnpm openapi:lint` | | **exit 0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `E/14-openapi-lint.log` |
| 6 | `npx vitest run --project unit-web` with LANG/LC_ALL/LC_CTYPE unset | | **exit 0**, 90 files, **1713 passed** | `E/20-unit-web-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` (after #6, not in parallel) | | **exit 0**, 90 files, **1713 passed** | `E/21-unit-web-C.UTF-8.log` |
| 8 | guard before the fix: `npx vitest run --project unit-web apps/web/src/components/table-regions.test.tsx` | | **exit 1** as expected: 2 failed / 7 passed | `E/03-unit-guard-before-fix.log` |
| 9 | the same, after the fix | | **exit 0**, 9 passed | `E/04-unit-guard-after-fix.log` |
| 10 | DB-free layout, before / after | Chromium (`/opt/pw-browsers`), built dist | before **exit 1** (16 page overflows); after **exit 1** (0 page overflows; 4 structural hits = the listed 409 compare table, see above) | `E/02-…`, `E/05-…` (.log, .json) |
| 11 | DB-free keyboard and screenshots | Chromium | **exit 0**, 6 of 6 PASS (first attempt exit 1, timing artefact, explained above) | `E/06-…`, `E/06a-…` |
| 12 | `with-stack.sh npx playwright test p5-form-tables-reflow.spec.ts --workers=1` before the fix (locale unset) | ports 23100/23101, pool 23102-23149 | **BLOCKED**, exit 1 (`unshare failed: Operation not permitted`); no test ran | `E/01-e2e-BLOCKED-before-fix-unset.log`, `E/01-sandbox-userns-blocker.log` |
| 13 | `with-stack.sh npx playwright test p5-form-tables-reflow p5-table-regions-axe p5-reflow-axe p5-forms --workers=1` (chromium-en and -ar), locale unset | same | **BLOCKED**, exit 1; no test ran | `E/30-e2e-BLOCKED-locale-unset.log` |
| 14 | the same with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | same | **BLOCKED**, exit 1; no test ran | `E/31-e2e-BLOCKED-C.UTF-8.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | | `PASS gate DG4 (historical)`, **exit 0** | `E/40-validate-dg4-historical-end.log` |

**Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They run once on the merged tree in the orchestrator's verification. This run reports none of them as passed.

**Acceptance item 3 is not met in this run.** The four e2e specs (en and ar, both locale settings) are BLOCKED by the sandbox, so I report no count for them.

Static expectations for the orchestrator's real-stack run:
- `p5-forms.spec.ts` selects `[data-attachment-count='1'] [data-status='active']` and `[data-export-rows]`; descendant selectors still match through the added wrapper.
- `p5-table-regions-axe.spec.ts` requires every `.table-wrap` in `main` to be a focusable, named region, which the new regions are.

## Other P5 tables checked (D-176 "check that no other P5 table is affected")

**Method.** The guard scans all 115 `table.table` / `table--compact` elements in `apps/web/src` (non-test `.tsx`).
- 106 have an enclosing region:
  - 73 `.table-wrap` regions;
  - 18 `TableScrollRegion`;
  - 15 P3 `TableRegion`.
- 1 is nested in a region through its same-file call site (`pages/reports/EvidenceRegisterPage.tsx > Versions`, in a cell of the evidence-register table inside the named `.table-wrap` at `EvidenceRegisterPage.tsx:111`).
- After the fix, only the four listed pre-P5 tables remain.

**P5 page directories covered by that scan** (each table there is inside a region): automation, studio, procedure-builder, procedures, reports, exports, branding, health-check, health-schemes, kpi-restatement, launch-plan, methodology-migrations, approval-routes, cutoff-pack, financial-metrics, source-coverage, formula-preview, playbook, walkthrough, admin/jobsOperations, form-builder.

**The P5 form framework** (`components/form-framework/`): the History, Attachments and export-preview tables are now in regions. They were the only three.

**Rendered evidence:**
- In the DB-free run, every table in the 44 form-builder/form-framework cases has page overflow 0 after the fix.
- The T14 export-preview dumps (007/014) show the benefit's allocation/values tables already in regions. The export dialog itself was closed by the end of that unit test, so its preview is covered by the guard and the (BLOCKED) e2e spec, not by a DB-free render.

## Shared rules (p5-work-split §2)

The change is presentational only:
- no mutation, endpoint, validation, concurrency, audit or arithmetic path changes;
- Unknown/Stale rendering is untouched (the export preview's Unknown chips are inside the same cells);
- the region names come from existing en/ar keys (`common.table.scrollRegion` with each table's existing caption).

## Contract, schema, dependency needs

None:
- no OpenAPI, zod, migration or dependency change;
- `typescript` (root devDependency, 6.0.2) is now also imported by a web unit test, as `apps/api` tests already do. The lockfile is unchanged.

## ADR / data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R7)

- **Untrue: none found.**
  - `grep` over `docs/architecture/**` finds no statement about `table-scroll`, `TableScrollRegion`, these tables' wrappers or reflow, apart from ADR-0050 line 518. That line says no ADR describes the Diagnose layout or the 409 banner, which remains true.
  - ADR-0041 describes the form framework's data and operations (history from `audit_event`, attachments, export), not its markup.
  - The data dictionary is unaffected.
- **Possibly incomplete, if the architect wants it recorded:** no ADR states the UI rule D-176 now enforces mechanically ("every table is rendered inside a focusable, named scroll region; `table-wrap` without `TableScrollRegion`/`TableRegion` markup is refused").

## User-facing texts made untrue

None:
- No visible text changed.
- The new regions' accessible names are existing translations (en "… (scrollable table)", ar "… (جدول قابل للتمرير)") built from each table's existing caption.
- Nothing claims anything about these tables' layout.

## What remains

1. **The real-stack e2e is BLOCKED:** `p5-form-tables-reflow.spec.ts` (failing-before and passing-after) and the acceptance specs `p5-table-regions-axe`, `p5-reflow-axe` and `p5-forms`, in chromium-en/-ar and both locale settings. They need a sandbox where `with-stack.sh` can start PostgreSQL as a non-root user (nested user namespaces, D-176).
   - **The failing-before e2e output cannot be produced after this change unless it is run on the pre-fix tree.** To record it, the orchestrator can run the spec against `d63afd4` (it is identical in behaviour except for the two corrections above). The DB-free before/after (`E/02`, `E/05`) and the guard before/after (`E/03`, `E/04`) are the failing-before / passing-after evidence actually produced here.
2. **Four pre-P5 tables outside a region**, outside my ownership: `RecordForm.tsx > FormConflict`, `States.tsx > ConflictPanel`, `UsersPage.tsx > UserEdit` and `DefinePage.tsx > GoodOutcomeTest`.
   - They are pinned in the guard's exact list `OUTSIDE_P5_PENDING`, so the literal D-176 wording "any `table.table` … outside a region" is met only for everything else.
   - The two conflict tables do not widen the page (D-174, measured).
   - UserEdit and GoodOutcomeTest have no reflow measurement. Wrapping each in `TableScrollRegion` is a two-line change per file. It needs an owner (orchestrator's decision), and then the matching entries leave the list.
3. **Ownership note:** `ExportDialog.tsx` was changed beyond "the two components" (see note 1), because D-176 requires removing `table-scroll`.

## Merge instructions

- No migrations, no ordering constraints and no generated files.
- The five source files merge independently. `FormFramework.tsx` has a large whitespace-only re-indent around the two wrapped tables, so expect textual conflicts only with concurrent edits to `HistoryTab` / `AttachmentsTab` (none expected: D-176 names this as the only repair task).
- After merging, run `pnpm -r build` before the e2e specs, since the specs run against the built `apps/web/dist`.
- The evidence scripts in `E/scripts/` are not product code. `vitest.dump.config.ts` contains this run's absolute scratch path for the dump hook; adjust it to re-run.
- The untracked top-level dotfiles (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, …) were in the worktree before this run. They are not mine.

Engineering note: no product gate G1–G6 and no engineering gate DG0–DG7 is affected or claimed by this work. All data in the tests and screenshots is synthetic.
