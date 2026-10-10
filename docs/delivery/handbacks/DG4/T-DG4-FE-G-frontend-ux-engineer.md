# Handback T-DG4-FE-G (frontend-ux-engineer): the six dashboards, the Executive Overview, the workspace header and My Work's sections (first half of FE-G)

- **Stage:** P4, gate DG4 (BUILDING). Assignment `docs/delivery/assignments/DG4/T-DG4-FE-G.md` (sha256 `20315e63…51f21`, verified with `sha256sum`). Section: `docs/architecture/p4-work-split.md` §J+K JK.7, first half.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-G-frontend-ux-engineer-20261010T055055Z-2b436a8a","session_id":"2b436a8a-0bf5-4316-81b2-4f9ae51ed07e"}`.
- **Base:** branch `dg4/fe-g` at `8db6679bf3ba18d8de0ad8009de2f01d4ec40461` (`git rev-parse HEAD`). The changes are left **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-10T05:51:05Z`, ended `2026-10-10T07:28:14Z` (`date -u`), about 97 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0**, run before any edit (`T-DG4-FE-G-evidence/validate-historical-DG3.log`).
- **Product gates G1–G6 are business approvals inside the product.** Nothing here reads or writes DG0–DG7, and no screen labels anything DG0–DG7 (the e2e checks `main` for `/\bDG[0-7]\b/`). All e2e and fixture data is synthetic. `#0078FF` stays a provisional token; no colour or CSS was changed.

## 0. Open item first: one e2e failure that I could not attribute (disclosed)

The full product e2e suite **exited 1**: 268 passed and 1 failed. The failure is a **30 s test timeout** of `p2-journeys.spec.ts:828` "Define → G2" in chromium-en (32.3 s). Re-run alone, the same test failed in **both** languages (32.7 s en, 32.0 s ar), and the other 16 tests of the spec passed. The load average was **14.75** (four agents plus my overlapping integration run).

- **The slow step:** `submitAndApproveGate` (`p2-journeys.spec.ts:660`, called at line 871): the G2 gate page's readiness criteria, then the submit and decision dialogs. D-111 already records this journey crossing 30 s under load (17–18 s at W11–W13, about 33 s at W14).
- **What my change adds on the journey's path:**
  - every sign-in lands on `/my-work`, which now sends one more GET (`/api/v1/me/work`, `MyWorkSections`);
  - the shared `index` chunk grew. It is now **2,109,893 bytes**. D-111 measured 1,787,510 at W14; W15's size before my change was not measured.
  - The gate, Define, Charter and Team pages the journey drives are unchanged, apart from one extra workspace tab link.
- **I did not raise the timeout.** I did not run an A/B against the base commit either: that would need a second built tree with its own `node_modules`, and I was at the time limit. **So I cannot say whether my change contributes.** The orchestrator's dedicated-tree A/B (D-111 practice) and the planned route-level code splitting (D-111 "decided") are the way to settle it.
- Logs: `e2e-full.log`, `e2e-p2-rerun.log`.

## 1. Changed files

### New files (all inside my ownership)

