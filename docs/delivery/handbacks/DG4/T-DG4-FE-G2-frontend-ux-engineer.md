# Handback T-DG4-FE-G2 (completed by the salvage run T-DG4-FE-G2B): frontend-ux-engineer

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Scope:** p4-work-split §J+K JK.7, the second half of FE-G: traceability, Modular entry, portfolios and workstreams, the dashboard RAG policy screen, and the transformation filter chip.
- **Run:** `DG4-T-DG4-FE-G2B-frontend-ux-engineer-20261010T094017Z-3b6b725c` (session `3b6b725c-00a1-458e-b9d7-cdac812ae690`).
- **Worktree and branch:** `/home/user/wt/dg4-fe-g2`, branch `dg4/fe-g2`.
  - Started from the WIP commit `4e92286`, whose parent is `983fdfa`.
  - The changes are left uncommitted for the orchestrator.
- **Start and end:** `date -u` gave `Sat Oct 10 09:40:27 UTC 2026` at the start and `Sat Oct 10 11:29:25 UTC 2026` (about 109 minutes) at the end.
- **Synthetic data:** every record in the tests and screenshots is SYNTHETIC.
- **Gates:** no product gate (G1–G6) is decided by this work, and nothing here touches or implies DG0–DG7. The demo Sponsor acceptances in the e2e setup approve nothing real.

## Salvage (D-103; the D-059/D-070 precedent)

I reviewed the WIP `4e92286` as if someone else had written it. The killed run's transcript (`docs/delivery/test-evidence/DG4/fe-g2-orphaned/`) was not used or cited. Every check below is fresh, run on the final tree by this run.

The WIP contained no log or handback, and `docs/delivery/handbacks/DG4/T-DG4-FE-G2-evidence/` was empty, so there was nothing stale to delete.

### Kept from the WIP (reviewed, not rewritten)

- **The API layer:** `pages/traceability/api.ts`. Every path matches `docs/api/openapi.yaml`; I checked the 38 slice J/K operations, `listGateDispensations` and the RAG-policy pair by script against the contract.
- **The screens:**
  - Traceability: `TraceabilityPage.tsx`, `TracePanels.tsx` and `ui.tsx`.
  - Modular entry: `ModularPage.tsx`.
  - Portfolios and workstreams: `StructurePages.tsx`.
  - The RAG policy: `dashboards/RagPolicyPage.tsx`.
  - The transformation chip in `dashboards/ui.tsx` and the hub link in `DashboardsPage.tsx`.
- **The i18n catalogues:** `i18n/{en,ar}/traceability.json`, with an identical EN/AR key set (`i18n.test.ts` checks this). `dashboards.json` is append-only; its diff removes only two closing braces.
- **The shared-file edits, all append-only:**
  - `router.tsx`: 7 routes and 4 imports. One line is removed: FE-G's planned-route placeholder `transformations/:id/traceability`, whose owner comment said "traceability is FE-G2's". This task replaces it with the real route, so keeping it would have registered the path twice.
  - `nav.ts`, `nav.json`: 2 sub-pages.
  - `Workspace.tsx`: 3 tabs.
  - `i18n/index.ts`: 1 namespace.
- **The tests:** the unit tests (`traceability.test.tsx`, 32 tests) and the e2e spec (`p4-traceability.spec.ts`).
- **Points I checked in the WIP and found correct:**
  - The RAG policy's version-0 read sends `If-Match: "0"` on the first save. `api.send` tests `ifMatch !== undefined`, so version 0 is not dropped as falsy.
  - A 409 reloads the policy without overwriting what the user typed.
  - "Clear all" also clears the `tr` chips.
  - The transformation chip and the business-unit chip intersect; an empty intersection sends no request, so it is never read as "all".

### Changed, and why

1. **The gate-label text was doubled** (`ModularPage.tsx`). The Modular gate table rendered "Inherited — Inherited - recorded, not granted in platform", which my review of the EN screenshot exposed. It now shows the canonical label text once ("Inherited - recorded, not granted in platform"; the Arabic text is provisional).
   - The unit and e2e assertions now check the full label text instead of the bare word "Inherited", which the doubled text also satisfied.
