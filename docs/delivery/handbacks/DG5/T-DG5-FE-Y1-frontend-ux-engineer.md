# Handback T-DG5-FE-Y1 (frontend-ux-engineer): DG5 repair wave Y, F-DG5-144

- **Stage / gate:** P5, DG5, FIXING after review round 3 (D-174).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-Y1-frontend-ux-engineer-20261019T044618Z-beb4539a","session_id":"beb4539a-3d50-4a0b-92a7-c9f137b6b706"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-Y1.md`, sha256 `dba663a0…3576c` (verified).
- **Working tree:** `/home/user/wt/dg5-fe-y1`, branch `dg5/fe-y1`, base `HEAD` `24a803d`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-19T04:46:34Z`; finished `2026-10-19T06:06:04Z`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the start (`PASS gate DG4 (historical)`, `T-DG5-FE-Y1-evidence/00-validate-historical-DG4-start.log`) and at the end (`99-validate-historical-DG4-end.log`).

No business, Finance or IT approval is granted or implied. All data is synthetic. Product gates G1–G6 and engineering gates DG0–DG7 are not touched.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/styles/app.css` | **F-DG5-144:** `.workstreams` gets one `minmax(0, 1fr)` track, and its cards are shrinkable (lines 1319–1330). **The same pattern** on the optimistic-concurrency conflict banner `.conflict` (lines 928–945; see §2.2). |
| `apps/web/e2e/p5-diagnose-reflow.spec.ts` (new) | The product regression test. It is qa's R3-DIAG reproduction turned into assertions, plus one test for the conflict banner. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-Y1-frontend-ux-engineer.md` and `T-DG5-FE-Y1-evidence/**` | This handback, its logs, the scratch probes I used for the container audit, and my own spec's screenshots. |

No other file is changed:

- no TSX markup: the Diagnose page component is unchanged, because the fix needed no markup change;
- no contract, schema, migration, dependency or i18n string.

## 2. Findings

### 2.1 F-DG5-144 (Medium, REQ-S15-009; reported by qa-verifier)

**Cause.**

- `.workstreams` was `display: grid` with no `grid-template-columns`. Its one implicit track was `auto`, and its items (`article.workstream`) had the default `min-inline-size: auto`.
- An `auto` minimum track uses each item's automatic minimum size, which is its min-content. The Customer card holds a 7-column findings register, whose `<table>` min-content is about 794 px at 390 px (en). That sized the track, and with it all six cards.
- The existing rule `.workstream > * { min-inline-size: 0 }` targets the card's children. Those are block children of a block, so the rule has no effect there. Nothing constrained the grid items or the track.

**Fix** (`apps/web/src/styles/app.css`):

- `:1323–1327` `.workstreams { display: grid; grid-template-columns: minmax(0, 1fr); gap: … }`: the track never grows to its items' min-content.
- `:1328–1330` `.workstreams > .workstream { min-inline-size: 0; }`: the cards are shrinkable.
- `:1319–1322` a comment that names the finding and D-174.

The cards now take the column's width, and each register scrolls inside its existing `TableScrollRegion` (FE-X1): `div.table-wrap`, `tabIndex=0`, `role=region` and a localized `aria-label`. Nothing else on the page changes, in en or ar.

**A note on qa's in-browser check.** qa's finding says that injecting `.workstreams > * { min-inline-size: 0 }` in the browser did not remove the overflow. My sweep probe (`probe/sweep.probe.ts`, `diagnoseVariants` in `probe/sweep-{en,ar}.json`) injected the *original* rules into the fixed page after load, and also measured 0 px with a 332 px track. Chrome evidently does not redo the grid's intrinsic sizing for a stylesheet injected after layout. Both injected measurements, qa's and mine, are therefore unreliable. Only from-load measurements, as in the regression test, are meaningful. The fix sets both the track and the item minimum, as D-174 asks, so it does not depend on which of the two alone would have been enough.

