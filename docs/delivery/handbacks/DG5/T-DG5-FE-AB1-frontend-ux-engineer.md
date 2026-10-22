# Handback T-DG5-FE-AB1 — frontend-ux-engineer (DG5 round-6 repair, D-180)

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-AB1-frontend-ux-engineer-20261022T081211Z-6ab02e9f","session_id":"6ab02e9f-5ebf-4104-9f59-7485a3616b00"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-AB1.md`. I checked its sha256 at the start: `647f7a84…c1f95` (it matches).
- **Base:** branch `dg5/fe-ab1`, `HEAD` `befd9c8e820a720af845fd6f33cd923b72602634`. The tree was clean apart from untracked dotfiles at the root that I did not create (`.bashrc`, `.zshrc`, `.gitconfig`, `.idea`, `CLAUDE.local.md`, …). I left them alone.
- **Time:** started `2026-10-22T08:12:30Z`; ended `2026-10-22T09:07:08Z` (about 55 minutes).
- **Findings:** F-DG5-148 and F-DG5-149 (both Low, non-mandatory, REQ-S15-009). I close neither: qa-verifier or another non-author verifies them in round 7.
- **State:** changes are left **uncommitted** for the orchestrator.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits **0** (`PASS gate DG4 (historical)`), at the start (`00-validate-dg4-start.log`) and at the end (`40-validate-dg4-end.log`).

Evidence directory: `docs/delivery/handbacks/DG5/T-DG5-FE-AB1-evidence/` (below, `EV/`).

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/traceability/ui.tsx` | `RecordName` renders its code and label in one `<span class="record-name">`, so every Traceability record name wraps (F-DG5-148). |
| `apps/web/src/pages/traceability/ModularPage.tsx` | The missing-item label `· <name>` carries `record-name` (F-DG5-148). |
| `apps/web/src/pages/define/DefinePage.tsx` | The Good-outcome test table sits in `TableScrollRegion`. The region is focusable and named by the table's localized caption plus "(scrollable table)" (F-DG5-149). |
| `apps/web/src/styles/app.css` | Adds `.record-name { overflow-wrap: anywhere }` to the AA1 title-wrap rule, and `.outcome-tree > .outcome-node { min-inline-size: 0 }`. |
| `apps/web/src/components/table-regions.test.tsx` | `GoodOutcomeTest` comes off `OUTSIDE_P5_PENDING`, so the AST guard now requires the Define table to be in a scroll region. |
| `apps/web/e2e/p5-record-name-reflow.spec.ts` (new) | The real-stack regression for both findings: qa's R6-TITLE-B (Traceability and Modular part) and R6-DEFINE-NARROW turned into asserted product tests. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-AB1-*` | This handback and its logs and screenshots. |

There is no API, contract, schema, migration or dependency change, and no new i18n string.

## F-DG5-148: record names on Traceability and Modular entry

**Cause.** Two DG4 elements render user-entered record names in inline text with the default `overflow-wrap: normal`:

- `RecordName` (`traceability/ui.tsx`) inside the graph node link `li.trace-node > a.link` (TraceabilityPage);
- the Modular entry missing-item label `<span> · {label}</span>`.

A token with no break opportunity therefore overflowed its block and widened the document. qa's "trace panel record link" `a.link [46..1213]` is the graph node link in `TraceabilityPage.tsx:168-174`, which wraps `RecordName`.

**Fix.**

- `apps/web/src/pages/traceability/ui.tsx:115-131`: `RecordName` returns `<span className="record-name">…</span>` (it was a fragment). The fix therefore holds at every render site, not only the one qa measured.
- `apps/web/src/pages/traceability/ModularPage.tsx:234-235`: `<span className="record-name"> · {i.label}</span>`.
- `apps/web/src/styles/app.css:393-404`: `.record-name` joins the T-DG5-FE-AA1 title-wrap selector list (`overflow-wrap: anywhere`). `anywhere` also lowers the min-content width, so table columns can shrink to a scroll region's width. Auto table layout keeps max-content columns wherever the table fits, and ordinary text still breaks at spaces first.

