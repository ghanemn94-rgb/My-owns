# Handback T-DG3-FE-B: prioritization, roadmap, dependencies and capacity (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. This is an engineering delivery task only. Nothing here grants or implies a business, Finance or IT approval. The demo Sponsor decisions in the e2e are synthetic and approve nothing real. Product gates G1–G6 never imply any DG gate.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-B-frontend-ux-engineer-20261008T010839Z-4044007e","session_id":"4044007e-f5db-45c3-8892-d4cef37cd40b"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-FE-B.md`, sha256 `ff9dcdb2…9e5`. Verified: it matches the hash given by the orchestrator.
- **Worktree / base:** `/home/user/wt/dg3-fe-b`, branch `dg3/fe-b`, base `HEAD` `e14993e7f682f405dbabca8b21250d5c227a7a20`. Nothing is committed: the changes are in the working tree for the orchestrator to integrate.
- **Time:** started 01:08:51 UTC (`date -u`). Finished at 02:22 UTC (about 73 minutes). All four screens were built in the assigned order. The 100-minute cut-off was not reached.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0, both before implementation (`validate-dg2-start.log`) and at the end (`validate-dg2-end.log`).
- **Write scope:** I touched only my own page folders, my four i18n namespaces (EN and AR), my e2e spec, and this handback with its evidence. I did not touch `app/**`, `api/**`, `i18n/index.ts`, `packages/**`, `apps/api/**`, other tasks' folders or any `package.json`. The harness's empty `.claude/.cc-writes` directories were removed before each test run, as instructed.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/prioritization/PrioritizationPage.tsx` | Replaces the stub; keeps the same export. It is the T06 page shell: section nav, the ranking ≠ selection ≠ funding note, the 422 `portfolio_too_large` state, and the sections below. |
| `pages/prioritization/WeightSets.tsx` | Active set, version history, proposal dialog with a live 100% check, approve dialog (business approval, If-Match) and withdraw (reason, If-Match). |
| `pages/prioritization/Scorecard.tsx` | Per-initiative 1–5 inputs. 6, 0, 2.5 and text are refused inline. Read-only weighted score `<output>` shows 'incomplete' with the missing criteria. Saves with POST, or PATCH with If-Match. |
| `pages/prioritization/RankedTable.tsx` | Ranked table with server filters, client sort, column picker and pages. Separate rank / selection / funding columns. 0–100 toggle with the conversion label. Value/feasibility SVG chart with a text alternative and a data table. |
| `pages/prioritization/Rankings.tsx` | Record a snapshot, the current snapshot entries, and the ranking history. Cause labels are translated from the cause codes. |
| `pages/prioritization/Overrides.tsx` | Propose (reason required, blank rule), decide (business approval, no "on behalf of" control) and revoke (reason). |
| `pages/prioritization/api.ts` | Hooks on `p3Keys.prioritization*` using the shared `@mth/shared/schemas` types. |
| `pages/prioritization/p3ui.tsx` | Shared FE-B UI: problem codes translated in FE-B namespaces (the server `detail` is never shown), `useDecimal`/`DecimalOrUnknown` over the shared `formatDecimal`, `BusinessApprovalTag`, `FlagChip`/`FlagList`, `ConflictNotice`, `FormAlert`, and the focusable `TableRegion`. |
| `pages/prioritization/fe-b.fixtures.tsx` | Synthetic unit-test fixtures (contract-shaped) for the four screens. |
| `pages/roadmap/RoadmapPage.tsx` | Replaces the stub. Contains the waves, timeline, initiative table, work board, milestones (move / approve-date / re-approve) and deliverables (submit / accept-reject). |
| `pages/roadmap/api.ts` | `useRoadmap` on the single `["roadmap", tid]` key, plus TS views of `RoadmapWave`, `RoadmapView` and `T08Dependency` (see §4). |
| `pages/dependencies/DependenciesPage.tsx` | Replaces the stub. Contains the T08 map (seven columns plus flags), the create/edit dialog (From is an initiative or External), the cycle message with its path, archive, and dependency-type admin. |
| `pages/dependencies/api.ts` | `useT08Dependencies` (`p3Keys.dependencies`), `useDependencyTypes` (`p3Keys.dependencyTypes`), and the `DependencyType`/`CycleNode` types. |
| `pages/capacity/CapacityPage.tsx` | Replaces the stub. Role × month FTE grid with the conflict and shortfall, Unknown capacity, and demand commit / release. |
| `pages/capacity/api.ts` | Contract-typed hooks for BE-E's capacity-plan and resource-demand API, under `[...p3Keys.capacity(tid), "plan" \| "demands"]`. |
| `pages/{prioritization,roadmap,dependencies,capacity}/*.test.tsx` (4 new) | 52 unit tests (26 EN, 26 AR) with stubbed API responses. |
| `apps/web/src/i18n/{en,ar}/{prioritization,roadmap,dependencies,capacity}.json` | My namespaces. `stub.*` is removed. Includes the `problem.*` translations for every code these screens can show. |
| `apps/web/e2e/p3-prioritization-roadmap.spec.ts` (new) | Real-stack e2e: 7 tests per project. |

## 2. Screens and requirements

Requirement acceptance texts are quoted from `docs/delivery/requirements.csv`.

**Prioritization (`/transformations/:id/prioritization`)**

- **REQ-PB-047.** Acceptance: "T06 persists all criteria per initiative; Weighted score is read-only (calculated)".
  - The scorecard covers every criterion of the active set.
  - The weighted score is an `<output>` and never an input. No request sends `weightedScore`; the unit test asserts this.
- **REQ-PB-048.** Acceptance: "scores 5,4,3,2,1 give 3.30 …; a score of 6 is rejected; a missing score shows 'incomplete'".
  - e2e (EN and AR): INI-01 shows 3.30 and INI-02 shows 'incomplete' / 'غير مكتمل'.
  - A score of 6 gives the inline `prioritization.score_range` error, with `aria-invalid` set, and sends nothing (the request list is asserted empty).
- **REQ-PB-049.** Acceptance: "saving weights totalling 95% (or 105%) is rejected …; risk/compliance 10% with strategic fit 15% is accepted as weight-set version 2 …; history can name 'weight version 2'".
  - A live check (shared `validateWeightSet` / `weightTotal`) shows "Weights must total 100% (got 95.00%)" and "…(got 105.00%)". Nothing is sent.
  - The version-2 example is proposed by the lead (e2e). It is approved by another person, a demo Sponsor, labelled "Business approval". The proposer is never offered approval and sees "another person must approve it".
  - A 403 `approval.approver_is_proposer` and a 409 are each handled (unit tests).
- **REQ-S09-001.** Acceptance: "a 3.30 score shows 57.5 with the conversion label".
  - The toggle (`aria-pressed`) shows 57.5. The label is "0–100 view = (weighted score − 1) ÷ 4 × 100" in EN, and the ADR's provisional AR text in Arabic. Both are verified in e2e.
- **REQ-S09-004 (comparison, filters, ranked table).**
  - Filters: status, completeness, funding and flag.
  - The table supports sort with `aria-sort`, column selection and pages.
  - The value/feasibility chart is `role="img"` with an alt text, and has a data table alternative. Unknown axes are listed as "not plotted", never drawn at 0.
- **REQ-S09-005.** Acceptance: "an override without reason is rejected; the history shows 'weight version 2' as the cause".
  - Proposing an override with a missing reason, or with only invisible characters, gives an inline error and sends nothing.
  - The override is decided by another person (business approval).
  - The e2e history contains "weight version 2" / "إصدار الأوزان 2" and "override: Synthetic: regulatory deadline". These labels are rendered from the cause codes, not from the server's English `causeLabels`.
- **REQ-S09-003 (separation).** Rank, Selection and Funding are separate columns. The page shows the note that a ranking is a proposal.
- **The 500 limit.** A 422 `prioritization.portfolio_too_large` gives a translated error state, not an empty table (unit test).

**Roadmap (`/roadmap`)**

- **REQ-PB-050.** Acceptance: "four waves seeded with values verbatim … overlapping horizons are accepted".
  - The waves table shows the API's verbatim English text. In Arabic it shows the provisional Arabic, with the English source name under it and a "provisional translation" note.
  - The four horizon bars overlap on one axis.
- **REQ-S09-006.** Acceptance: "moving a milestone on the timeline updates the table and board; conflicting concurrent edits show a conflict".
  - The timeline, table and board all render `useRoadmap` (`["roadmap", tid]`).
  - Move sends `PATCH /milestones/{id}` with `{forecastDate}` and If-Match, then calls `useP3Refresh`.
  - The unit test asserts exactly one roadmap refetch, and that the same new date appears in the timeline, table, board and milestones table.
  - e2e: a concurrent API edit followed by a stale UI move gives a 409, the conflict notice, and a reload that shows the other person's date.
- **Approve-date.** The date and reason are required; the hint asks for the reason for the change on re-approval. The request uses If-Match.
- **Deliverables.** Submit, and accept/reject with an `AcceptanceDecision` and If-Match. No "on behalf of" control is offered. The submitter is not offered the decision.
- **Schedule flags.** These are translated. `schedule.unknown` is shown as Unknown, never as "no conflict". There is no critical-path highlighting; the page states why.

**Dependencies (`/dependencies`)**

- **REQ-PB-051.** Acceptance: "T08 persists all 7 columns; From accepts an initiative or 'External'; a cycle A->B->A is reported".
  - The seven column headers are asserted in e2e. External is sent as `{kind:"external", label}` (unit test).
- **REQ-S09-008.** Acceptance: "A->B->C->A is rejected naming the cycle; a predecessor finishing after the needed-by date is flagged".
  - A 422 `dependency.cycle` shows the translated message with the path from the problem's `cycle` member. The path is wrapped in LRI/PDI, so it reads correctly inside Arabic text.
  - Unit test: "INI-01 → INI-02 → INI-03 → INI-01".
  - e2e: the server reports "INI-03 → INI-01 → INI-02 → INI-03", which is the ADR-0023 §5 `from → to → … → from` order for the refused edge.
  - The needed-by conflict flag is shown (e2e).
- **REQ-PB-052.** Acceptance: "the four source types are present and cannot be deleted".
  - System types show "System type: cannot be deleted" and offer no retire control.
  - An administrator (`dependency_type.configure`) can add, relabel and retire custom types. The 422 `system_undeletable` is translated (unit tests).

**Capacity (`/capacity`)**

- **REQ-PB-059 / REQ-S09-004 (capacity).** Acceptance: "a capacity demand exceeding availability shows a conflict indicator".
  - The grid shows decimal FTE.
  - `capacity.over_allocated` shows "Conflict: short by 1.5 FTE".
  - Null available capacity shows Unknown and `capacity.unknown`, never 0.
  - Commit and release use If-Match; a 409 shows the conflict notice. Commit is labelled as a resourcing commitment, not a business approval.
  - BE-E's routes are still a stub in this tree, so this is tested with stubbed responses: unit tests, plus an e2e screenshot and axe check through `page.route`.

**Every screen:**

- EN-LTR and AR-RTL.
- AUD is read-only: a read-only note and no write controls (unit and e2e).
- One form-level `role="alert"` per dialog, with inline field errors.
- The blank-text rule applies.
- Decimals are formatted with the shared `formatDecimal` / `weightedScoreDisplay` / `display100Formatted`. The chart uses `new Decimal(x).toNumber()` for pixels only.
- No DG0–DG7 text.
- No colour-only status: every chip has an icon and text.
- Only design tokens are used; there are no hex colours.

## 3. Checks run (final tree, Node 24.21.0, offline)

Logs are in `docs/delivery/handbacks/DG3/T-DG3-FE-B-evidence/`. An earlier full set of runs, made before a final one-line chip-radius style change, is kept in `superseded/*.run1.log`. Its results were identical.

| Check | Command | Exit | Result |
|---|---|---|---|
| DG2 historical (start, end) | `node tools/gates/validate.mjs --historical --stage DG2` | 0, 0 | `PASS gate DG2 (historical)` |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | `contrast.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **1** | 67 files, **1279 passed, 8 failed**. All 8 failures are in `src/app/p3-seams.test.tsx` (see below). |
| Unit, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Same: 1279 passed, the same 8 failed. |
| e2e, locale unset | `env -u LANG … QA_PG_PORT=23550 E2E_API_PORT=23551 MTH_PORT_POOL=23560-23599 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **86 passed, 2 failed, 2 did not run** (`e2e-locale-unset.log`) |
| e2e, C.UTF-8 | the same with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **1** | **86 passed, 2 failed, 2 did not run** (`e2e-c-utf8.log`) |

**The unit-test failures.** The 8 failing tests are FE-A0's `p3-seams.test.tsx` "stubs (en|ar)" cases for prioritization, roadmap, dependencies and capacity. They assert the "being built" stub state on exactly the four pages this assignment requires me to replace. `app/**` is outside my write scope, so I could not update them. A proposed patch is in `proposed-seam-patch.diff`; it has **not** been applied or run. Every other test passes, including all 52 new FE-B tests and the rest of `p3-seams.test.tsx`.

**The e2e failures.** The 2 failures are FE-A0's `p3-seams.spec.ts` test "P3 pages: … 'being built' state", one per project. The error context shows the failure is on the Prioritization page (h1 "Prioritization Scorecard (T06)"): the stub's being-built note is gone because the page is now real. That spec is serial, so its following test ("Initiatives and Roadmaps / Benefits and Finance lead into …") **did not run** in either project. The same patch file covers that spec (it removes the four FE-B rows from `PAGES`). `p3-seams.spec.ts` is not in my write scope, and it is not one of the four existing specs that acceptance item 4 requires.

**e2e counts per project and spec (both settings):**

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `p3-prioritization-roadmap.spec.ts` (new) | 7 passed | 7 passed |
| `journeys.spec.ts` | 9 passed | 9 passed |
| `p2-journeys.spec.ts` | 12 passed | 12 passed |
| `session-end.spec.ts` | 5 passed | 5 passed |
| `p2-blank-text.spec.ts` | 9 passed | 9 passed |
| `p3-seams.spec.ts` (FE-A0's) | 1 passed, 1 failed, 1 did not run | 1 passed, 1 failed, 1 did not run |

**Acceptance items 3 and 4 are met.** My spec passes in both projects under both settings, with the AUD pass and axe. The four required existing specs pass in both projects under both settings.

**Axe.** Every one of the 14 checked screens per language had 0 serious or critical issues (`axe-summary-en.json`, `axe-summary-ar.json`).

**Earlier e2e iterations** (disclosed; logs kept):

- `e2e-dryrun1.log`: exit 1, my setup lacked the charter.
- `e2e-dryrun2.log`: exit 1, the initiative submit needed If-Match.
- `e2e-dryrun3.log`: exit 1, the own-proposal note was shown only to approvers. I fixed the UI so it always shows on one's own proposal.
- `e2e-dryrun4.log`: exit 1, the override did not apply under v2 until risk/compliance was scored. This was correct server behaviour; I fixed the test data.
- `e2e-dryrun5.log`: exit 1, the headers were read before the table rendered.
- `e2e-dryrun6.log`: exit 1, I had expected the wrong cycle order. The server's order follows the ADR.
- `e2e-dryrun7.log`: both projects, 14/14 passed, exit 0.

**Interaction checks actually run on the real stack (EN and AR):**

- Sign in as the lead. Ranked table: 3.30, 3.00 and 'incomplete'. 0–100 toggle: 57.5 plus the label.
- Scorecard: type 6, save. Inline error, `aria-invalid`, no request.
- Weight dialog: 20% gives the live "got 95.00%" error, and submit sends nothing. Then 15% plus risk/compliance 10% gives "total exactly 100%", and propose creates v2 "Proposed".
- Override: a missing reason is refused. With a reason, the override is proposed.
- The office user, as demo SP, approves v2 (the dialog shows "Business approval") and approves the override. A new snapshot shows the history with 'weight version 2' and the override reason.
- Roadmap: the four waves. Move the milestone to 5 Dec: the timeline, table, board and milestones table all show the same date. A concurrent API move, then a stale UI move, gives the conflict notice and a reload that shows 10 Dec.
- Dependencies: the seven headers, the needed-by flag, and the attempt INI-03 → INI-01 refused with the path.
- The auditor on three screens: the read-only note, no write buttons, and no non-GET request except the language preference.
- Capacity (stubbed through `page.route`): shortfall and Unknown.
- Axe on every screen and dialog state above.

**Screenshots.** `apps/web/e2e/screenshots/{en,ar}/p3-prioritization-*.png`, 15 per language:

- `ranked`, `view100`, `scorecard`, `weights-95`, `proposals`, `approve-v2`, `history`
- `roadmap`, `roadmap-409`
- `dependencies`, `cycle`
- `aud-prioritization`, `aud-roadmap`, `aud-dependencies`
- `capacity-stubbed`

Copies are in `T-DG3-FE-B-evidence/screenshots/{en,ar}/`. I reviewed several of them and fixed two defects found that way:

- Arabic bidi garbling of "date · title" in the timeline: the parts are now `<bdi>`-isolated.
- Flag chips overflowing narrow cells: they now wrap and use the token radius.

## 4. Seam and contract mismatches

1. **The seam tests assert my stubs** (`app/p3-seams.test.tsx`, `e2e/p3-seams.spec.ts`). See §3. The patch is in `proposed-seam-patch.diff`, for the owner of `app/**` (FE-A) or the orchestrator.
2. **No shared zod mirror exists for `RoadmapWave`, `RoadmapView`, `T08Dependency`, `DependencyType`, `ResourceRole`, `CapacityPlan(Cell)` or `ResourceDemand`.** I typed them in `pages/{roadmap,dependencies,capacity}/api.ts` as read-only TypeScript views of `docs/api/openapi.yaml`. They are not zod copies, and nothing is validated against them. If ARCH adds mirrors to `@mth/shared/schemas`, these should switch to them. The prioritization screens use only the shared mirrors.
3. **Problem translations live in FE-B namespaces.** `errorMessage` looks only at `problems.*`, which I do not own. So FE-B codes live in `<ns>.problem.<code__>`, and `p3ui.tsx` `p3ErrorMessage` looks those up first, then falls back to `errorMessage`. If the team prefers one catalogue, the keys can move to `problems.json`.
4. **The cycle path order.** The assignment's example "INI-01 → INI-02 → INI-03 → INI-01" depends on which edge closes the cycle. The server reports `from → to → … → from` of the refused edge (ADR-0023 §5). The UI shows the server's path verbatim.
5. **Dependency-type admin uses `canAnywhere(me, "dependency_type.configure")`** (organization-scope ADM_METHOD), not the workspace's transformation-scoped `can`. After a type mutation I invalidate the global `["dependency-types"]` key directly, because `useP3Refresh` does not cover global keys. I use `invalidateQueries` only, never `setQueryData`.
6. **The work board does not move cards.** ADR-0023 §3 says moving a card calls the ADR-0021 transition actions, and those are FE-A's portfolio actions. The board is read-only and says that status changes are made on the initiative in the portfolio.
7. **Re-approval reason.** The contract requires `reason` on every approve-date, not only on re-approval, so the UI always requires it. The hint asks for the reason for the change on re-approval.

## 5. Not done or left for the next wave

- **Capacity live e2e:** BE-E's capacity-plan and resource-demand routes are a stub in this tree. Covered now by 6 unit tests plus a `page.route`-stubbed e2e screenshot and axe check. Live e2e, together with funding and G4, comes in the next wave.
- **Capacity editing** (resource roles, capacity rows, demand create/edit): not built. The assignment's scope was the grid, Unknown, and commit/release. The API is not live yet.
- **Live e2e for deliverable acceptance:** acceptance needs the initiative's executive owner, and no dev user plays that role in the seed. Unit-tested (EN and AR) with If-Match and the `AcceptanceDecision` body.
- **The seam test patch** (§4.1) is not applied, so `pnpm test` and the full e2e directory exit 1 until it is.

## 6. Merge instructions

- No migrations, no dependency changes, no API or contract changes.
- Merge `apps/web/src/pages/{prioritization,roadmap,dependencies,capacity}/**`, the 8 i18n files and `apps/web/e2e/p3-prioritization-roadmap.spec.ts`.
- Apply `proposed-seam-patch.diff` (or an equivalent change by FE-A) at the same time. Otherwise the 8 seam unit tests and the 2 seam e2e tests fail.
- Expected conflicts: none with FE-A or FE-C, which have different folders and namespaces. `api.ts` files are per feature.
- After integration run `pnpm -r build` before the e2e (`with-stack.sh` serves `apps/web/dist`).