| File | Purpose |
|---|---|
| `apps/web/src/pages/dashboards/api.ts` | Paths and read hooks for the slice J reads: overview, transformation, workstream, Finance, adoption, drill-down (paged through `withPage`), My Work (+ section pages), header, workstreams, reporting periods, and the business unit's readable transformations. Keys come from FE-A's `p4Keys`. `expectShape` / `ResponseShapeError` turn a malformed answer into "unavailable" (never retried, never a crash). |
| `apps/web/src/pages/dashboards/ui.tsx` | Shared UI: `RagStatusChip` (icon + text for 6 statuses); `ValueView` (5 **distinct** states with `data-value-state`); `keyText` (rule, reason and headline keys translated at render time); `RuleNote` with the policy source; `PeriodText`; `webPathOf` / `RecordLink` (API record paths → web routes; an initiative or business case outside a transformation context is resolved on click through a session-bound action); `flagText` / `Flags`; `AreaCard` / `AreaGrid` (seeded T10 labels; Arabic marked provisional, with the English source); `TransformationRows`; `DrilldownPanel` (value, period, calculation, inputs, rounding note, paged records, evidence); `FilterBar` (period, business unit, owner, phase and status chips, with the window and as-of note); `useFilterState` (filters in the URL); `useOrgQuery`; `GeneratedNote`; `BlockedFilterNote`. |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx` | `/dashboards` hub (the six dashboards) and `/dashboards/:kind`: `executive` → `/executive-overview`; `transformation` / `workstream` choosers; the Finance dashboard; the adoption dashboard; the personal dashboard. |
| `apps/web/src/pages/dashboards/TransformationDashboardPage.tsx` | The workspace tab `/transformations/:id/dashboard` (Template 10, owner + period filters, workstream links) and `/transformations/:id/workstreams/:workstreamId/dashboard`. |
| `apps/web/src/pages/dashboards/MyWorkSections.tsx` | The six My Work sections with totals, paging (`Load more` through each section's cursor) and upcoming deadlines. It has its own quiet pending/unavailable states (no `role=status`, per the landing-page race MyWorkPage documents). |
| `apps/web/src/pages/executive-overview/ExecutiveOverviewPage.tsx` | `/executive-overview`: the six areas over the readable transformations, one row per transformation with its six statuses, and the drill-down. |
| `apps/web/src/components/WorkspaceHeader.tsx` | The workspace header from `getWorkspaceHeader`: the eight elements, each Unknown where missing; an all-Unknown grid plus retry when it cannot be read; the contextual links (RAID, dashboard, KPIs, benefits register, T16, gates); the P2 design-decisions link kept inside Key decisions. |
| `apps/web/src/i18n/en/dashboards.json`, `ar/dashboards.json` | The `dashboards` namespace: 304 keys, identical sets, built from one table. EN rule, reason and headline texts are ADR-0037 A2 verbatim. The Arabic texts are proposals using glossary terms. |
| `apps/web/src/pages/dashboards/dashboardFixtures.ts`, `dashboards.test.tsx` | Synthetic fixtures and 21 unit tests (10 per language, plus `webPathOf`, `withPage` and `formatValue`). |
| `apps/web/e2e/p4-dashboards.spec.ts` | Real-stack e2e: 6 steps × 2 languages, with screenshots and axe. |

### Edited shared or other files (append-only, or as the assignment directs)

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | Imports plus 5 routes appended (`executive-overview`, `dashboards`, `dashboards/:kind`, `transformations/:id/dashboard`, `…/workstreams/:workstreamId/dashboard`). FE-G's own placeholder entry `dashboards/:kind` is removed from `P4_PLANNED_ROUTES` and replaced by a comment (the FE-B…FE-E precedent). The traceability placeholder stays, for FE-G2. |
| `apps/web/src/app/nav.ts` | The `executive` area's `availability` `"planned"` → `"available"` (FE-G's area: its page now works). Sub-entry id `dashboards` appended (area `executive`, path `/dashboards`). |
| `apps/web/src/components/Workspace.tsx` | One tab appended: `{ id: "dashboard", path: "/dashboard", labelKey: "dashboards.tab" }`. |
| `apps/web/src/i18n/index.ts` | Imports and catalogue entries for the `dashboards` namespace, appended. |
| `apps/web/src/i18n/{en,ar}/nav.json` | One key appended: `nav.sub.dashboards`. |
| `apps/web/src/pages/my-work/MyWorkPage.tsx` | One import and one line `<MyWorkSections />` before FE-A's work-item and inbox sections. Nothing else changed. |
| `apps/web/src/pages/transformations/TransformationDetailPage.tsx` | The static `<section className="workspace-header">` block is replaced by `<WorkspaceHeader … />`. Removed with it: the helpers only that block used (`PHASE_GATE`, `HeaderGate`, `HeaderNorthStar`, `HeaderDecisions`) and their now-unused imports. The design-decisions link moved into `WorkspaceHeader`. The page's other content and **every existing test are unchanged and pass** (including `app.test.tsx` "detail shows the workspace header with Unknown…" and `journeys.spec.ts`'s header check). The file's header comment is updated. |

**Keys added to shared files** (D-112 list): only `nav.sub.dashboards` (en, ar). **No `problems.json` key was missing:** the five ADR-0037 §13 codes were already there (FE-R1), and a unit test asserts all five in both languages. `myWork.json` was not changed.

## 2. Behaviour delivered, per requirement row

None of these rows is complete at my end alone: each is shared with KBE-G or KBE-G2 (merged), and the traceability half of FE-G is FE-G2's. Below is what the screens now do against each literal acceptance text.

- **REQ-S03-011.** *"A02: from the workspace header one click opens the transformation's RAID filtered to it; the header shows the eight elements with Unknown where data is missing"*
  - The header reads `getWorkspaceHeader`:
    - phase (stepper and mode);
    - gate readiness: live, through the port; gate link, status, inherited-approval badge (never "approved"), missing mandatory count;
    - North Star;
    - sponsor and lead, each Unknown separately;
    - outcome health (RAG, rule, counts);
    - benefits per currency (planned and validated to date, count, non-financial n/a);
    - key decisions (≤ 5 open T16 asks, overdue count);
    - next actions (≤ 5 of the caller's own items, missing mandatory count or Unknown).
  - A header that cannot be read shows every element Unknown, with a retry button.
  - **E2E step 1 (en, ar):** on a new transformation the North Star, benefits, outcome health and sponsor are Unknown, and no element is green. G1 comes live. **One click** on `[data-header-link='raid']` opens `/transformations/{A}/raid`: transformation A's risk is listed and transformation B's risk is absent.
- **REQ-S13-001.** *"A04;A12: a user scoped to transformation X opens each of the six dashboards and no tile, total or drill-down contains a transformation Y record or figure"*
  - All six dashboards exist and render only what the server returns. Scope is enforced by KBE-G/KBE-G2, whose X/Y sweeps are in their integration tests.
  - The web never widens a request:
    - an organization-wide dashboard sends `organizationId` plus filters;
    - the business-unit chip sends that unit's readable transformation ids, from DG1 `listTransformations`;
    - with no readable transformation in the unit, or more than 50, **no request is sent** and a note says why (`BlockedFilterNote`), so an empty filter is never read as "all".
  - **Not done by me:** a browser-level X/Y sweep. The e2e user `dev.office` holds organization-wide grants, so it would not test scoping.
- **REQ-S13-002.** *"A04: filtering by period Q1 changes all tiles to Q1 values"*
  - The period chip lists the organization's reporting periods and sends `periodId` to the overview, Finance and adoption dashboards, the transformation and workstream dashboards, and (through `drilldownHref`) the drill-down.
  - The applied window and as-of date are shown from `appliedFilters`.
  - A unit test proves `periodId` reaches `/overview` and the chip shows `2026-Q1`.
  - "Changes all tiles to Q1 values" is the server's proof (KBE-G `filters.test.ts`). The e2e cannot pick Q1, because the dev seed has no reporting period.
  - Without `organization.read` the period list is unavailable, and the chip says so (disabled, with an explanation).
- **REQ-S13-003.** *"A04;A05: the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0"*
  - `ValueView` renders value, **known zero** (number + "Known zero"), **Unknown** (no number, with its reason), **Stale** (last value labelled Stale) and **Not applicable** (no number, with its reason) distinctly.
  - Unit test: the `value.validated` drill-down lists the benefit record (link `/transformations/{t}/benefits/{id}`), the calculation and the evidence. A KPI with no actual shows Unknown with no digit.
  - **E2E step 2:** the open-decisions drill shows a labelled known zero and the empty-records note.
- **REQ-PB-062.** *"A01;A04: all six areas render in en and ar from persisted data; each headline drills to contributing records"*
  - Six `section[data-area]` from the real stack, in both languages (e2e steps 2 and 3).
  - Seeded labels from the response; Arabic marked provisional, with the English source (`data-provisional`, asserted in the ar e2e and in the unit tests).
  - Every headline has a "Drill down" button opening `DrilldownPanel`.
- **REQ-S03-009.** *"A04: after an accepted KPI actual the overview's outcome tile shows the new actual once and its drill-down lists the source record"*
  - The overview shows the Outcomes items and drills `outcomes.*` headlines.
  - Read models are computed per request; the page shows "computed at … nothing is stored" with Refresh.
  - The accepted-actual scenario is proven server-side (KBE-G `dashboards.test.ts`). **Not repeated in e2e** (it needs a KPI with an approved trajectory plus an accepted actual).
- **REQ-PB-063 / REQ-PB-064.** The screens show the server's area RAG and rule text (for example "Decisions: at least one open decision is past its decision date.") and the `overdue` flag on the listed ask (unit test). The rules themselves are KBE-G's.
- **REQ-S03-008.** *"A02;A12: a KPI owner with a due actual sees it under Missing updates with a link that opens the KPI period entry; another user's items never appear"*
  - My Work shows the six sections with totals and section links, the upcoming deadlines (horizon and business date, overdue flagged) and drafts labelled "Draft – not submitted".
  - Unit test: a `kpi_update_due` item under Missing updates links to `/transformations/{t}/kpis/{k}/actuals` (the KPI period entry) and is flagged overdue.
  - "Another user's items never appear" is the server's rule; the screen only shows `getMyWork`.
  - **E2E step 5:** the sections and deadlines render for `dev.lead`; `/dashboards/personal` shows the same component.
- **KBE-G2 §5 items 5–7 (Finance):**
  - per-class lines (class × state × currency, each state its own line; forecast labelled "not realized");
  - gross and net in their own table, with implementation cost from `value.investment`; an Unknown net shows Unknown, never 0 (unit test);
  - a "No drill-down for this line" note where `drilldownHref` is null;
  - `nonFinancialCount` shown with an **n/a** chip ("Not applicable: there is no financial benefit."), never 0 (unit test and e2e step 4);
  - EN/AR labels for `gross`, `net`, `non_financial_valued` and all seven line states.

**Narrow width:** e2e step 6 checks the overview, transformation dashboard, header page, Finance and My Work at 390 px (100 % text) and at 200 % text (1280 px): no page-level horizontal scroll. Screenshots `*-390.png` and `*-200pct.png`. This follows FE-D's pattern; 390 px **and** 200 % text together was not tested (the DG3 carried observation, D-088 (3)).

## 3. Checks actually run (real exit codes)

Node 24.21.0, offline. Harness ports 25600–25649 only. Disk before the full runs: 18–19 GB free. Empty `.claude/.cc-writes` directories (created by the session's own writes) were removed before each test run.

| # | Command | Exit | Result | Log (`T-DG4-FE-G-evidence/`) |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` | **0** | `PASS gate DG3 (historical)` | `validate-historical-DG3.log` |
| 2 | `pnpm -r typecheck` | **0** | | `typecheck.log` |
| 3 | `pnpm -r build` | **0** | (Vite's usual chunk-size warning) | `build.log` |
| 4 | `pnpm lint` | **0** | | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | all files formatted | `prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | | `openapi-lint.log` |
| 7 | `pnpm test`, LANG/LC_ALL/LC_CTYPE unset | **0** | unit-node + unit-web **133 files, 2568 passed**; formula-nocodegen **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | same counts | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=25610 MTH_PORT_POOL=25611-25649 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **184 files, 1739/1739 passed**. No pinned-count change: no API, contract or schema file is touched. | `integration.log` |
| 10 | `E2E_PG_PORT=25600 E2E_API_PORT=25601 MTH_PORT_POOL=25602-25609 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **268 passed, 1 failed** (timeout, §0), 3 not run (the serial P2 en tests after it). Ran concurrently with #9. | `e2e-full.log` |
| 11 | the same harness, `apps/web/e2e/p2-journeys.spec.ts` alone | **1** | 16 passed, 2 failed (Define → G2 en 32.7 s, ar 32.0 s; timeout; load 14.75) | `e2e-p2-rerun.log` |
| 12 | the same harness, `apps/web/e2e/p4-dashboards.spec.ts` alone (final code) | **0** | **12/12 passed** | `e2e-p4-dashboards-alone.log` |

**e2e per spec in run #10** (passed, en / ar): `journeys` 9/9; `p2-blank-text` 9/9; `p2-journeys` 8 + **1 failed** + 3 not run / 12; `p3-business-cases` 6/6; `p3-g4-refusal` 2/2; `p3-inherited-approval` 5/5; `p3-journeys` 18/18; `p3-portfolio` 6/6; `p3-prioritization-roadmap` 7/7; `p3-seams` 3/3; `p3-ui-completion` 7/7; `p4-adoption-bau` 8/8; `p4-benefits` 8/8; **`p4-dashboards` (new) 6/6**; `p4-governance` 8/8; `p4-kpi` 10/10; `p4-raid-governance` 7/7; `session-end` 5/5.

**Axe:** `expectAccessible` asserts 0 serious or critical violations and fails the test otherwise, so every passing step that calls it had 0. My spec calls it at 11 points per language.

**Development runs, disclosed:**
- **First web unit run:** 10 failures in 4 files. Fixed before the full runs:
  - the catalogue fallback answered `/me/work` and `/summary` with an empty page, which crashed my components (→ shape guard);
  - two Arabic strings had no Arabic letters;
  - the old header test needed the design-decisions link (→ kept in Key decisions);
  - a link label duplicated the "Benefits" element label (→ "Benefits register");
  - a test selector matched the nav's `data-area`.
- **First run of my e2e spec** (`e2e-p4-dashboards-dev-run1.log`): exit 1, 2 failed. The drill-down request got a second `?` (my paging bug) and answered 400. Fixed with `withPage`, covered by a unit regression test; the re-run is #12.

**Screenshots** (EN and AR, from run #10): `T-DG4-FE-G-evidence/screenshots/{en,ar}-p4dash-*.png`, 21 per language:
- header, RAID from header, transformation dashboard, drill-down zero;
- overview, overview filtered;
- Finance, adoption, hub;
- My Work, personal;
- 5 screens × (390 px, 200 % text).

## 4. Operations routed (pending-list delta)

None. FE-G routes no API operation and has no `p4-pending-*.ts` file. The operations it consumes (`getExecutiveOverview`, `getTransformationDashboard`, `getWorkstreamDashboard`, `getFinanceDashboard`, `getAdoptionDashboard`, `getDashboardDrilldown`, `getMyWork`, `getWorkspaceHeader`, `listWorkstreams`, `listReportingPeriods`, `listTransformations`) were routed by KBE-G, KBE-G2, BE-M3 and KBE-C. `contract.test.ts` is untouched and green.

## 5. Contract and schema needs (for the orchestrator)

1. **No business-unit filter in the dashboard contract.** ADR-0037 §4 has organization, transformation, owner, period, phase and status. The assignment asks for a business-unit chip, so the web derives it: the unit's readable transformation ids, at most 50, sent as `transformationId`. A `businessUnitId` query parameter would remove the 50 cap.
2. **Item and drill-down `href`s are API paths** (`/api/v1/…`), and `initiatives/{id}` and `business-cases/{id}` carry no transformation. The web maps them (`webPathOf`). On organization-wide dashboards it reads the record on click to find its transformation.
   - KPI actuals and versions, plan values and dependencies map to their list pages, because there is no web detail route that takes only that id.
   - A `transformationId` on `DashboardItem` / `DrilldownItem` (or web paths) would make every link direct.
3. **KBE-G2 §5 item 5** (no `valueClass` drill-down parameter) is unchanged. Those lines show "No drill-down for this line".
4. **No migration, no schema change.**

## 6. What remains

- **The e2e failure of §0** needs the orchestrator's A/B in the dedicated tree. If my change contributes, the route-level code splitting D-111 already decided on is the remedy; the timeout must not be raised.
- **FE-G2 (the separable second half, not started):** `pages/traceability/**` (graph, orphan report, impact panel, allocation sets), the Modular missing-link and inherited-records views, and the portfolio and workstream screens. The `transformations/:id/traceability` placeholder route is left for it.
- Not done here:
  - a browser-level X/Y scope sweep (server-proven by KBE-G/KBE-G2);
  - an e2e period-Q1 step (the dev seed has no reporting period);
  - the RAG-policy configuration screen (`getDashboardRagPolicy` / `putDashboardRagPolicy`). It is not in my four listed items, but ADR-0037 §10 implies a screen for TO/KDS; I name it for the orchestrator to assign.

## 7. Merge instructions

- No migration. Everything is uncommitted on `dg4/fe-g`; `docs/delivery/handbacks/DG4/T-DG4-FE-G-*` is new.
- **Conflicts to expect, all union merges:**
  - `router.tsx`: my imports and route block sit after the FE-E block; the `P4_PLANNED_ROUTES` FE-G comment;
  - `nav.ts`: the `executive` line, the `NavSubPage` id union tail, the `NAV_SUBPAGES` tail;
  - `Workspace.tsx`: the `WORKSPACE_TABS` tail;
  - `i18n/index.ts`: imports after `enSustainP4` and both catalogue tails;
  - `nav.json`: the `sub` tail.
- `TransformationDetailPage.tsx` and `MyWorkPage.tsx` are touched only as described in §1. Another FE task editing either file may conflict.