**No `min-inline-size: 0` was needed here.** None of these render sites is a flex or grid item whose automatic minimum was the problem: the element was a block-level `li` whose inline text overflowed. The e2e result below confirms 0 px overflow.

**Every `RecordName` use** now gets the wrap through the component:

| Site | Context | Scroll region? |
|---|---|---|
| `TraceabilityPage.tsx:173` | graph node record link (`li.trace-node a.link`), the site qa measured | none (block list) |
| `TraceabilityPage.tsx:202`, `:214` | "from/to" link lists in the node's `<details>` | none (nested `ul`) |
| `TraceabilityPage.tsx:335` | orphan report table, row header link | in a region |
| `TracePanels.tsx:173` | impact panel records table, row header link | `.table-wrap` region |
| `TracePanels.tsx:371` | allocation members table, row header | region |
| `TracePanels.tsx:413` | allocation "without share" list item | none (`ul`) |
| `TracePanels.tsx:583` | trace links register (RegisterTable cell), record link | RegisterTable region |

**Regression test.** `apps/web/e2e/p5-record-name-reflow.spec.ts`, test 1 ("Record names with long unbroken text wrap on Traceability … and Modular entry …").

- **Data:** per language and per token (w120: a 120-character word; w46: `Synthetic_roaming_bill_shock_reduction_program`; arU: an unbroken Arabic token joined by underscores; plain: ordinary text), a SYNTHETIC transformation with one outcome `AB1 <token>`.
- **Where:** `/traceability` and `/modular-entry`, at 390, 360 and 320 × 900, and at 1280 × 900 with the root font at 200 %.
- **Set-up checks:**
  - the token is in `li.trace-node a.link` (Traceability) and in `ul[data-missing-items] > li` (Modular);
  - the token is in `main#main`.
- **Assertions:**
  - qa's final assertion, `document.documentElement.scrollWidth - innerWidth <= 1`;
  - no element whose text holds the token lies outside `[0, innerWidth]`, unless it sits inside a horizontal scroll container (in ar the overflow runs past the left edge).
- **Reporting:** all failures are collected and asserted once.

**Failing before** (spec run on the unchanged `HEAD` build; `EV/01-e2e-before-fix.log`, exit 1): tests 1 and 3, chromium-en and chromium-ar, failed.

Page overflow by token, screen and size (px):

| Token | Screen | 390 px | 360 px | 320 px | 200 % |
|---|---|---|---|---|---|
| w120 | Traceability | 823 | 853 | 893 | 1658 |
| w120 | Modular entry | 761 | 791 | 831 | 1589 |
| w46 | Traceability | 27 | 57 | 97 | 93 |
| w46 | Modular entry | 4 | 34 | 74 | 48 |
| arU | Traceability | 164 | 194 | 234 | 372 |
| arU | Modular entry | 137 | 167 | 207 | 307 |

Escaping elements were `a.link [46..1213]` and `span. [29..1151]`, and in ar `span. [-207..291]`. These match qa's R6 figures exactly.

An earlier run of the same spec (`EV/01a-e2e-before-fix-rev1.log`) failed identically for this test. I revised only the Define test after it (see F-DG5-149).

**Passing after** (`EV/04-e2e-after-fix-probe.log`, exit 0, 4 passed): every token, screen and size reads `overflow 0`, in en and ar.

## F-DG5-149: Define outcome card at 320–375 px

**Cause.** `.outcome-tree` is a CSS grid, and each outcome `li.outcome-node` is a grid item. A grid item's automatic minimum inline size is its content's min-content width. Here the widest content was the bare Good-outcome test table (`table.good-outcome__table`, not in any scroll region), so the card stayed about 352 px wide (`[29..381]`) and widened the page below about 381 px. The cause does not depend on the text.

**Fix.**