2. **The workstream code column sorted by record id** (`StructurePages.tsx`). It now sorts by the numeric part of `WS-nn`, so WS-09 comes before WS-10.
3. **Editing a trace link could send an unchanged share** (`TracePanels.tsx`). The edit compared the typed share "0.6" with the stored "0.600000" as strings, so it sent an `allocationShare` member that changed nothing. It now normalises the typed value to `numeric(7,6)` with the shared decimal helper `traceAllocationTotals` before comparing; no floats are involved.

### Added

- **e2e step 1b: a Modular-links waiver in force** (scope item 2, REQ-PB-005, D-110 (a)). It was missing from the WIP.
  - The Lead records a G3 waiver with no initiative, through the contract's `GateDispensationCreate`; the synthetic Sponsor accepts it.
  - The Modular entry screen then shows the waiver in force, with its expiry and reason. Both blocking links stay listed, and no gate is labelled approved.
  - Screenshot `p4trace-04b-waiver-in-force`, with axe.

## Files changed (against `983fdfa`)

| File | Purpose |
|---|---|
| `apps/web/src/pages/traceability/api.ts` | Request paths and read hooks of slice K, portfolios, workstreams and the RAG policy |
| `apps/web/src/pages/traceability/TraceabilityPage.tsx` | The chain graph (clickable nodes, focus, depth, direction) and the orphan report |
| `apps/web/src/pages/traceability/TracePanels.tsx` | The impact panel, allocation sets (total, unallocated, 110 % refused with the would-be total) and trace links (create, edit, remove with a reason) |
| `apps/web/src/pages/traceability/ModularPage.tsx` | Modular entry: mode, gate labels, missing links, the waiver in force, and inherited records (create, `getInheritedRecord` view, withdraw) |
| `apps/web/src/pages/traceability/StructurePages.tsx` | Workstreams (`WS-nn`, initiatives, one placement), portfolios (create, edit, archive, transformations, one placement) |
| `apps/web/src/pages/traceability/ui.tsx` | Node-type texts, record web paths, decimal `Pct`, `StatusTag` (icon and text), sub-navigation, the reasoned action |
| `apps/web/src/pages/traceability/traceability.test.tsx` | 32 unit tests, EN and AR |
| `apps/web/src/pages/dashboards/RagPolicyPage.tsx` | The RAG policy screen: version 0 / `If-Match: "0"`, area thresholds, deadline horizon, read-only and no-permission views |
| `apps/web/src/pages/dashboards/ui.tsx` | The repeatable transformation chip (≤ 50, readable only), the organization scope line |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx` | A link to the RAG policy from the dashboards hub |
| `apps/web/src/app/router.tsx`, `app/nav.ts`, `components/Workspace.tsx`, `i18n/index.ts` | Append-only wiring (see Salvage) |
| `apps/web/src/i18n/{en,ar}/traceability.json` | New namespace (EN/AR) |
| `apps/web/src/i18n/{en,ar}/dashboards.json`, `{en,ar}/nav.json` | Appended keys (RAG policy, chip, 2 nav labels) |
| `apps/web/e2e/p4-traceability.spec.ts` | Real-stack e2e: 6 tests × 2 languages |
| `docs/delivery/handbacks/DG4/T-DG4-FE-G2-*` | This handback and its evidence |

**`problems.json` keys added: none.**
- FE-R1 (D-112) already placed every ADR-0037 §13 / ADR-0038 §12 code, and `problems-slices-hijk.test.ts` reads the ADR tables against it.
- The one page-namespace text, `traceability.problem.trace_link__allocation_exceeds_total`, only adds guidance ("Lower a share or remove a link first"). The 110 % dialog also shows the exact total it would have reached.

**`myWork.json` keys added: none.**

## Behaviour delivered, per requirement row (each acceptance text quoted)

**REQ-PB-044.** Acceptance: "A01: an initiative without a TOM gap appears in the orphan report; clicking a node opens the linked record".
- The orphan report lists the initiative, with the expected step "From TOM gap to Initiative", translated, filterable and paged.
- Clicking its graph node opens `/transformations/:id/initiatives/:iniId`.
- Each node type maps to a real web screen, so no node leads to "page not found". A deliverable opens its initiative.
- Proven by e2e test 2 in EN and AR, and by unit tests.

**REQ-S03-006.** Acceptance: "A01;A10: one initiative links to two gaps and two KPIs; an allocation link set totalling 110% is rejected; changing a KPI target lists the linked benefits and dashboards as affected".
- **110 % refused:** in e2e test 2, a 60 % capability → KPI link plus a 40 % contribution share gives a set total of 100 % with 0 % unallocated. Raising the link to 70 % is refused with `trace_link.allocation_exceeds_total`, translated, and the dialog shows "110%".
- **Impact:** the impact of the KPI definition lists the T10 areas and the dashboards (executive, and transformation/Outcomes). Records the caller cannot read are counted in `hiddenCount` and never listed.
- **Not shown in the UI e2e:** "two gaps and two KPIs". The graph renders any number of edges, but BE-M's integration test proves this clause.

**REQ-PB-005.** Acceptance: "A03: a transformation entering at Design with no baseline and no outcome links shows both as missing and G3 submission is rejected by the API until they are supplied or an authorized waiver exists".
- The Modular entry screen shows `baseline_missing` and `outcome_link_missing` as blocking, each with a link to where it is supplied.
- With an accepted G3 links waiver, the screen shows the waiver in force (step 1b) and the links stay missing.
- After the outcome link is added, only the baseline remains.
- The API refusal of G3 itself is BE-M2/BE-R3's; FE-F's e2e covers the gate submission.

**REQ-S03-005.** Acceptance: "A03: entering at Design with an inherited G2 approval document shows G2 as 'inherited' (not Approved); a missing baseline and outcome link are flagged and G3 submission is rejected until supplied or waived".
- G1 and G2 are labelled "Inherited - recorded, not granted in platform", and no gate is labelled approved (e2e test 1).
- The prior approvals are listed read-only, with a link to the gate dispensations.
- Inherited baselines and evidence are recorded through the form, read on their own through `getInheritedRecord` and withdrawn with a reason (If-Match). A withdrawn record stays in the history.

**REQ-S03-001.** Acceptance: "A02;A12: two transformations in different business units are listed separately; a user scoped to one business unit cannot list the other's transformations".
- **Screens:** portfolio and workstream lists, create and edit, archive (read-only after archiving), and codes `WS-01` and `WS-02` in order.
- **One placement at a time:** an initiative in a second workstream and a transformation in a second portfolio are refused, translated (e2e test 3).
- **Readable only:** the portfolio "add transformation" list and the transformation chip offer only what DG1 `listTransformations` returns for the caller.
- The business-unit scope sweep itself is server-side (BE-M3 `bu-scope.test.ts`).

**REQ-S13-002.** Acceptance: "A04: filtering by period Q1 changes all tiles to Q1 values".
- The period filter is FE-G's. This task adds the transformation chip that REQ-S13-002 lists (ADR-0037 §4):
  - it is repeatable, up to 50;
  - it offers only readable transformations;
  - it is kept in the URL as `?tr=`;
  - it sends `transformationId` for each chip;
  - it shows "Scope: organization …".
- The business-unit chip stays as a convenience over this filter.
- Proven by e2e test 5 (the id is sent to `/api/v1/overview`) and by a unit test.

**RAG policy (ADR-0037 §3, §10; KBE-G; REQ-PB-063's configurable thresholds).**
- **Save rules:** the screen reads version 0 with `ETag: "0"`, and the first save sends `If-Match: "0"` (unit). Later saves send the version read (e2e: `If-Match` equals the version shown).
- **Fields:** the value-gap and milestone-slip thresholds, "due soon" for dependencies and decisions, the top-initiative count, and the My Work deadline horizon. An empty field means "use the default" and the effective value is shown.
- **Who may edit:** only `dashboard.configure` may edit. An auditor sees the read-only view; a business-unit Lead gets the translated not-found state (e2e test 4).
- **Refusals:** 409 (with a reload), 428, 422 `dashboard_rag_policy.threshold_order` and field errors are translated.

**Narrow width:** the five new screens were checked at 390 px and at 200 % text, with no page-level horizontal scroll (e2e test 6, both languages).

## Checks (final tree, run by this run)

Environment:
- Node 24.21.0, offline.
- Harness ports 25851–25899 (`E2E_PG_PORT`, `E2E_API_PORT`, `QA_PG_PORT` and `MTH_PORT_POOL` within that range).
- Logs: `docs/delivery/handbacks/DG4/T-DG4-FE-G2-evidence/`, with ANSI colours stripped.
- Disk: `df -h .` showed 18–19 GB free before every full run.
- Empty `.cc-writes` directories were removed before the tests.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-dg3.log` |
| 1 | `pnpm -r typecheck` | 0 | | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | | `build.log` |
| 1 | `pnpm lint` | 0 | | `lint.log`; re-run at the end, see below |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | | `prettier.log`; re-run at the end, see below |
| 1 | `pnpm openapi:lint` | 0 | | `openapi-lint.log` |
| 2 | `pnpm test`, locale unset | 0 | 141 files, **2691 passed**; formula-nocodegen **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=25860 MTH_PORT_POOL=25861-25899 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **1779 passed, 1 failed** (1780) | `integration.log` |
| 3 | the failing file alone | 0 | 2/2 passed | `integration-rerun-benefits-queue.log` |
| 3 | full integration re-run (`QA_PG_PORT=25864`) | **1** | **1779 passed, 1 failed**: the same test | `integration-rerun.log` |
| 4 | `p4-traceability.spec.ts` alone, before the final edits | 0 | 12/12 | `e2e-trace-1.log` |
| 4 | full product e2e `with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **307 passed, 1 failed, 2 did not run** (41.4 min) | `e2e-full.log` |
| 4 | `journeys.spec.ts` + `p4-traceability.spec.ts` after the fix | 0 | **30/30** (3.2 min) | `e2e-rerun-journeys-trace.log` |

**Unit tests.** The 32 new `traceability.test.tsx` tests are in the counts above. Against D-112's W15 count of 2547, the rest of the increase comes from W16's merged tests.

**Acceptance check 3 (integration) is NOT met.**
- **What fails:** `apps/worker/test/integration/benefits-queue.test.ts`, the test "one queue item; a redelivery and a restarted worker write no second item" (REQ-S12-014). It fails with `waitFor: timed out` at line 109 in both full runs, and passes alone (2/2).
- **Why this task should not affect it:** this task changes no file under `apps/api`, `apps/worker` or `packages` (`git diff --stat 983fdfa -- apps/api apps/worker packages` is empty). The web app is not part of the integration project.
- **What I did not do:** I did not run the suite on the base `983fdfa`. So I cannot say whether the base fails the same way, or whether the cause is load (three other agents were running) or test order. It needs the orchestrator, or the test's owner, on the base tree. I made no change to the test or its timeout.
- **Pinned counts:** unchanged by this task, which adds no integration test.

**Acceptance check 4 (e2e): the full run failed once; I fixed the cause and re-ran only the affected specs.**
- **What failed:** `[chromium-ar] journeys.spec.ts:477`, "administration screens", at line 411. It failed in 9.4 s, so it is not a timeout. `/admin/users` is sorted by display name and shows page 1 only. The chromium-ar run sees every synthetic user the chromium-en specs created. This spec's new user "Synthetic Sponsor en" sorts before "Synthetic Transformation Lead" and pushed it off page 1.
- **The 2 tests that did not run:** they are later serial tests of the same `journeys.spec.ts` describe block, skipped after the failure.
- **Fix:** the user is renamed "Synthetic Waiver Sponsor trace <lang>", which sorts after the Lead; FE-F's "Synthetic Waiver Sponsor" also sorts after it. `journeys.spec.ts` is not mine and is unchanged.
- **Re-run:** `journeys.spec.ts` and `p4-traceability.spec.ts` together passed 30/30.
- **Not re-verified:** the full suite after the rename. A 41-minute full run did not fit the time limit, and the targeted re-run cannot recreate the full suite's user population. The test still depends on page-1 contents, which any future spec that creates a user sorting before "T" can break. Suggest an orchestrator item for the journeys test to search instead of relying on page 1.

**Per-spec e2e counts in the full run (en / ar):** every passed test also passed axe with 0 serious or critical violations, because `expectAccessible` fails the test otherwise.

| Spec | en | ar |
|---|---|---|
| `journeys` | 9 | 8 + 1 failed (+2 did not run) |
| `p2-blank-text` | 9 | 9 |
| `p2-journeys` | 12 | 12 |
| `p3-business-cases` | 6 | 6 |
| `p3-g4-refusal` | 2 | 2 |
| `p3-inherited-approval` | 5 | 5 |
| `p3-journeys` | 18 | 18 |
| `p3-portfolio` | 6 | 6 |
| `p3-prioritization-roadmap` | 7 | 7 |
| `p3-seams` | 3 | 3 |
| `p3-ui-completion` | 7 | 7 |
| `p4-adoption-bau` | 8 | 8 |
| `p4-benefits` | 9 | 9 |
| `p4-dashboards` | 6 | 6 |
| `p4-execution` | 3 | 3 |
| `p4-gates-closure` | 9 | 9 |
| `p4-governance` | 8 | 8 |
| `p4-kpi` | 10 | 10 |
| `p4-raid-governance` | 7 | 7 |
| **`p4-traceability` (new)** | **6** | **6** |
| `session-end` | 5 | 5 |

**The new spec:** each language passes 15 axe checks and saves 27 screenshots: every step, plus the five screens at 390 px and at 200 % text.
- Screenshots: `docs/delivery/handbacks/DG4/T-DG4-FE-G2-evidence/screenshots/{en,ar}/p4trace-*.png`.
- I opened `en/p4trace-04b-waiver-in-force.png` and `ar/p4trace-06-allocation-100.png` and checked them by eye. That review found the doubled gate label described under Salvage.
- The screenshots come from the targeted re-run, which ran after every source change.

**Interaction checks the e2e drives (both languages):**
- form create, edit, withdraw and remove with a reason;
- the 110 % refusal dialog;
- a graph node click opening its record;
- the impact and allocation selects;
- the RAG policy save, with its `If-Match` asserted on the wire;
- the transformation chip add, with the request asserted;
- read-only views for the auditor;
- the not-found view for a business-unit Lead;
- 390 px width and 200 % text with no page-level horizontal scroll.

**Final re-run of the static checks** on the final tree, after the last edit: see "Final static checks" at the end of this file.

## Operations routed (delta to the pending list)

**None.** A web task routes no API operation and has no `p4-pending-*.ts` list.
- The operations these screens consume are already routed, and their lists are empty: `P4_PENDING_BE_M`, `_BE_M2`, `_BE_M3`, `_KBE_G`, `_KBE_G2` and `_ARCH_R2` all equal `[]`.
- `contract.test.ts` is unchanged.

## Contract or schema needs (for the orchestrator)

1. **`MissingLinks` does not say whether a Modular-links waiver is in force.**
   - The screen derives it from `listGateDispensations`: an accepted waiver for G3 with no initiative, whose `expiresOn` is on or after today in the transformation's time zone.
   - The server decides with BE-K2's business-date clock, which a test can inject, so the two can disagree on the expiry day or under an injected date.
   - Suggest an optional `modularLinksWaiver { id, expiresOn }` member on `MissingLinks` (ARCH task), so the screen shows the server's own decision.
2. **Trace-link edits need the contribution's version.** `getAllocationSet` gives a member's `version`, but a graph edge with no share does not. The share dialog reads `getTraceLink`, or `listInitiativeOutcomeContributions` for a T05 contribution, to get its If-Match version. This works, but costs one extra read.

## What remains

- **Scope:** every scope item (1–5) is delivered.
- **Acceptance checks 3 and 4** are not fully green (see Checks):
  - the worker `benefits-queue` integration test, outside this task's files, fails in full runs;
  - the full e2e suite after the rename fix was not re-run within the time limit.
- **Observations:**
  - **Route-level code splitting** (D-111 structural risk): not in this task's scope, so this task's pages add to the single bundle, as every FE task has.
  - **D-113 is missing:** the assignment cites it for the business-unit-chip decision, but no D-113 row exists in this tree's `decisions.md`. I followed the assignment's own text.

## Merge instructions

- Union-merge the shared web files (`router.tsx`, `nav.ts`, `Workspace.tsx`, `nav.json`, `i18n/index.ts`). All edits are appended at the end of their lists.
- Expect no conflict with FE-F2, QA-B or ARCH-R3 unless they append to the same lists.
- No migration, no API change, no new dependency.

## Final static checks (final tree, after the last source and handback edit, 11:29Z)

| Command | Exit | Log |
|---|---|---|
| `pnpm lint` | 0 | `lint-final.log` |
| `pnpm -r typecheck` | 0 | `typecheck-final.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier-final.log` |

The only edit after the unit runs, the build and the full e2e run was the e2e user rename in `p4-traceability.spec.ts`. That file passed `tsc -p tsconfig.e2e.json` (exit 0) and the targeted e2e re-run (30/30).