**Regression test** (`apps/web/e2e/p5-diagnose-reflow.spec.ts:41`): "Diagnose: no page-level horizontal scroll at 390 px or with 200 % text; …".

- **Source:** qa's R3-DIAG reproduction, read and not imported.
- **Set-up:** on the demo stack, `/transformations/01995000-…0001/diagnose` as `roaming.user.tl`. On the production-marked stack, a transformation the test creates, with two synthetic findings, as `dev.lead`. The stack is detected with `GET /environment` (`synthetic`), as `p5-table-regions-axe` does, so the spec has no skipped test on either stack.
- **Viewports:** 390 x 900, and 1280 x 900 with the root font at 200 %, in chromium-en and chromium-ar.
- **Assertions:**
  - `document.documentElement.scrollWidth - innerWidth <= 1`;
  - every `article.workstream` lies inside `[-1, innerWidth + 1]`;
  - every `.table-wrap` in a card is `tabIndex 0`, `role=region` and named.
- **Set-up check:** at 390 px, at least one workstream register really scrolls inside its region (the finding's condition). The test therefore cannot pass on data that never overflows.
- **Final assertion:** it collects every case, then asserts once with `expect(failures).toEqual([])` (`:138`).

**Failing before the fix.** Demo stack, locale unset, on the round-3 tree with only the spec added (`01-before-fix-demo-unset.log`): 2 failed.

- **en:** "the page scrolls 433 px" at 390 px. The six cards are at `[29..823]`. With 200 % text, 830 px, and the cards at `[593..2110]`.
- **ar:** 394 px; the cards are at `[-394..361]`. With 200 % text, 731 px, and the cards at `[-731..687]`.
- **In both languages:** "set-up: no workstream register scrolls inside its region", because the card was wide enough to show the whole table.

These are qa's numbers exactly. This run used the first version of the spec. Later I added two element screenshots and the second test, and ran prettier; the assertions of this test are unchanged.

**Passing after the fix:**

- `01b-after-workstreams-fix-demo-unset.log`: 2 passed;
- the acceptance runs in §3, on both stacks and in both locale settings. Every one prints "390 px: overflow 0 px, 6 card(s), 1 region(s), 1 scrolling; 200 % text: overflow 0 px, …".

**Visual evidence** (`T-DG5-FE-Y1-evidence/shots/{en,ar}/`, from the demo-stack acceptance run):

- `y1-diagnose-reflow-390.png` and `-200pct.png` (full page);
- `y1-diagnose-reflow-390-card.png` and `-200pct-card.png` (the Customer card: it fits, and its register scrolls in its region).

### 2.2 The same pattern elsewhere (D-174): every grid or flex container in `app.css` checked

I used three methods:

1. **Static reading:** every `display: grid | inline-grid | flex | inline-flex` rule in `app.css` (88 containers), with its track definition.
2. **A static nesting scan** of the TSX (`$TMPDIR/nest.py`, not kept): which container classes lexically contain a `<table>`, `RegisterTable`, `TableScrollRegion` or `*Table` component.
3. **A runtime sweep** on the demo stack (`probe/sweep.probe.ts`, output `probe/sweep-{en,ar}.json` and `probe/sweep.log`):
   - 119 routes (73 transformation routes of the roaming transformation and 46 global routes) at 390 px and with 200 % text, in en and ar;
   - as `roaming.user.tl`, falling back to `roaming.user.adm_access` on no-permission;
   - for every grid or flex container in `main` that holds a `.table-wrap`, it checks whether any item sticks out of the container;
   - it also records the page overflow.

**The sweep's results (en and ar each):**

- 238 screen-widths.
- 0 with page overflow > 1 px.
- 120 screen-widths had table regions.
- The only grid or flex containers that hold a table region on rendered data are `div.page` (120 screen-widths), `div.grid.grid--2` (4) and `div.workstreams` (2). None has an item overflowing it.
- 12 (en) and 10 (ar) screen-widths rendered no `h1` for these demo users: `/admin`, `/admin/users`, `/admin/calendar`, `/admin/jobs`, `/governance/groups`, and `/admin/assignments` in ar. They are not measured by the sweep. `/admin/organizations` and the other admin screens are covered by `p5-table-regions-axe`.

**Result per container:**

| Container (app.css) | Track | Can an item hold a register or wide table? | Result |
|---|---|---|---|
| `.workstreams` | was implicit `auto` | yes (the findings register) | **Fixed** (F-DG5-144) |
| `.conflict` (409 banner, `components/States.tsx` and `RecordForm.tsx`) | was implicit `auto` | **yes**: a bare compare `<table>` with `nowrap` headers is a direct grid item | **Fixed** (see below) |
| `.page` | implicit `auto` | yes, every section | Safe: `.page > * { min-inline-size: 0 }` already applies, and each register is in a scroll region. Sweep: 120 screen-widths, 0 overflow. |
| `.app-body` | `16rem minmax(0, 1fr)`; `minmax(0, 1fr)` ≤ 900 px | yes (`main`) | Safe: `minmax(0, …)`, and `.app-main` has `min-inline-size: 0`. |
| `.grid`, `.grid--2`, `.grid--3` | `repeat(auto-fit, minmax(16rem / 14rem, 1fr))` | yes (`.grid--2` holds tables on 4 screen-widths) | Safe: a fixed track minimum means the automatic minimum does not apply and the fr size comes from the container. Sweep: 0 overflow. Bare `.grid` holds no table in the scan or the sweep. |
| `.form` (`form--inset` in FinancialMetricsPage) | implicit `auto` | yes, a `.table-wrap` as a direct item | Safe: the item is a scroll container (`overflow-x: auto`), so its automatic minimum is 0. Not changed, to keep form fields untouched. |
| `.details`, `.workspace-header__grid` | `repeat(auto-fit, minmax(14rem / 12rem, 1fr))` | no table (scan and sweep) | Not affected |
| `.tom-canvas`, `.gate-list`, `.role-list`, `.phase-stepper` | fixed-minimum or `minmax(0, …)` repeats | no table | Not affected |
| `.role-card` (and its 1fr media rule), `.tom-box`, `.thesis`, `.thesis-block`, `.charter-fields`, `.outcome-tree`, `.journey-steps`, `.steps-editor`, `.p4-message-list`, `.ff-fieldset`, `.ff-comments`, `.form-section`, `.plain-fieldset`, `.field`, `.mode-guidance`, `.value-totals`, `.dialog`, `.dialog__body`, `.form--dialog`, `.workspace-header`, `.page-header`, `.login*`, `.dev-login`, `.column-picker__panel`, `.dialog-backdrop`, `.app-nav__list`, `.app-nav__sublist`, `.tom-box__facts`, `.tom-box__num` | implicit `auto` | no table nested (scan; sweep found none) | Not affected |
| All flex containers (`.app-header`, `.card__header`, `.toolbar`, `.filters`, `.filters__group`, `.pager`, `.section__actions`, `.row-actions`, `.p4-subnav`, `.p4-message`, `.ff-tabs`, `.sourcing-summary`, `.state`, `.conflict__title`, `.dialog__footer`, `.form__actions`, `.page-header__row`, `.page-header__actions`, `.breadcrumbs ol`, `.workspace-tabs__list`, `.section-nav__list`, `.chips`, `.p4-chips`, `.outcome-card__head`, `.role-card__header`, `.phase-stepper__step`, `.user-box`, `.app-nav__link`, `.field__error`, `.radio-card`, `.checkbox`, `.button*`, `.sort-button`, `.lifecycle-chip`, `.chip-row`, `.filter-chip`, `.pager__size`, `.p4-inline-field`, `.wordmark`, `.language-switch`, `.filters__search` / `__select` (grid)) | — | no table as an item (scan hits for `.section__actions`, `.field` and `.state` were parse spill-over; the `.state`/`.conflict` hit is the banner fixed above) | Not affected |

**The conflict banner (same defect class, found by this audit):**

- **The defect.** `.conflict` is `display: grid` with an implicit `auto` track. Its compare table (Field / Your value (not saved) / Current saved value; the headers are `nowrap`) is a direct grid item with `min-inline-size: auto`, so the table's min-content sized the track.
- **Measured.**
  - A synthetic harness with the real built stylesheet (`probe/conflict.probe.ts`) gave, before the fix, at 390 px:
    - 176 px (en) and 97 px (ar) of page overflow with ordinary values;
    - 321 px and 274 px with a long unbroken value;
    - 0 with 200 % text at 1280 px.
  - Its console output was not saved to a file. The real-stack measurement is the evidence below.
- **Regression test** (`p5-diagnose-reflow.spec.ts:141`): "Conflict banner: a 409 at 390 px shows its compare table without page-level horizontal scroll".
  - It makes a real 409 on `/transformations/<T>/edit` (a concurrent `PATCH` through the real API with CSRF and `If-Match`, as `journeys.spec.ts` does), at 390 px, as `dev.lead`.
  - Set-up check: the compare table has a row.
  - It asserts a page overflow ≤ 1 px, and that the banner and its table lie inside the viewport (final assertion `:202`).
  - **Failing before** (`02-before-fix-conflict-demo-unset.log`): en "the page scrolls 46 px", table `[32..436]`; ar 6 px, table `[-6..358]`.
  - **Passing after:** every run in §3. en table `[32..362]`, ar `[28..358]`, overflow 0.
- **Fix** (`app.css:928–945`):
  - `:932–936` `.conflict { … grid-template-columns: minmax(0, 1fr); }`;
  - `:937–939` `.conflict > * { min-inline-size: 0; }`;
  - `:940–942` `.conflict .table thead th { white-space: normal; }` (headers wrap between words, inside the banner only);
  - `:943–945` `.conflict .table td { overflow-wrap: anywhere; }` (a long value without spaces wraps).

  Header and row-label cells deliberately do **not** get `overflow-wrap: anywhere`. My first version had it, and the ar screenshot showed الحقل / الاسم broken into separated letters. Arabic letters must stay joined, so I restricted it to `td`.
- **Why no scroll region here.** The table now fits the banner, so it does not scroll, and no non-focusable scrolling region is created. No markup change was needed: `States.tsx` and `RecordForm.tsx`, which are outside my ownership, are unchanged.
- **Screenshots:** `shots/{en,ar}/y1-conflict-reflow-390.png`.

## 3. Checks actually run (all in `/home/user/wt/dg5-fe-y1`, Node 24.21.0, offline, one at a time)

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `00-validate-historical-DG4-start.log` |
| 1 | `pnpm -r typecheck` | 0 | all packages Done | `10-typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages Done (vite chunk-size warning only, pre-existing) | `11-build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `12-lint.log` |
| 4a | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (first run) | **123** | one file: my new spec was not yet formatted | `13a-prettier-first-run-exit123.log` |
| 4b | `npx prettier --write apps/web/e2e/p5-diagnose-reflow.spec.ts`, then the same check | 0 | all files formatted | `13-prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (no contract change) | `14-openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE npx vitest run --project unit-web` | 0 | **90 files, 1711 / 1711 passed** | `20-unit-web-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | 0 | **90 files, 1711 / 1711 passed** | `21-unit-web-c-utf8.log` |
| 8 | demo stack (`e2e/support/with-demo-stack.sh`), locale unset: `p5-diagnose-reflow` + `p5-table-regions-axe`, `--workers=1` | 0 | **6 / 6 passed** (en and ar: 2 + 1 each) | `30-e2e-demo-locale-unset.log` |
| 9 | production-marked stack (`apps/web/e2e/support/with-stack.sh`), locale unset: `p5-diagnose-reflow` + `p5-table-regions-axe` + `p5-reflow-axe` + `p2-journeys`, `--workers=1` | 0 | **32 / 32 passed** (11.0 min). Per language: p2-journeys 12, p5-diagnose-reflow 2, p5-reflow-axe 1, p5-table-regions-axe 1 | `31-e2e-prod-locale-unset.log` |
| 10 | demo stack, `LANG=C.UTF-8 LC_ALL=C.UTF-8`: the same two specs | 0 | **6 / 6 passed** | `32-e2e-demo-c-utf8.log` |
| 11 | production-marked stack, `C.UTF-8`: the same four specs | 0 | **32 / 32 passed** (11.3 min); per language the same 12 + 2 + 1 + 1 | `33-e2e-prod-c-utf8.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `99-validate-historical-DG4-end.log` |

**Ports and outputs:**

- The stacks used harness ports 23100–23149 only.
- Screenshots went to `$TMPDIR` (D-162). Only my own spec's ten screenshots are kept, in `T-DG5-FE-Y1-evidence/shots/`.
- No failed, flaky or skipped test occurred in any acceptance run (8–11). The before-fix failures in §2 are the intended red runs.

**Also run (development and diagnosis; not acceptance):**

- `pnpm --filter ./apps/web build` three times, to rebuild the served bundle between fix iterations (exit 0 each).
- Intermediate spec runs on the demo stack: `01b-…` 2/2; a 4/4 run, `03-after-fix-demo-unset-dev.log`.
- The sweep probe: 2 passed, 17.6 min (`probe/sweep.log`).
- The conflict harness: en only, console output.

**Not run, D-164:** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They run once on the merged tree in the orchestrator's verification. None is reported as passed here.

## 4. Contract, schema or dependency needs

None. There is no new operation or response shape, no migration, no new dependency and no new i18n key.

## 5. ADR and data-dictionary statements, and user-facing texts

- **ADR and data dictionary (for T-DG5-ARCH-R6):** none made untrue or incomplete. I searched `docs/architecture/**` for statements about the Diagnose layout, the conflict banner's layout, scroll regions and reflow. ADR-0041 describes the 409 conflict view's behaviour ("theirs vs yours", re-apply), which is unchanged. No ADR describes these layouts.
- **User-facing texts:** none changed, and none made untrue. Only layout changed: the conflict banner's column headers may now wrap between words at narrow widths.

## 6. What remains, and observations

- **Nothing assigned remains.** Every acceptance check in the assignment ran and exited 0 (§3). Finished at `2026-10-19T06:06:04Z` (about 80 minutes).
- **Clean-up:** `test-results/`, `playwright-report/` and my `$TMPDIR` screenshots and outputs are removed. The stacks' temporary databases are removed by their own teardown. The untracked dotfiles at the worktree root (`.bashrc`, `.idea`, …) were present before I started and are not mine.
- **Observation, not changed: mid-word breaks in narrow registers.** In a narrow register the statement column (`.text-cell`, `overflow-wrap: anywhere`, pre-existing) breaks long English words inside the word, e.g. "complaint/s" in `shots/en/y1-diagnose-reflow-390-card.png`. The table now shrinks to its region instead of widening the card. This is the same behaviour every other register shows at 390 px, and the rest of the register scrolls inside its region. Changing `.text-cell` would affect every register, so it is outside this repair.
- **Merge instructions:** two files in `apps/web` (one modified, one new), plus this handback and its evidence.
  - No migration.
  - No conflict is expected with T-DG5-BE-Y1 (`packages/db/src/demo/**`) or T-DG5-BE-Y2 (`apps/api/src/architecture*`).
  - Rebuild `apps/web` before the e2e runs.