- `apps/web/src/pages/define/DefinePage.tsx:526` and `:544-571`: the table is wrapped in `<TableScrollRegion caption={caption}>`.
  - The caption string is shared with the table's visually hidden `<caption>`.
  - The region's accessible name is `common.table.scrollRegion` plus `define.goodOutcome.caption`. Both keys already exist in en and ar, for example "Good outcome test of “…” (scrollable table)" and "اختبار النتيجة الجيدة لـ «…» (جدول قابل للتمرير)".
- `apps/web/src/styles/app.css:1400-1405`: `.outcome-tree > .outcome-node { min-inline-size: 0 }`. The card now shrinks to the column, and the table scrolls inside its region. The rule covers nested trees too.

**Regression tests.**

1. `apps/web/e2e/p5-record-name-reflow.spec.ts`, test 2 ("Define: the outcome card with ordinary text fits …").
   - **Data:** qa's R6-DEFINE-NARROW set-up, one ordinary outcome "Synthetic: fewer roaming bill complaints".
   - **Where:** Define at 375, 390, 360 and 320 × 900, and at 200 % text.
   - **Assertions:**
     - qa's final assertion, `scrollWidth - innerWidth <= 1`, which is now asserted at every size (qa asserted it only at 390 px);
     - the outcome card is inside the viewport;
     - the table is inside exactly one `role=region` with `tabindex=0`, named by the localized caption.
   - **Failing before** (`EV/01-e2e-before-fix.log`):
     - en: overflow 6 px at 375 px, 21 px at 360 px and 61 px at 320 px; card `[29..381]`; no region at any size.
     - ar: 29 px at 320 px; card `[-29..291]`; no region.
     - These match qa's figures.
     - In the earlier run, `EV/01a-…`, the test stopped at a thrown `toHaveCount(1)` region check before it measured the overflow. I changed it to collect the region check with the other failures, so the overflow assertion is measured and reported too.
   - **Passing after** (`EV/04-…`): overflow 0 at every size in en and ar. Card `[29..291]` at 320 px and `[29..331]` at 360 px.
2. `apps/web/src/components/table-regions.test.tsx`: the table-in-region AST guard, with `pages/define/DefinePage.tsx > GoodOutcomeTest` removed from `OUTSIDE_P5_PENDING`.
   - **Failing before:** run with the guard updated and `DefinePage.tsx` temporarily restored to `HEAD`. Exit 1: `Tests 1 failed | 8 passed (9)`, with `+ "pages/define/DefinePage.tsx > GoodOutcomeTest"` (`EV/02-unit-table-regions-before-fix.log`).
   - **Passing after:** exit 0, 9 passed (`EV/03-unit-table-regions-after-fix.log`).

## Screenshots (visual evidence, en and ar)

My spec writes them to the git-ignored `apps/web/e2e/screenshots/<lang>/`. I copied the after-fix shots to `EV/shots/en/` and `EV/shots/ar/`:

- `p5-record-name-{w120,w46,arU}-{traceability,modular}-320.png`
- `p5-define-outcome-card-{320,360}.png`

I viewed these:

- `en/p5-define-outcome-card-320.png`: the card fits, and the table is in a bordered scroll region.
- `ar/p5-record-name-w120-traceability-320.png`: the 120-character link wraps across lines inside the Trace graph card.
- `ar/p5-record-name-arU-modular-320.png`: the Arabic token wraps in the missing-links list.

Following D-162, I keep only my own spec's screenshots. The other specs' shots are in the ignored directory and are not part of the change.

## Checks (exact commands, exit codes, counts)

Node 24.21.0, offline, ports 23200–23249. I ran each check once and one at a time.

