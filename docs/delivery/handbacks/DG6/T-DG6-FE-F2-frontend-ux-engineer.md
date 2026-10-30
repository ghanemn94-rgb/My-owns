# Handback: T-DG6-FE-F2 (frontend-ux-engineer), p6-work-split §I/K.4

- **Stage:** P6, gate DG6 (BUILDING). This is an engineering task. It grants no business, Finance or IT approval. Product gates G1–G6 are in-product business approvals, and the G1 approval in the specs is a SYNTHETIC demo decision. Nothing here reads or writes DG0–DG7.
- **Invocation:** `DG6-T-DG6-FE-F2-frontend-ux-engineer-20261030T204929Z-ad59fb1b` (session `ad59fb1b-7f83-4969-934c-7101dfbbd347`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-F2.md` (sha256 `a8e65379…9352`, verified at start).
- **Base:** branch `dg6/fe-f2`, `HEAD` `ee20f5eccaaa4e4a0c5dbc1c354ad621ba3d8bd1`, clean tree at start.
- **Changes:** uncommitted, as instructed.
- **Time:** started 2026-10-30T20:49:44Z (`date -u`); end time is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exits **0** ("PASS gate DG5 (historical)").
  - Run before any change: `T-DG6-FE-F2-evidence/validate-historical-DG5.txt`.
  - Re-run at the end: §4.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/my-work/HomeRegions.tsx` (new) | The shared region shell (`GlanceBand`, `GlanceRegion`, `GlanceNote`, `GlanceEmpty`) and My Work's three regions ("Key decisions", "Key outcomes", "Next actions"), built from `getMyWork`. |
| `apps/web/src/pages/my-work/MyWorkPage.tsx` (named lines) | Mounts `<MyWorkHomeRegions />` directly under the page header (one import, one line with its comment). |
| `apps/web/src/pages/executive-overview/ExecutiveRegions.tsx` (new) | The executive page's three regions, built from `getExecutiveOverview`: the Decisions and Outcomes area status and headlines, plus the dated open decisions and blockers (`nextActionItems`). |
| `apps/web/src/pages/executive-overview/ExecutiveOverviewPage.tsx` (named lines) | Mounts `<ExecutiveHomeRegions />` above the filter bar, passing its loading and unavailable states. |
| `apps/web/src/pages/kpi/KpiActualPage.tsx` (named lines, `ReviewQueue`) | **360 px fix.** The review queue's Accept/Reject actions move from a trailing "Actions" column into the KPI row-header cell, so they sit at the row's start edge (LTR and RTL) without a sideways table scroll. |
| `apps/web/src/i18n/en/myWork.json`, `apps/web/src/i18n/ar/myWork.json` (append-only block `home`) | The region names, intros, counts and empty states, en and ar. The Arabic is provisional. |
| `apps/web/src/pages/my-work/provisional-ar.ts` (new) | Labels the `myWork.home.` Arabic as provisional (the JSON catalogues cannot carry comments). |
| `apps/web/src/pages/my-work/home-regions.test.tsx` (new) | Component tests, en/ar: the named regions, each once, before the deadlines; their content; the empty, unavailable and loading states; the provisional-Arabic check. 9 tests. |
| `apps/web/src/pages/executive-overview/executive-regions.test.tsx` (new) | Component tests, en/ar: the regions sit above the filters; status chips have an icon and label; Unknown is never 0 or green; next actions are ordered; empty and unavailable states. 7 tests. |
| `apps/web/src/app/axe-scope.test.ts` (new) | ADR-0061 §7.2 scope test: every route added to `router.tsx` in P6 is in `e2e/support/p6-axe-screens.ts`, and every listed route exists in the router. 4 tests. |
| `e2e/support/p6-axe-screens.ts` (new) | `P6_AXE_ROUTES`: the 32 P6 routes of the router, with sign-in user and list-of-origin. `KEY_FLOW_AXE_SCREENS`: the 14 key flows of §7.2. **Created by FE-F2 because QA-D had not created it yet. Ownership moves to QA-D (§I/K.4), and QA-D extends it.** |
| `apps/web/e2e/p6-layout-1440.spec.ts` (new) | Regression for §4.1. At 1440 × 900, en/ar, home and executive pages on real API data: the three regions by role and name, wholly above the fold, `scrollY = 0`, the token backgrounds, axe, viewport screenshots. Budget 60 s. |
| `apps/web/e2e/p6-flows-360.spec.ts` (new) | Regression for §4.2. At 360 × 800, en/ar: G1 approval (business approval), P4 approval request, KPI actual submit, KPI review accept. Each step checks for no page scroll, each primary action inside the width and hit-testable without a sideways scroll, and an API read-back. A 768 × 1024 pass follows. Budget 60 s. |
| `apps/web/e2e/p6-walkthrough-keyboard.spec.ts` (new) | Regression for §7.1, keyboard only, en/ar, demo database. It skips on the production-marked stack and says why. Budget 90 s. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-F2-*` | This handback and its evidence. |

No API, schema, migration, contract, CSS or dependency change.

## 2. Behaviour delivered, per requirement row

### REQ-S15-001: home and executive regions at 1440 px (FE-F2 part)

Acceptance (quoted): *"A20: visual review of the Arabic and English executive and home pages at 1440 px shows decisions, outcomes and next actions without scrolling, with light surfaces and blue navigation"*.

**What the pages now show**

Both `/my-work` (home) and `/executive-overview` open with a three-column band of three regions. Each region is a `<section role="region">` named by its catalogue heading, and carries a `data-glance-region` hook:

- `myWork.home.decisions.title`, "Key decisions" / "القرارات الرئيسية";
- `myWork.home.outcomes.title`, "Key outcomes" / "النتائج الرئيسية";
- `myWork.home.nextActions.title`, "Next actions" / "الإجراءات التالية".

The names are deliberately different from the executive page's Template 10 area cards ("Decisions", "Outcomes") and My Work's section titles, so each name is unique on its page and `getByRole("region", { name })` finds exactly one.

**Content: existing data only** (§4.1 "a region shows what the page already loads")

- **Home.** All three regions come from the same `getMyWork` response the sections below use (React Query deduplicates it):
  - Key decisions: the `approvals` section, with its total, the first 3 items and a link to `#mw-approvals`.
  - Key outcomes: the `missing_updates` and `reviews` sections, with both totals and the first 3 items.
  - Next actions: `upcomingDeadlines`, or the assigned actions when there is no deadline, with the assigned-action total and a link.
- **Executive.** All three regions come from the `getExecutiveOverview` response the six area cards render:
  - Key decisions: the Decisions area's status chip (icon + label) and its headlines.
  - Key outcomes: the Outcomes area's status chip and headlines.
  - Next actions: the dated open decisions and blockers from the Decisions and Dependencies areas, earliest first (first 3), each linked to its record.
  - A note says that drill-downs, status logic and records stay in the areas below.

Nothing is computed in the web. Unknown and Stale use the shared `ValueView` and `RagStatusChip`, so they are never 0 or green.

**States**

| State | What the region shows |
|---|---|
| Empty | Its designed empty state (for example "No business approval or decision is waiting for you."), never a blank. |
| Loading | A busy note (`aria-busy`, deliberately not a live region on the landing page, as MyWorkPage's `Pending`). |
| Read failure or blocked filter | "Not available right now…", never an empty state or a zero. |

**Measured** (real stack, `p6-layout-1440.spec.ts`, 4/4)

- At 1440 × 900 every region's bounding box lies wholly within the first 900 px, with `scrollY = 0`:
  - home: tops at 216 px;
  - executive: tops at 156 px.
- `body` background equals `--mth-surface-page`, and `.app-nav` equals `--mth-nav-background`.
- axe finds 0 serious or critical issues.

**Screenshots** (viewport and full page): `T-DG6-FE-F2-evidence/screenshots/{en,ar}/p6-1440-{home,executive}{,-full}.png`.

Arabic bidi: record labels are isolated (`<bdi>`), and dates sit on their own line. This was found and fixed from the first Arabic screenshot, where a code, a label and a date ran together.

### REQ-S15-009: 360 px review, approval and KPI-update flows (FE-F2 part)

Acceptance (quoted): *"A20: e2e tests at 360 px approve a gate item and submit a KPI actual in Arabic and English"*. Procedure: *"… adapt to 360 px, 768 px and 1440 px widths without horizontal scrolling of primary actions"*.

**What the spec checks.** At 360 × 800 in en and ar, on the real stack:

- the Sponsor approves the submitted product gate G1, including the three leadership confirmations;
- the Sponsor approves a P4 business approval request at `/my-work/approvals/:id`;
- the KPI owner submits an actual;
- the Business Owner accepts it in the KPI review queue.

At each step it checks:

- `documentElement.scrollWidth <= 360`;
- each primary action button lies within 0–360 px **and** is the element hit at its centre after a vertical-only scroll. Any sideways scroll the browser makes is undone first, so a table that must be scrolled sideways fails the check.

Results are read back through the API: G1 `approved`; the approval `approved` with 1 decision; 1 actual `submitted`, then 1 `accepted`. A 768 × 1024 pass opens the same four screens.

**Defect found and fixed.** In the KPI review queue at 360 px, the Accept button sat at x ≈ 871 px (en) and −332 px (ar) inside the table's scroll region, so it needed a sideways scroll. The fix moves Accept/Reject into the KPI row-header cell (see §1). The gate page, gate decision dialog, approval detail, approval dialog and KPI actual form already passed. `p6-flows-360.spec.ts` now passes 10/10.

**Screenshots:** `screenshots/{en,ar}/p6-360-{gate,gate-decision,approval,approval-decision,kpi-actual,kpi-actual-submitted,kpi-review}.png` and `p6-768-kpi-review.png`.

Every label in the gate flow says "business approval". No DG0–DG7 appears; the spec asserts this.

### REQ-S15-012: keyboard walkthrough and axe scope (FE-F2 part)

Acceptance (quoted): *"A20: an automated axe scan reports no serious or critical violations on key screens; the guided walkthrough can be completed by keyboard alone"*.

**Keyboard walkthrough (§7.1).** `p6-walkthrough-keyboard.spec.ts` passes in en and ar on the demo stack (2/2). After sign-in it uses only key presses:

1. The skip link takes focus into the page.
2. Step 1 "create transformation" is done in its native form: business unit chosen with arrow keys, name typed, Enter.
3. On `/walkthrough`, the picker is reached by Tab and set with arrow keys. Progress reads 1 and step 1 shows done.
4. All twelve step links are reached by Tab, in order. Shift+Tab goes back to step 10, and Enter opens it.
5. Step 10 "generate report" is done by keyboard: output chosen with arrow keys, Generate with Enter.
6. The walkthrough reads back progress 2.

Every focus stop is checked for a visible indicator (computed outline or box-shadow).

**No unreachable control or focus trap was found** in the walkthrough or the controls it reaches, so no fix was needed there.

One observation outside my ownership (§6 item 3): after an in-app link navigation, focus stays where the link was rather than moving to the new page.

**Axe scope (§7.2).**

- `axe-scope.test.ts` (4/4):
  - finds the routes added in P6: `routes` of `router.tsx`, flattened, minus the DG5-approved router's literal paths (frozen in the test from commit `660f40c`, D-193) and the generated DG4/DG5 routes. This gives 32 routes today.
  - fails when one is missing from `P6_AXE_ROUTES`. Mutation check: removing `/search` from the list made it fail with `+ "/search"`.
  - fails when a listed route or key flow is not a router route. This caught two wrong patterns in my own first draft of the key-flow list (`health-checks/:assessmentId`, `business-cases/:caseId/financial-metrics`), now corrected.
- The axe scans themselves are QA-D's (A20). My new specs run axe on every screen they open: 0 serious or critical issues.

## 3. Operations routed

None. This is a web-only task with no API operation, so there is no `p6-pending-*` or `p6-exercises-*` file and no pinned-count change. `contract.test.ts` is unaffected: 932 operations (`pnpm openapi:lint`).

## 4. Checks, with exit codes and counts

All commands ran in the worktree on Node 24.21.0, offline.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | **exit 0**, "PASS gate DG5 (historical)" | `validate-historical-DG5.txt` |
| `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| `pnpm -r build` | **exit 0** | `build.log` |
| `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §8 (first run: exit 123, one file, fixed) | `prettier.log` |
| `pnpm openapi:lint` | **exit 0**, OpenAPI 3.1.1, 932 operations | `openapi-lint.log` |
| `pnpm test`, locale unset | **exit 1**: 1 pre-existing failure, not FE-F2 (below) | `unit-locale-unset.log` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | **exit 1**: the same counts and the same single pre-existing failure as with the locale unset | `unit-locale-c-utf8.log` |
| `QA_PG_PORT=26510 MTH_PORT_POOL=26511-26549 tests/qa/support/with-pg.sh pnpm test:integration` | see §8 | `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` (end) | **exit 0** | `validate-historical-DG5-end.txt` |

**`pnpm test`, locale unset: counts per Vitest invocation**

| Invocation | Files | Tests |
|---|---|---|
| 1 | 182 passed | 2762 passed |
| 2 (`unit-web` and others) | 113 passed, 1 failed | 1956 passed, 1 failed |
| 3 | 3 passed | 259 passed, 2 skipped |

The single failure is `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx:461`, "identity shows whether a client secret is configured, never a secret value":

- It asserts that `document.querySelector("input, textarea")` is null.
- It finds the shell header's global search input (`global-search__input`, T-DG6-FE-D).
- **It fails identically on a pristine clone of `HEAD` `ee20f5ec` without any FE-F2 change** (`preexisting-p6-admin-screens-on-pristine-HEAD.log`, exit 1). It is deterministic and pre-existing: a seam between FE-B's test and FE-D's header. It belongs to the orchestrator or the FE-B/FE-D owner, and I did not edit either file.
- All of my own unit tests pass:
  - `axe-scope.test.ts` 4/4;
  - `home-regions.test.tsx` 9/9;
  - `executive-regions.test.tsx` 7/7;
  - the KPI, dashboards, my-work, executive-overview and app folders: 20 files, 391 tests, all passing.

**e2e (not required by the assignment; run because the change is visible)**

1. `apps/web/e2e/support/with-stack.sh npx playwright test <my 3 specs + p4-kpi, p4-dashboards, p4-value-headlines, p4-governance, p4-traceability, session-end, p5-table-regions-axe> --workers=1`, run while the full `pnpm test` ran in parallel (the loaded measurement): **exit 1**. Results: 90 passed, 2 skipped, 2 failed, 2 did not run. Log: `e2e-p6-fe-f2-and-neighbours.log`.
   - **Skipped (2):** `p6-walkthrough-keyboard`, en and ar. It needs a demo database, and this stack is production-marked. This skip is by design and the spec states it.
   - **Failed (2):** `session-end.spec.ts:335` en and ar, "a 403 is not a session end", on `/about`. At 320 px the wordmark's content overflows by 14 px (en) and 78 px (ar).
     - **It fails identically on a pristine clone of `HEAD`**: same 14 px and 78 px; the web dist was built from the pristine clone. Log: `preexisting-session-end-335-on-pristine-HEAD.log`, exit 1.
     - FE-G's earlier full run (`T-DG6-FE-G-evidence/e2e-full-unset.log:387`) passed it. So a later merge broke it, most likely the header search box of T-DG6-FE-D. It is pre-existing and not FE-F2's: I changed no shell, header or CSS file.
   - **Did not run (2):** `session-end.spec.ts:453`. The file is serial, so it stops after `:335` fails.
   - **All other neighbours pass**, including p4-kpi's review-queue accept, which uses the moved button.
2. `e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/p6-walkthrough-keyboard.spec.ts --workers=1`: **exit 0**, 2 passed. Log: `e2e-p6-walkthrough-keyboard-demo-stack.log`.

**Budgets** (rule 15; measured loaded worst cases from the logs above)

| Spec | Worst case | Budget |
|---|---|---|
| `p6-layout-1440` | 8.9 s | 60 s (> 6x) |
| `p6-flows-360` | 8.4 s | 60 s (> 7x) |
| `p6-walkthrough-keyboard` | 14.5 s | 90 s (> 6x) |

Each spec states its budget in its header.

## 5. Contract, schema or dependency needs

None. Requests for the orchestrator at merge:

1. **Provisional-Arabic list.** Fold `"myWork.home.": "fe-f2"` from `pages/my-work/provisional-ar.ts` into FE-A's `i18n/provisional-ar-p6.ts` (it needs an `"fe-f2"` source), or keep my file. Both work; mine is tested.
2. **Catalogue merge.** The `home` block of `i18n/{en,ar}/myWork.json` is append-only (a new top-level key).
3. **Ownership of `e2e/support/p6-axe-screens.ts`** moves to QA-D. When later P6 slices add router routes (for example saved views or drafts from FE-D2), `axe-scope.test.ts` fails until they are listed there. That is intended.

## 6. User-facing texts made untrue; observations for other owners

1. **No existing en/ar text called these features planned or later.** I checked `myWork`, `dashboards`, `common`, `kpiP4` and `playbookP5`. The new texts describe exactly what the regions show. The KPI review queue no longer has an "Actions" column header; the actions keep their accessible names ("Accept: <KPI> · <period>").
2. **Pre-existing failures (not FE-F2; owner: orchestrator, FE-B or FE-D, or the shell owner):** `p6-admin-screens.test.tsx:461` and `session-end.spec.ts:335` (§4), both reproduced on pristine `HEAD`.
3. **Shell focus after in-app navigation (observation, shell owner FE-A).** After an in-app link is activated (for example a walkthrough step link), the shell does not move focus to the new page. The next Tab continues from the old link's place in the navigation, so a keyboard user must Tab through the rest of the navigation to reach the content. It is not a trap; everything is reachable, and the walkthrough spec proves it. Moving focus to `main`/`h1` on route change would be better. It belongs to `app/Shell.tsx`, which I don't own.

## 7. What remains

- **QA-D's acceptance proofs:**
  - A20 1440 px en/ar on both pages;
  - 360 px and 768 px flows;
  - keyboard-only walkthrough en/ar;
  - axe on `P6_AXE_ROUTES` and `KEY_FLOW_AXE_SCREENS`, with the §3 chip rule and greyscale screenshots.

  QA-D should use the region names `myWork.home.{decisions,outcomes,nextActions}.title` and the `data-glance-region` hooks.
- **Requirements not yet complete:** REQ-S15-001, REQ-S15-009 and REQ-S15-012 each need QA-D's proof before they are complete (§I/K.10). FE-F2's parts of the three rows are delivered.

## 8. End-of-run results

- **Format.** The first whole-tree run exited **123**: one file, `apps/web/src/pages/my-work/HomeRegions.tsx`, needed whitespace-only formatting. I fixed it with `prettier --write`. The re-run is in `prettier.log`; its exit code is the last line.
- **Final lint and typecheck after that fix:** `pnpm lint` **exit 0** (`lint-final.log`); `apps/web` `tsc -p tsconfig.json && tsc -p tsconfig.e2e.json` **exit 0** (`typecheck-web-final.log`). The full `pnpm -r typecheck` and `pnpm -r build` (exit 0) ran before this whitespace-only change.
- **Integration** (`QA_PG_PORT=26510 MTH_PORT_POOL=26511-26549 tests/qa/support/with-pg.sh pnpm test:integration`, log `integration.log`): **exit 1.** The run finished at about 22:52Z, just after the time limit: **Test Files 4 failed | 383 passed (387); Tests 5 failed | 3977 passed | 1 skipped | 2 todo (3985)**. There is no pinned-count change from FE-F2. The 5 failing tests are all in the API, database, contract and QA suites:
  - the rate-limit class `assistant` and the log line (ADR-0052 §4; ADR-0059 §9 rule 3) > over the per-minute budget a post is 429 with Retry-After; each post writes one log line without the prompt 251m
  - REQ-S18-003 / REQ-S18-001: production and demo databases are separate, and a production database stays clean > a separately initialized demo database: seeded, reported synthetic; reset twice gives ide
  - every operation, validated against the contract and the zod mirrors > P5 BE-J operations (p5-exercises-be-j.ts) 225ms
  - every operation, validated against the contract and the zod mirrors > every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written 30002ms
  - getSecurityRateLimits > ADM_TECH and AUD read every class with its configured budget, key and operations (ADR-0052 §4) 24ms
  FE-F2 changed no file under `apps/api/**`, `packages/**`, `docs/api/**` or `tests/qa/**`. These failures cannot come from this change, which touches only `apps/web/**` and `e2e/support/p6-axe-screens.ts`. One of them is a 30 s timeout under the parallel load of this run. I did not have time to re-run each one alone or on pristine `HEAD`.
  **The orchestrator must run `pnpm test:integration` on the merged tree** (D-193 rule). I have not re-run the five failures alone, or on pristine `HEAD`, to separate load from a real seam.
- **Time:** ended 2026-10-30T22:53Z (`date -u`), about 2 hours after the start. The integration suite took most of the second hour.
