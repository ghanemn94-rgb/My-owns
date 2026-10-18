# Handback T-DG5-FE-X1 (frontend-ux-engineer): DG5 round-2 repair, F-DG5-142 and F-DG5-143

- **Stage:** DG5, FIXING after review round 2 on candidate `sha256:c4f70a80…` (D-172).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-X1.md` (sha256 `d03a8df4…c79f61`, verified).
- **Invocation:** `DG5-T-DG5-FE-X1-frontend-ux-engineer-20261018T151829Z-0fb9e304`, session `0fb9e304-0c70-49be-a809-452ffc9d4817`.
- **Working tree:** `/home/user/wt/dg5-fe-x1`, branch `dg5/fe-x1`, starting `HEAD` `017c27c7e3e6b953f600b2b119d51d2599571925` (clean apart from untracked home-directory dotfiles that are not mine and that I did not touch).
- **Time:** start `date -u` = Sun Oct 18 15:18:44 UTC 2026; end: see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits **0** at the start (`PASS gate DG4 (historical)`; `T-DG5-FE-X1-evidence/00-validate-historical-DG4-start.log`), and again at the end (§8).
- The changes are **uncommitted**, for the orchestrator to integrate. No contract, schema, migration or dependency change.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/components/TableScrollRegion.tsx` (new) | The shared table scroll region: `.table-wrap` with `tabIndex=0`, `role="region"` and the localized name `common.table.scrollRegion` ("{caption} (scrollable table)" / "{caption} (جدول قابل للتمرير)"). It is FE-V1's markup, extracted, so pages use a component instead of per-page attributes. |
| `apps/web/src/components/DataTable.tsx` | Uses `TableScrollRegion` (keeps `aria-busy`). Same DOM as before. |
| `apps/web/src/components/RegisterTable.tsx` | Uses `TableScrollRegion`. Same DOM as before. |
| `apps/web/src/pages/transformations/TransformationDetailPage.tsx` | The overview's audit table uses the region (F-DG5-142 screen 1). |
| `apps/web/src/pages/define/CharterPage.tsx` | `#charter-scope`, `#charter-versions` and the version-diff table use the region (screen 2). |
| `apps/web/src/pages/readiness/ReadinessPage.tsx` | `#diagnostic` and `#gates-status` tables use the region (screen 3). |
| `apps/web/src/pages/benefit-formulas/BenefitFormulaPage.tsx` | `#versions` and `#calculations` tables use the region (screen 4). |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | The G1–G6 `#submissions` history table (the probe's bare wrapper on G1 and G4). |
| `apps/web/src/pages/dashboards/ui.tsx` | The area records table, the per-transformation rows table and the drill-down records table (transformation dashboard, executive overview). |
| `apps/web/src/pages/admin/OrganizationsPage.tsx` | The organizations and business-units tables. |
| `apps/web/src/pages/portfolio/InitiativePage.tsx` | The `#contributions` table. |
| `apps/web/src/pages/business-cases/CaseTotals.tsx` | The totals tables (bare, not scrolling on the demo data at 390 px; fixed because a longer label would make them scroll). |
| `apps/web/src/components/table-regions.test.tsx` | Unit: `TableScrollRegion` in en and ar, plus a source guard: no opening tag with class `table-wrap` anywhere in `apps/web/src` is left without `role="region"`, `tabIndex={0}` and a name. |
| `apps/web/e2e/p5-table-regions-axe.spec.ts` (new) | The F-DG5-142 regression spec (§2.1). |
| `apps/web/e2e/p5-forms.spec.ts` | F-DG5-143: the T01 test opens the form tools of the record the fixture filled (§2.2). Assertions unchanged. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-X1-*` | This handback and its evidence. |

The P3 helper `TableRegion` in `apps/web/src/pages/prioritization/p3ui.tsx` (caption-only name, used by the P3 pages) is unchanged. It already gives a focusable, named region, and changing its accessible names would change what the P3 specs query.

## 2. Findings

### 2.1 F-DG5-142 (Medium, REQ-S15-012): bare, non-focusable scrolling table wrappers on non-P5 screens

**Cause.** The DG2–DG4 pages render their own `<table>` inside a bare `<div className="table-wrap">`, and `app.css:719` gives `.table-wrap` `overflow-x: auto`. FE-V1 fixed only the shared `DataTable`/`RegisterTable` and the P5 pages. On the demo data these tables are wider than 390 px. A wrapper that scrolls but contains no focusable element cannot be scrolled by keyboard, and axe reports it (`scrollable-region-focusable`, serious). Wrappers that contain links are not flagged by axe, but are still unnamed scroll containers. A source scan (`role="region"` missing from an opening tag with class `table-wrap`) found **16 bare wrappers in 9 page files**, which covers every wrapper the qa probe listed.

**Fix.** Each of the 16 wrappers is now `<TableScrollRegion caption={…}>`, named by the same localized string as the table's own `<caption>`:

- `TransformationDetailPage.tsx:333` (audit trail);
- `CharterPage.tsx:430` (scope checks), `:683` (version history), `:771` (version diff);
- `ReadinessPage.tsx:128` (diagnostic), `:201` (gates G1–G4);
- `BenefitFormulaPage.tsx:428` (versions), `:582` (calculation lineage);
- `GateDetailPage.tsx:1039` (submission history);
- `dashboards/ui.tsx:755` (area records), `:871` (per-transformation rows), `:1017` (drill-down records);
- `OrganizationsPage.tsx:85` (organizations), `:398` (business units);
- `InitiativePage.tsx:874` (contributions);
- `CaseTotals.tsx:172` (totals).

The component itself is `apps/web/src/components/TableScrollRegion.tsx:15`. `DataTable.tsx:63` and `RegisterTable.tsx:126` now render through it too, so there is one implementation. No i18n string was added or changed: the existing `common.table.scrollRegion` key is used in both languages.

**Regression test.** `apps/web/e2e/p5-table-regions-axe.spec.ts`, one test per project (chromium-en, chromium-ar), at 390 × 844:

- It visits the qa probe's P2-DG24 list: overview, charter, readiness, gates G1 and G4, transformation dashboard, dashboards hub, executive overview, admin organizations, and on demo data a business case, an initiative and a benefit formula.
- Its final assertion is `expect(failures).toEqual([])`, which collects every screen's problems first so the failure names each failing screen. A screen fails when:
  - axe (the `expectAccessible` rule set) reports a serious or critical violation;
  - any `main .table-wrap` lacks `tabIndex 0`, `role=region` or a name, whether or not it scrolls;
  - it shows a no-permission or error state.
- On the demo stack it also requires that the four finding screens really scroll horizontally at 390 px (the finding's condition). It also checks the charter's scope table with real keyboard input: Tab presses from the top until the region has focus, then the arrow key of the reading direction must change `scrollLeft`. A viewport screenshot shows the focus ring.
- **Two stacks, no skip.** It reads `GET /api/v1/environment` (as `dev.lead`, present on both stacks):
  - on the demo stack (`e2e/support/with-demo-stack.sh`) it uses the synthetic roaming transformation and the demo role users `roaming.user.tl` / `roaming.user.adm_access`, as the probe did;
  - on the production-marked stack (`apps/web/e2e/support/with-stack.sh`, which the orchestrator's product e2e run uses) it creates its own transformation with `dev.lead` / `dev.admin`, and visits the nine screens that need no demo record. There the overview, readiness and G1/G4 history tables also scroll at 390 px.

The unit guard in `table-regions.test.tsx` fails on any new bare wrapper. I checked that it fires: a temporary `src/zz-probe.tsx` with a bare wrapper was reported as `zz-probe.tsx:1`, and the probe file was then removed.

**Failing before** (product code unchanged, demo stack, locale unset; `T-DG5-FE-X1-evidence/20-f142-before-regions-demo-unset.log`): **2 failed** (en, ar), 26 problems each, including exactly the finding's four axe violations:

```
"/transformations/<T> — 390 px axe scrollable-region-focusable: .table-wrap",
"/transformations/<T>/charter — 390 px axe scrollable-region-focusable: #charter-scope > .table-wrap, #charter-versions > .table-wrap",
"/transformations/<T>/readiness — 390 px axe scrollable-region-focusable: #diagnostic > .table-wrap",
"/transformations/<T>/benefit-formulas/<id> — 390 px axe scrollable-region-focusable: #versions > .table-wrap, #calculations > .table-wrap",
… plus 22 "bare table wrapper …" lines (G1/G4 submissions, dashboard, executive overview, organizations, business case totals, initiative contributions, readiness gates, overview, charter, benefit formula)
```

**Passing after:** demo stack, en and ar: 2/2 with the locale unset (run 41) and 2/2 with C.UTF-8 (run 42), with 12 screens and 0 problems each. Production stack: 2/2 in both locale settings (runs 60 and 60c), with 9 screens and 0 problems each. See §3.

### 2.2 F-DG5-143 (Low, REQ-S05-001): the order-dependent T01 e2e

**Cause.** `p5-forms.spec.ts` `beforeAll` patches `items.items[0]` of `GET …/diagnostic-items`, which the API orders by id: a UUIDv7 whose low bits are random within one millisecond. The test then clicked `#t01 [data-form-tools]` `.first()`, the screen's first row, which `DiagnosePage` orders by dimension ordinal. When the two differ, the dialog opens an empty record.

**Fix** (test only; the product is correct):

- `apps/web/e2e/p5-forms.spec.ts:42`: a module variable `t01ItemId`;
- `:106`: the fixture records the id of the item it fills;
- `:228` (lead) and `:272` (auditor): the test opens `#t01 [data-form-tools='${t01ItemId}']`. `FormToolsButton` already renders `data-form-tools={recordId}`.

This is the D-172 option "make the test open the row of the record it filled". Every assertion is unchanged, including the final ones: the root-cause value, the comment, the attachment, history, export, and the auditor's read-only view of the same record's comment.

**Regression test:** the reviewer's reproduction itself, the T01 test run repeatedly. Each `--repeat-each` copy runs its own `beforeAll` (a new transformation and new items), so each repeat draws a new id order. This is visible in the before-run: one isolated failure among 10 repeats, not a block of them.

**Failing before** (`T-DG5-FE-X1-evidence/10-f143-before-T01-repeat10-unset.log`; production stack, locale unset, `-g T01 --repeat-each=10`): **1 failed, 19 passed**. The failure is the finding's assertion:

```
✘  20 [chromium-ar] › apps/web/e2e/p5-forms.spec.ts:211:1 › T01: form tools on a diagnostic record … (8.5s)
    Error: expect(locator).toHaveValue(expected) failed
    Expected: "Synthetic root cause"
    Received: ""
```

(screenshot `T-DG5-FE-X1-evidence/10-f143-before-failure-chromium-ar-repeat9.png`).

**Passing after:** the whole spec with `--repeat-each=10`, `--workers=1`, chromium-en and chromium-ar: **60/60 with the locale unset and 60/60 with C.UTF-8**. That is 0 failed and 0 flaky, with T01 passing 40 of 40 executions in total (runs 62 and 62c).

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, harness ports 23101/23102, `MTH_PORT_POOL=23110-23149`. Every heavy run was alone. Logs are in `docs/delivery/handbacks/DG5/T-DG5-FE-X1-evidence/`.

| # | Command | Exit | Result |
|---|---|---|---|
| 00 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` |
| 10 | before fix: `with-stack.sh npx playwright test apps/web/e2e/p5-forms.spec.ts -g T01 --repeat-each=10 --workers=1` (locale unset) | 1 (expected) | 1 failed, 19 passed: the reproduction |
| 20 | before fix: `e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/p5-table-regions-axe.spec.ts --workers=1` (unset) | 1 (expected) | 2 failed (en, ar), 26 problems each |
| 30 | `pnpm -r typecheck` | 0 | |
| 31 | `pnpm -r build` | 0 | |
| 32 | `pnpm lint` | 0 | `eslint . --max-warnings=0` |
| 33 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style |
| 34 | `pnpm openapi:lint` | 0 | OpenAPI 3.1.1, 846 operations |
| 40 | after fix, demo, unset (spec before the keyboard check was added) | 0 | 2 passed; kept as `…-v1-before-keyboard-check.log` |
| 41 | after fix, demo, unset, final spec | 0 | 2 passed (1.5 m), 12 screens, 0 problems each |
| 42 | after fix, demo, `LANG=LC_ALL=C.UTF-8`, final spec | 0 | 2 passed (1.5 m), 12 screens, 0 problems each |
| 50 | `npx vitest run --project unit-web` (locale unset) | 0 | 90 files, **1711 passed** |
| 51 | the same with `LANG=LC_ALL=C.UTF-8` | 0 | 90 files, **1711 passed** |
| 60 | production stack, unset: `with-stack.sh npx playwright test apps/web/e2e/p5-table-regions-axe.spec.ts --workers=1` (`60-regions-prod-unset.log`) | 0 | 2 passed (1.0 m), 9 screens, 0 problems each |
| 61 | production stack, unset: `p5-reflow-axe.spec.ts` (`61-p5-reflow-axe-prod-unset.log`) | 0 | 2 passed (8.5 m), 31 screens, 0 problems each |
| 62 | production stack, unset: `p5-forms.spec.ts --repeat-each=10` (`62-p5-forms-repeat10-prod-unset.log`) | 0 | **60 passed**, 0 failed, 0 flaky (18.2 m); T01 passed 20 of 20 (10 per project) |
| 60c | production stack, C.UTF-8: `p5-table-regions-axe.spec.ts` (`60-regions-prod-cutf8.log`) | 0 | 2 passed (52 s), 9 screens, 0 problems each |
| 61c | production stack, C.UTF-8: `p5-reflow-axe.spec.ts` (`61-p5-reflow-axe-prod-cutf8.log`) | 0 | 2 passed (6.9 m), 31 screens, 0 problems each |
| 62c | production stack, C.UTF-8: `p5-forms.spec.ts --repeat-each=10` (`62-p5-forms-repeat10-prod-cutf8.log`) | 0 | **60 passed**, 0 failed, 0 flaky (13.4 m); T01 passed 20 of 20 |
| 70 | `pnpm lint` and the prettier check, re-run on the final tree (the spec gained its keyboard check after runs 32 and 33; `70-lint-final.log`, `71-prettier-final.log`) | 0 and 0 | eslint clean; All matched files use Prettier code style |
| 99 | `node tools/gates/validate.mjs --historical --stage DG4` (end; `99-validate-historical-DG4-end.log`) | 0 | `PASS gate DG4 (historical)` |

**Not run, D-164:** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They run once on the merged tree in the orchestrator's verification. None of them is reported as passed here.

**The interaction checks I actually ran:**

- **Keyboard (demo stack, en and ar, both locale settings):** real Tab presses from the top of the charter page reach the `#charter-scope` table region. Six ArrowRight presses (en) or ArrowLeft presses (ar) change its `scrollLeft`. The focus ring is visible: `shots-demo-unset/{en,ar}/x1-regions-390-charter-keyboard.png`.
- **Visual evidence:** the four finding screens at 390 px, on demo data, in en and ar: `shots-demo-unset/{en,ar}/x1-regions-390_transformations_T_{,charter,readiness,benefit_formulas_id_}.png`.

## 4. Contract, schema or dependency needs

None. No operation, response shape, migration, i18n key or dependency was added or changed.

## 5. ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R5)

- No ADR, data-dictionary or OpenAPI text describes table scroll regions: a search of `docs/architecture` and `docs/api` for `table-wrap`, `scrollRegion`, `scrollable` and `focusable` found nothing. Nothing there becomes untrue.
- Delivery records (not mine to edit) that are now outdated:
  - D-171 observation (f) and the FE-V1B handback: "bare `.table-wrap` elements on DG2–DG4 pages are unchanged". After this repair, no bare `.table-wrap` remains in `apps/web/src`, and the unit guard enforces that.
  - D-171 / FE-V1: "every shared table wrapper is a focusable, named region". This is still true, and now holds for page-level tables too, through `TableScrollRegion`.
- **Optional for ARCH-R5:** if an ADR names the accessibility building blocks of the web shell, add `TableScrollRegion` as the required wrapper for any page-level table.

## 6. User-facing texts

- No user-facing text was added or changed.
- Screen readers now announce 16 more regions, each named "<caption> (scrollable table)" in en or "<caption> (جدول قابل للتمرير)" in ar, using the existing `common.table.scrollRegion` string. Each name is true: the region is the table's horizontal scroll container.
- None of my changes makes a visible text untrue.

## 7. What remains, and observations

- **Observation (polish, not fixed):** the transformation dashboard and the executive overview show one "Records in this area" table per area. Their regions therefore share one name: "Records in this area (scrollable table)". This is not a serious or critical axe violation (axe reports none), and it repeats the existing caption, which is the same for every area. Naming each region after its area would need a new or changed i18n string. I did not do this because it is outside the decided scope.
- Nothing in the assignment remains. Both findings are repaired, with failing-before and passing-after evidence. Closing them is for the qa-verifier in round 3.

## 8. End

- End `date -u`: Sun Oct 18 17:01:02 UTC 2026 (about 102 minutes).
- `node tools/gates/validate.mjs --historical --stage DG4` at the end: exit 0, `PASS gate DG4 (historical)`.

## 9. Merge instructions

- The changes are uncommitted in `/home/user/wt/dg5-fe-x1`. They are disjoint from T-DG5-BE-X1 (`apps/api/src/modules/workflows/**` and two `gates.json` entries, which I did not touch) and from T-DG5-BE-X2 (`packages/db/src/demo/**`).
- No migration. Rebuild `apps/web` after the merge.
- **Merge order:** none required.
- **BE-X2 interaction:** BE-X2 changes the demo data. If it changes the roaming data so that a finding screen no longer scrolls at 390 px, the new spec's demo-only set-up check names that screen. All 16 wrappers stay fixed either way.