| # | Command | Exit | Result / log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)`, `EV/00-validate-dg4-start.log` |
| 1 | `with-stack.sh npx playwright test apps/web/e2e/p5-record-name-reflow.spec.ts --workers=1` (before fix, revision 1) | 1 | 4 failed, `EV/01a-e2e-before-fix-rev1.log` |
| 2 | the same (before fix, final spec) | 1 | 4 failed, `EV/01-e2e-before-fix.log` |
| 3 | `npx vitest run --project unit-web src/components/table-regions.test.tsx` (pre-fix DefinePage) | 1 | 1 failed / 8 passed, `EV/02-…` |
| 4 | the same (fixed) | 0 | 9 passed, `EV/03-…` |
| 5 | `pnpm -r typecheck` | 0 | `EV/10-typecheck.log` |
| 6 | `pnpm -r build` | 0 | `EV/11-build.log` |
| 7 | `with-stack.sh … p5-record-name-reflow.spec.ts --workers=1` (after fix) | 0 | 4 passed, `EV/04-e2e-after-fix-probe.log` |
| 8 | `pnpm lint` | 0 | `EV/12-lint.log` |
| 9 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!", `EV/13-prettier.log` |
| 10 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`, `EV/14-openapi-lint.log` |
| 11 | `npx vitest run --project unit-web` (LANG/LC_* unset) | 0 | 90 files, **1713 passed**, `EV/20-unit-web-locale-unset.log` |
| 12 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | 0 | 90 files, **1713 passed**, `EV/21-unit-web-c-utf8.log` |
| 13 | `with-stack.sh npx playwright test <5 specs> --workers=1`, LANG/LC_* unset | 0 | **18 passed**, 0 failed, 0 flaky (12.1 min), chromium-en 9 + chromium-ar 9, `EV/30-e2e-locale-unset.log` |
| 14 | `with-stack.sh npx playwright test <5 specs> --workers=1`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | **18 passed**, 0 failed, 0 flaky (12.1 min), `EV/31-e2e-c-utf8.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `EV/40-validate-dg4-end.log` |

Rows 13 and 14 ran this command, with `E2E_PG_PORT`/`E2E_API_PORT` 23210/23211 (locale unset) and 23220/23221 (C.UTF-8):

```
apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p5-record-name-reflow.spec.ts apps/web/e2e/p5-title-reflow.spec.ts apps/web/e2e/p5-form-tables-reflow.spec.ts apps/web/e2e/p5-reflow-axe.spec.ts apps/web/e2e/p5-forms.spec.ts --workers=1
```

**Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They are reserved for the orchestrator's merged-tree verification. No integration path is reached by this change, which is web-only CSS and markup.

**Housekeeping:** before the tests I removed one empty `apps/web/.claude/.cc-writes` directory, as the assignment asks.

## Contract, schema and dependency needs

None. No operation, response shape, zod mirror, migration or dependency changed.

## ADR and data-dictionary statements made untrue or incomplete

I found none. A search of `docs/architecture/**` and `docs/api/**` for `GoodOutcomeTest`, `good-outcome`, `OUTSIDE_P5_PENDING`, `F-DG5-147` and the title-wrap rule returned no matches.

One optional note for T-DG5-ARCH-R7: if an ADR lists the title containers that wrap anywhere (the AA1 and D-178 list), it can add `.record-name`, which covers `RecordName` and the Modular missing-item label. The same applies to the Define Good-outcome table now sitting in a `TableScrollRegion`.

## User-facing texts

No text changed and none became untrue. The new region name reuses the existing en and ar keys `common.table.scrollRegion` and `define.goodOutcome.caption`. Its visible effect is a bordered, keyboard-scrollable table container on Define.

## Merge instructions

- Apply the uncommitted diff. There are no migrations.
- `table-regions.test.tsx` must merge together with the `DefinePage.tsx` change: the guard fails if only one side lands.
- No conflicts are expected, since there are no other concurrent owners (D-180).

## What remains

Nothing in the assignment's scope remains.

- **Verification:** round 7 (qa-verifier or another non-author) verifies F-DG5-148 and F-DG5-149. I close neither.
- **Orchestrator's merged-tree runs (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite are not run here.
- **Outside this assignment:** the remaining `OUTSIDE_P5_PENDING` tables (FormConflict, ConflictPanel, UserEdit) are out of my ownership here and were untouched.
