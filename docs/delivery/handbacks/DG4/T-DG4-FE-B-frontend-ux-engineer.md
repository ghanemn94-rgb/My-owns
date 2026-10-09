# Handback T-DG4-FE-B: P4 slice A KPI screens (frontend-ux-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. This is an engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6), and no product gate implies any DG gate. All test and demo data is SYNTHETIC. The trajectory approval in the e2e journey is a synthetic, in-product demo business approval that approves nothing real.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-B-frontend-ux-engineer-20261009T103355Z-9aa622bd","session_id":"9aa622bd-2c8d-4ab7-ae78-43813feb82de"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-B.md`, sha256 `02eb8976…7c6c` (verified with `sha256sum` at the start; it matches).
- **Worktree / base:** `/home/user/wt/dg4-fe-b`, branch `dg4/fe-b`, base `HEAD` `b1d3b7f`. **Nothing is committed**: the changes are left in the working tree for the orchestrator.
- **Time:** `date -u` at the start: `Fri Oct  9 10:34:13 UTC 2026`; at the end: see §7.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)`, exit 0, before any implementation. It was re-run at the end (§4).
- **Scope read:** `p4-work-split.md` §1 (S-1…S-14) and §A (A.5 is FE-B's paragraph, A.7 rows), `p4-plan.md` rows for FE-A/FE-B and §5.3, ADR-0027 (all; §13 verbatim), ADR-0028 §1–§7 (via the library and status code), `openapi.yaml` (the 39 slice A operations), the zod mirrors `schemas/kpi-versions.ts` and `schemas/kpi-actuals.ts`, D-088…D-101, and the FE-A, KBE-B and KBE-C handbacks.

## 1. Changed files

### Owned: `apps/web/src/pages/kpi/**` (new)

| File | Purpose |
|---|---|
| `pages/kpi/api.ts` | `kpiPaths`: the request paths of all **39** slice A operations, with the operationId in a comment on each. Read hooks on FE-A's `p4Keys.area(<slice A area>, tid, …)`, so `useP4Refresh(tid)` refreshes every KPI view after a mutation. `usePeriodChoices` provides the period fallback described in §5.1. |
| `pages/kpi/ui.tsx` | Shared kit. `RagChip` uses a label and an icon for six statuses: green, amber, red, unknown, stale and not computable. `KpiValue`/`ValueState` render Unknown, Stale and Not computable as grey labelled chips with their reason, never 0 and never green. Also: `ActualStatusChip` (shows "Draft – not submitted" distinctly), `RecordChip`, `KpiSubNav`, decimal-exact formatting (percentages are fractions; `times100`, `toStoredValue`), `formatThreshold`, and `ConfirmActionDialog` for body-less action POSTs (If-Match, no body; S-3). |
| `pages/kpi/KpisPage.tsx` | `/transformations/:id/kpis` has three sections: (1) KPI status overview (`listKpiStatus`) with the displayed RAG, actual, expected to date and freshness; (2) KPI dictionary v2 (`listKpiDictionary`) with the active version and "ready to measure" (`missingForUse`); (3) the organization's reporting periods (list, create, open, close; `reporting_period.manage`). |
| `pages/kpi/KpiPage.tsx` | `/transformations/:id/kpis/:kpiId`. **RAG panel** with the seven elements and a plain-language rule explanation that names the threshold (configured version N, or the default rule) and the trajectory version. An override in force is shown beside the calculated RAG. **Versions:** create draft (incl. formula KPIs with up to 3 inputs), edit draft (PATCH, If-Match), activate, request business approval, withdraw. **RAG thresholds:** list and new version. **Target trajectories:** create draft ("date value" per line), business approval, withdraw. **Manual RAG overrides:** reason, evidence and expiry in the transformation's time zone; revoke. **Calculation runs** for this KPI. |
| `pages/kpi/KpiUpdatePage.tsx` | `/transformations/:id/kpis/:kpiId/actuals`. The **four-step routine update** is one form with four numbered fieldsets: 1 the KPI (unit, frequency, active version, route); 2 the period; 3 the value, or "not available" with a reason, plus data as-of, comment and evidence checkboxes; 4 Submit or Save draft. If an actual already exists for the slot, the entry becomes value version N+1 (`addKpiActualValue`, If-Match), and a saved draft can be submitted as it is (`submitKpiActualDraft`). The confirmation lists the `downstream` views, "Review pending" (or accepted at once) and the Finance review state ("Finance review pending" / not needed / Unknown). Below the form: the KPI's actuals list. |
| `pages/kpi/KpiActualPage.tsx` | `/transformations/:id/kpis/:kpiId/actuals/:actualId`, which is KBE-C's work-item link. It shows one slot: every value version (value, "not available" and its reason, evidence links) and every review ("B on behalf of A"). Notes say whether the value is used: pending review → not used; draft → not used; rejected → enter a correction. **`KpiReviewPage`** (`/transformations/:id/kpi-review`) is the review queue with Accept (optional comment) and Reject (reason). The submitter is shown "someone else reviews it", not the buttons. |
| `pages/kpi/DataQualityPage.tsx` | `/transformations/:id/data-quality`: findings (eight rule codes with plain-language help), a status filter, and resolve or dismiss with a note (If-Match). |
| `pages/kpi/kpi.test.tsx`, `pages/kpi/kpiFixtures.ts` | 27 unit tests (3 helper tests + 12 per language), with synthetic fixtures. |

### e2e (new)

| File | Purpose |
|---|---|
| `apps/web/e2e/p4-kpi.spec.ts` | Real-stack journey, 9 tests × 2 projects (described in §2 and §4). Synthetic users (KPI owner KDS, Business Owner, Sponsor, Auditor) are created through the admin API, as in FE-A's spec. |

### Translations

| File | Purpose |
|---|---|
| `apps/web/src/i18n/{en,ar}/kpiP4.json` (new) | The page namespace, 433 keys per language with identical key sets. It includes `kpiP4.problem.formula__*` (the 10 formula-engine codes, with the same texts as `benefitFormulas.problems`, which `p4ProblemMessage` reads first). |
| `apps/web/src/i18n/{en,ar}/problems.json` | **Append-only**, allowed by the assignment: 54 keys per language. These are every ADR-0027 §13 code (49, except `routing.role_unmapped`, which FE-A already had, and `formula.*`, which is in `kpiP4.problem`). Also KBE-B's reported `kpi_definition.archived`, the slice A validation pointers `variable_name`, `trajectory_points_or_source`, `trajectory_point_dates_distinct` and `period_label`, and a UI-side `validation.trajectory_point`. `unique_items` and `min_properties` already existed and were not changed. KBE-B's other reported codes (`validation.constraint`, `validation.reference`) already existed. KBE-C reports no extra refusal codes beyond ADR-0027 §13. |

### Outside `pages/kpi/**` (each is a minimal edit, disclosed here)

| File | Edit | Why |
|---|---|---|
| `apps/web/src/app/router.tsx` | The 6 FE-B entries are removed from `P4_PLANNED_ROUTES` and registered as real routes with the same paths. | The assignment says "swap them in". |
| `apps/web/src/i18n/index.ts` | 2 import lines and 2 catalogue entries register `kpiP4`. | Same as FE-A's precedent for its namespaces. The parity test requires every file on disk to be registered. |
| `apps/web/e2e/p4-governance.spec.ts` (FE-A's) | 1 line: the "planned route" step opens `/benefits` instead of `/kpis`. | The same reason as below (§4, item 1). |
| `apps/web/src/pages/my-work/my-work.test.tsx` (FE-A's) | 2 lines: the "planned route shows being built" test now uses `/transformations/:id/benefits` (FE-C, still planned) instead of `/kpis`, which is now built. | Without this, the frozen test fails once the KPI route is real. The assertion is unchanged. |

No file in `apps/api`, `apps/worker`, `packages/**`, `docs/api/**`, `tools/**`, `docs/source/**`, `components/**`, `styles/**`, any `package.json` or the lockfile changed.

## 2. Behaviour delivered, per requirement row (acceptance text quoted)

FE-B owns the rendering side of the slice A rows in A.5 and A.7. The API behaviour belongs to KBE-A, KBE-B and KBE-C.

- **REQ-S07-008**, "A04;A20: the KPI panel shows all seven elements in en and ar; the explanation names the threshold used".
  - The RAG panel renders actual, expected to date, final target (with date), variance (pp for a percentage KPI, else unit and %), trend, data freshness (status, as-of date, stale-after days) and the rule explanation.
  - The explanation names the threshold: "Threshold used: version N (configured), amber from 5 %, red from 10 % (Relative (%))", or "the default rule …", or "No threshold was used". It also names the trajectory version.
  - Unit (EN+AR): all seven `data-element`s are present; the explanation equals the configured-threshold text for version 3; the override shows the calculated RAG beside it.
  - e2e on the real API (EN+AR): seven elements visible; `[data-threshold-version='1']` contains "version 1 (configured), amber from 5 %, red from 10 %" (`p4kpi-08-rag-panel-seven-elements`).
- **REQ-S07-017**, "A04;A20: a keyboard-only user completes an update in four steps; the confirmation lists affected dashboards and 'Finance review pending' where applicable".
  - The single form has four numbered fieldsets ("Step 1 of 4: KPI" … "Step 4 of 4: submit").
  - e2e step 4 (EN+AR, real API) uses the **keyboard only**: Tab to the period select, ArrowDown to choose, Tab to the value and type it, Tab to the evidence and press Space, Tab to Submit and press Enter. Focus then moves to the confirmation.
  - The confirmation lists every `downstream` item the server returns, each translated from its kind: for example "This KPI's status panel" (a link) and "Executive Overview: outcomes", plus "A KPI calculated from this one" and "A benefit measured by this KPI" when present.
  - It also shows "Review pending: the value is not used until the reviewer accepts it" and the Finance review state. `pending` displays **"Finance review pending"**. On the e2e stack the server answered `not_applicable` (shown "No Finance review needed for this KPI.") because no benefit is linked. The unit test covers `pending`, and the e2e asserts the text matching whatever state the server returns.
  - Screenshots: `p4kpi-05-update-form`, `p4kpi-06-update-confirmation`.
- **REQ-S07-006** (rendering half), "A05: a KPI with no actual for the current period renders Unknown (grey, labelled) and contributes no zero to aggregates".
  - No actual gives the grey `status-chip--unknown` labelled "Unknown (no accepted actual for this period)". The RAG chip is "Unknown", never green, and the value cell contains no 0.
  - Checked by unit tests (panel and status list) and e2e step 3 (`p4kpi-04-rag-panel-unknown`).
  - After acceptance, the e2e stack (no worker, §5.3) honestly shows "Unknown (calculation pending)".
  - Roll-up arithmetic is KBE-A/KBE-C's.
- **REQ-S07-003 / REQ-S07-012 / REQ-S07-013** (display side).
  - A second entry for the same slot is sent as value version N+1 of the same actual: unit test, If-Match `"4"`, URL `/kpi-actuals/{id}/values`. The form says "Your entry becomes version 2 of the same actual".
  - A submitted value is labelled "Submitted – review pending" and "not used until it is accepted". A draft is labelled "Draft – not submitted … not used".
  - The reviewer's accept dialog says it "triggers one calculation run".
  - The submitter is never offered accept or reject (unit; the server's 403 `kpi_actual.sod_submitter` is translated).
- **REQ-S07-009** (display side). The override form requires reason, evidence and expiry. Their 422s are translated, and the expiry is entered in the transformation's time zone and converted to UTC. The panel shows "Displayed as Amber by a manual override (calculated: …) until …". e2e step 7 (`p4kpi-10-override`).
- **REQ-S07-001 / REQ-S07-007 / REQ-S07-011** (forms).
  - Version drafts carry the aggregation rule, which is required before activation (422 translated). The dictionary lists `missingForUse`.
  - Thresholds are versioned (relative values typed as percent are stored as fractions).
  - Trajectory approval is labelled **"business approval"** and is not offered to read-only roles. The server refuses the author (403 `target_trajectory.approver_is_author`, translated).
  - Formula KPIs: `kpi_formula.circular` and `formula.kind_mismatch` are translated.
  - e2e step 2 drives version → activate → threshold → trajectory through the UI (`p4kpi-02`, `p4kpi-03`).
- **S-6 / S-11.** Every ADR-0027 §13 code is translated in EN and AR, as are the formula codes and KBE-B's reported generic codes (unit test per language).
- **S-7.**
  - Every dialog has one form-level alert. The update form has one alert; a 409 shows "nothing was saved; the latest data has been loaded" (unit).
  - Every action is inside `beginSessionGuard()`.
  - The auditor sees read-only views: no write action (unit; e2e step 8, `p4kpi-12-auditor-read-only`).
  - No DG0–DG7 label appears (unit asserts `/\bDG[0-7]\b/` is absent).
- **Calendar caveat.** A reporting period's update due date is shown as **Unknown** ("no due date (no working-day calendar or not set)") when the server has none. No date is guessed. e2e step 1b (`p4kpi-01b-reporting-periods`).
- **390 px and 200 % text** (the gap FE-A carried). e2e step 8 checks the KPI page and the update form at 390 px wide, and at 200 % root text size. In each case the document does not scroll sideways (`scrollWidth − innerWidth ≤ 1`); tables scroll inside their own labelled region. Axe gives 0 serious or critical issues at 390 px. Screenshots `p4kpi-13…16`.

## 3. Operations routed (pending-list delta)

FE-B has **no** `p4-pending-fe-b.ts` or `p4-exercises-fe-b.ts`. All 39 slice A operations were routed by KBE-B and KBE-C (`p4-pending-kbe-{b,c}.ts` are empty at base). **Delta: none.** The web client now *calls* 34 of the 39. It does not call `getReportingPeriod`, `getCalculationRun`, `getKpiVersion`, `getTargetTrajectory` or `getDataQualityFinding` directly; their lists carry the same records. Their paths are in `kpiPaths`. `contract.test.ts` is untouched.

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-FE-B-evidence/`)

Environment: Node 24.21.0, offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (no browser installed). Ports were 24001 (e2e PG), 24002 (API) and 24003 (integration PG), with `MTH_PORT_POOL=24010-24049`. Empty `.claude/.cc-writes` directories inside source folders were removed before the test runs.

The last source change was before every run below. The one exception is the 1-line `p4-governance.spec.ts` retarget (§1); the two P4 specs were re-run after it, and lint, prettier, typecheck and validate ran last.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | all packages | `build.log` |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | PASS (unchanged contract) | `openapi-lint.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | invocation 1: 116 files, **2235 passed**; invocation 2 (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2235** passed; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=24003 MTH_PORT_POOL=24010-24049 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 106 files, **1199/1199** (equal to D-101; **no pinned count changed**) | `integration.log` |
| 4 | `E2E_PG_PORT=24001 E2E_API_PORT=24002 MTH_PORT_POOL=24010-24049 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **210 passed, 2 failed** (21.8 min). The failures are disclosed below: `p4-governance.spec.ts:290` in en and ar | `e2e-all.log` |
| 4 | the same harness, `npx playwright test apps/web/e2e/p4-governance.spec.ts apps/web/e2e/p4-kpi.spec.ts --workers=1`, after the fix | 0 | **34 passed** (governance 8 en + 8 ar, KPI 9 en + 9 ar), 0 failed, 0 flaky; axe 0 serious/critical on every `expectAccessible` page | `e2e-p4-specs-rerun.log` |
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)`, at the start and at the end | `validate-dg3-historical.log` |

Unit delta: 2208 (D-101) → 2235, i.e. +27, which is exactly my `kpi.test.tsx`.

**Per-spec e2e counts** (`e2e-per-spec-counts.txt`). The full run: every P1–P3 spec passed in both languages (journeys 9/9, p2-blank-text 9/9, p2-journeys 12/12, p3-business-cases 6/6, p3-g4-refusal 2/2, p3-inherited-approval 5/5, p3-journeys 18/18, p3-portfolio 6/6, p3-prioritization-roadmap 7/7, p3-seams 3/3, p3-ui-completion 7/7, session-end 5/5). `p4-kpi.spec.ts` (new) passed 9/9 per language. `p4-governance.spec.ts` was 7/8 per language in the full run and 8/8 per language in the re-run.

**Disclosed non-zero exits and failures (all fixed, none open):**

1. **Full e2e run, exit 1: `p4-governance.spec.ts:290` failed in en and ar.**
   - The step opened `/transformations/:id/kpis` and expected FE-A's "being built" placeholder. That route is now my real KPI page, so this is a consequence of the swap the assignment asks for.
   - Fix: a 1-line retarget of that step to `/transformations/:id/benefits` (FE-C, still planned), the same as the unit-test retarget. The two P4 specs were re-run green (34/34).
   - **The full 212-test suite was not re-run after this 1-line spec edit (time bound).** No application code changed between the full run and the re-run.
2. **`p4-kpi.spec.ts` development runs** (logs not kept; they ran in `$TMPDIR` before the final runs). The failures, and what fixed each:
   - (a) The Lead got 404 listing reporting periods → the honest note and the current-period fallback (§5.1).
   - (b) The keyboard walk started before ~30 nav and workspace links → a longer Tab walk.
   - (c) Axe `color-contrast` on a link inside the success banner → a neutral confirmation card (§5.4).
3. **Unit, first i18n run:** 1 failure. `kpiP4.actual.slotTitle` was Latin-only in Arabic ("{{name}}: {{period}}"), and the Arabic text now contains "الفترة". The first lint run had 2 unused variables, now fixed.

**Screenshots** (`T-DG4-FE-B-evidence/screenshots/{en,ar}/p4kpi-*.png`), 17 per language from the final re-run:
- 01 dictionary; 01b reporting periods (due date Unknown);
- 02 version draft form; 03 version, threshold and trajectory;
- 04 RAG panel Unknown; 05 update form (four steps); 06 update confirmation;
- 07 review queue; 08 RAG panel with seven elements; 09 actual accepted;
- 10 override; 11 data quality; 12 auditor read-only;
- 13 KPI page at 390 px; 14 update form at 390 px; 15 KPI page at 200 % text; 16 update form at 200 % text.

**Interaction checks actually run (e2e, real API):** create, activate and edit flows through dialogs; the keyboard-only four-step update; accept from the queue; an override with expiry; the auditor read-only view; 390 px and 200 % text with no page-level horizontal overflow.

## 5. For the orchestrator (contract, schema and ownership notes)

1. **Contract need: transformation-scoped roles cannot list reporting periods.**
   - `listReportingPeriods` requires `organization.read`. A Lead or a KPI owner (KDS) granted on the transformation gets **404**, so the routine update cannot list the open periods for the people who submit actuals.
   - **What the UI does now:** it offers the KPI's current period from `getKpiStatus`, with the note "Your role cannot list the organization's reporting periods, so the KPI's current period is offered". The KPIs page shows an honest note instead of "not found". The server still refuses a closed period with the 422 `kpi_actual.period_not_open`.
   - **Request:** a read of the open periods of the transformation's organization for `transformation.read` holders. That could be a `GET /transformations/{t}/reporting-periods`, or `listReportingPeriods` accepting transformation-scoped readers. This is a KBE-C / ARCH-02 decision.
2. **Workspace tab (not added: outside my ownership).** The KPI screens use `WorkspaceFrame tab="define"`, because `WorkspaceFrame` only accepts registered tabs. They are reached through the KPI sub-navigation, the backend's work-item links, and links from the KPI rows. A discoverable entry needs a one-line merge edit:
   - `{ id: "kpis", path: "/kpis", labelKey: "kpiP4.list.title" }` in `components/Workspace.tsx` `WORKSPACE_TABS`;
   - and/or `moreWorkspaceTabs: ["kpis"]` on the `strategy` area in `app/nav.ts`.
   
   Both files are FE-A's.
3. **No worker in the e2e stack.** `with-stack.sh` starts no worker, so an accepted actual stays "calculation pending" (Unknown) in the e2e journey. A green, amber or red panel from a real run is therefore not shown end to end. The panel's coloured states are covered by unit tests with the contract shape. The worker path is KBE-C's (`kpi-recalculate.test.ts`).
4. **`app.css` link-contrast rule.** FE-A's rule covers links in error and warning banners only. A link inside `banner--success` failed axe `color-contrast` in my first full run, so the confirmation is a neutral card. A future shared fix would add the success and info banners to that rule (FE-A/orchestrator).
5. **Names of people.** A transformation-scoped viewer cannot read other users, so approvers show as "Person ·c109" (FE-A's `useUserNames` behaviour). Unchanged.

## 6. Known gaps / not done

- **Discoverability:** there is no workspace tab or nav entry (§5.2). The routes, the sub-navigation and the work-item link work.
- **Scopes:** only the transformation scope is offered for trajectories and overrides. Business-unit and initiative entry is offered in the update form when the version's `entryScopeKind` says so; the initiative is chosen from the transformation's initiatives. Per-scope status views (`scopeKind`/`scopeId` query) are not exposed in the panel.
- **Formula KPIs:** at most 3 inputs from the UI (the API allows 30), always with `inputBasis: "period"`. `kpiVersionCreate`'s `baselineId` and the data-quality `validMin`/`validMax` are not exposed: the UI sends `validMin`/`validMax` as null and omits `baselineId`, so the API default (null) applies.
- **Import file (REQ-S07-017 "enter or import"):** single entry only, per D-089 Q9 (bulk import is P6).
- **Calculation run detail** (`getCalculationRun` evaluations) is not shown, only the run list.
- **Not checked on the e2e stack:** a coloured RAG from a real calculation run, because the stack has no worker (§5.3).

## 7. Merge instructions

- Apply the working-tree changes of `apps/web/**` and this handback with its evidence. There are no migrations, and nothing in `apps/api`, `apps/worker` or `packages/**` changed.
- Expect conflicts only with another FE task that edits `router.tsx` (`P4_PLANNED_ROUTES`), `i18n/index.ts`, or the end of `problems.json`. Resolve by union (append-only).
- The untracked top-level dotfiles and `CLAUDE.local.md` were mounted by the sandbox. They are not mine; do not integrate them.

**End:** `date -u` = `Fri Oct  9 12:09 UTC 2026` (about 1 h 35 min). The final checks finished at 12:08:43 UTC.
