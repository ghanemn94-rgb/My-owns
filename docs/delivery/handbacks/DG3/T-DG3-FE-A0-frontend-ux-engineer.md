# Handback T-DG3-FE-A0: P3 frontend seams and the G1 agreements step (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. Engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6), and no product gate implies any DG gate.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-A0-frontend-ux-engineer-20261008T000400Z-c9f10d34","session_id":"c9f10d34-52e3-45bc-857c-04d3ee0f198d"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-FE-A0.md`, sha256 `208e762e…bdb6f` (verified).
- **Worktree / base:** `/home/user/wt/dg3-fe-a0`, branch `dg3/fe-a0`, base `HEAD` `6e5a0fb0dccf42851a1f82a5e7aa8624406cd7fc`. Nothing is committed: the changes are in the working tree for the orchestrator to integrate.
- **Time:** started 2026-10-08 00:04:10 UTC, finished about 00:53 UTC (about 50 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` returned `PASS gate DG2 (historical)`, exit 0, before implementation. It was run again at the end, also exit 0 (`T-DG3-FE-A0-evidence/validate-dg2-historical.log`).
- **Write scope:** I touched only `apps/web/**` and this handback with its evidence. I changed nothing in `apps/api`, `apps/worker`, `packages`, `docs/source`, `tools`, any `package.json` or the lockfile.

## 1. Changed files

### G1 agreements step (REQ-PB-022, ADR-0021 §8, B0032)

| File | Purpose |
|---|---|
| `apps/web/src/pages/gates/GateDetailPage.tsx` | `DecideDialog`: three required, labelled checkboxes appear only for **G1 + approve**. Approval is impossible until all three are ticked. `agreements: {problem, baseline, materialValuePools: true}` is sent only then. `GateProblem` translates 422 `gate.g1_agreements_required` (listing the missing confirmations from the `/agreements/<key>` pointers) and `gate.agreements_not_applicable` in the dialog's one `role="alert"` banner. Also exports `G1_AGREEMENT_KEYS` and `needsG1Agreements`. |
| `apps/web/src/i18n/{en,ar}/gates.json` | New `gates.agreements.*` keys: legend, B0032 intro, three item labels, the inline "tick all three" error, three "not confirmed" lines and the two problem texts. |
| `apps/web/src/pages/gates/g1-agreements.test.tsx` (new) | 10 unit tests (5 in EN, 5 in AR). See §2. |
| `apps/web/src/pages/p2.test.tsx` | The DG2 test "the approver's decision…" now ticks the three confirmations and expects `agreements` in the body. |
| `apps/web/src/pages/p2-blank-forms.test.tsx` | The G1 blank-rationale/comment tests tick the three confirmations, so the blank rule stays the only refusal. The verbatim-body expectation now includes `agreements`. |
| `apps/web/e2e/support/ui.ts` | New `confirmG1Agreements(dialog, lang)` helper, which ticks by translated label. Adds a `Locator` type import. |
| `apps/web/e2e/p2-journeys.spec.ts` | The test "Gates: the approver's decision — 409 when the submission was superseded, then approval with a rationale" ticks the three confirmations before both confirms (the 409 attempt and the approval of #2). |
| `apps/web/e2e/p2-blank-text.spec.ts` | Its G1 blank-rationale check ticks the confirmations, so the blank-rationale field stays the focused invalid field. |

### Router, nav, stubs, i18n and API seams

| File | Purpose |
|---|---|
| `apps/web/src/app/router.tsx` | Adds the 12 P3 routes (table in §3). |
| `apps/web/src/pages/{portfolio,readiness,dispensations,prioritization,roadmap,dependencies,capacity,business-cases,benefit-formulas}/*Page.tsx` (12 new) | Minimal stubs. Each has a bilingual title from its own namespace and a `BeingBuiltState`. No data, no forms. Each file header says which task replaces it. |
| `apps/web/src/components/States.tsx` | New `BeingBuiltState`: `role="note"`, `data-state="being-built"`, clock icon, no action. |
| `apps/web/src/components/Workspace.tsx` | Adds 9 P3 workspace tabs to `WORKSPACE_TABS`, each with an optional `labelKey` taken from its own namespace. Adds `workspaceTabLabelKey(id)`. |
| `apps/web/src/app/nav.ts` | `initiatives` and `benefits` change from `planned` to `partial`, with `workspaceTab` `portfolio` and `business-cases`. New `AreaWorkspaceTab` union. |
| `apps/web/src/pages/AreaPages.tsx` | `AreaEntryPage` uses `AreaWorkspaceTab` and `workspaceTabLabelKey`. |
| `apps/web/src/i18n/{en,ar}/{portfolio,readiness,dispensations,prioritization,roadmap,dependencies,capacity,businessCases,benefitFormulas}.json` (18 new) | Only the keys the stubs and tabs use. EN and AR have identical key sets. |
| `apps/web/src/i18n/index.ts` | Registers the 9 namespaces for both locales. |
| `apps/web/src/api/types.ts` | P3 portfolio response types from `@mth/shared/schemas` `portfolio.ts` (§4). |
| `apps/web/src/api/queries.ts` | `p3Keys` factory, `P3_FEATURES`, `isP3KeyOf` and `useP3Refresh` (§4). |
| `apps/web/src/api/client.ts` | Re-exports the session-bound helpers (§5). |
| `apps/web/src/app/p3-seams.test.tsx` (new) | 34 unit tests: route→component wiring, the 12 stubs in EN and AR, tab labels, the two nav areas in EN and AR, and the query keys. |
| `apps/web/e2e/p3-seams.spec.ts` (new) | Real-stack e2e: the 12 P3 pages and the 2 area entries in both projects, with axe and screenshots. |

### Fixes outside the listed scope that the required e2e needed (both in `apps/web`, both caused by the integrated P3 backend, not by this task)

Creating a transformation now also runs `p3_instantiate_transformation` (migrations 0024/0025). That writes `roadmap_wave.create` ×4 and `scoring_weight_set.create` (with `weights: {criterion: "25.00", …}`) to the transformation's audit trail. On the integrated `HEAD` this broke two existing DG1/DG2 e2e assertions on the overview page:

1. **axe `scrollable-region-focusable: .table-wrap`** (serious). The long, unbreakable JSON weights value overflowed the audit table, because `.table .code { white-space: nowrap }` kept it on one line. This failed `journeys.spec.ts` "create a modular transformation…" and `p2-journeys.spec.ts` "lead creates an End-to-End transformation…".
   - Fix: `apps/web/src/styles/app.css` gets a scoped `.audit-changes, .table .audit-changes .code { white-space: normal; overflow-wrap: anywhere }`.
   - `TransformationDetailPage.tsx`: the changes `<ul>` gets the `audit-changes` class.
2. **"field / action without a translation" in the trail.** This failed `journeys.spec.ts` "a business-unit Lead creates a record… audit trail…" (F-DG1-008).
   - Fix: `apps/web/src/lib/auditChanges.ts` gets a typed `weights` field. Each weight is shown as the localized criterion name plus its exact decimal percentage (the string is never converted to a number), in B0076 order. A non-criterion code or a non-decimal percent stays explicitly "without a translation".
   - `transformations.json` (EN and AR) gets labels for `roadmap_wave_create`, `scoring_weight_set_create`, `field.weights`, `criterion.*` (six codes, using the glossary term "الوقت اللازم لتحقيق القيمة") and `value.weight` / `value.listSeparator`.
   - 3 new unit tests in `apps/web/src/lib/auditChanges.test.ts`.

## 2. Behaviour delivered

**REQ-PB-022 (G1 leadership agreements, B0032)**

- **Approve on G1:**
  - A fieldset titled "Leadership agreement for G1 (required)" / "موافقة القيادة على G1 (مطلوب)" appears.
  - Its intro restates the B0032 rule: proceed only when leadership agrees on the problem, the baseline and the material value pools. It uses the glossary terms "خط الأساس" and "مجمّعات القيمة".
  - It has three required checkboxes: problem, baseline, material value pools.
- **Approval is impossible until all three are ticked.** A confirm attempt sends nothing and marks only the unticked boxes `aria-invalid`. Each of them points to an inline field error ("Tick all three confirmations to approve G1.") through `aria-describedby`, and focus moves to the first unticked box.
  - The confirm button stays enabled on purpose, so the other inline errors (the rationale) still show in the same attempt. The DG2 tests that pin rationale validation stay valid.
  - No second live region is added. The dialog's one `role="alert"` stays reserved for server problems.
- **Request body:** a G1 approval sends `agreements: {problem: true, baseline: true, materialValuePools: true}`. Reject, request changes, defer, and any decision on another gate send no `agreements`. That holds even if the boxes were ticked before switching the outcome.
- **Server 422 `gate.g1_agreements_required`:** shown as the one form-level alert, translated: "G1 approval requires leadership agreement on the problem, the baseline and the material value pools (B0032). Nothing was recorded." It also lists each missing confirmation from the `/agreements/<key>` pointers. The server's English detail is never shown.
- **Server 422 `gate.agreements_not_applicable`:** shown the same way, translated.
- **Unit tests (`g1-agreements.test.tsx`, EN and AR, 10 tests):**
  - the three labelled required boxes, the blocked attempt with focus and `aria-invalid`, and the body with `agreements`;
  - reject on G1 sends no agreements;
  - G2 approve shows no boxes and sends no agreements;
  - both 422s are the single alert, with the pointer list.
- **e2e:** the G1 approval in `p2-journeys.spec.ts` ticks the three boxes and passes in chromium-en and chromium-ar under both locale settings (§6).
- **Other UI approvals of G1:** I searched every product e2e (`journeys`, `session-end`, `p2-blank-text`, `p2-journeys`). Only `p2-journeys` approves G1 through the UI, and `p2-blank-text` opens the G1 approve dialog without sending. Both are updated. `submitAndApproveGate` only approves G2 and G3. No e2e approves G1 through the API.

**Seams (FE-A, FE-B and FE-C fill them; no screen is built here)**

- 12 routes, each with its stub. 9 workspace tabs. Two partial nav areas.
- Every stub page shows a localized title, the honest "Being built in this stage" note (AR: "قيد البناء في هذه المرحلة") and a body that says it shows and changes no data.
- An AUD user or anyone without the page's provisional write permissions also sees the existing read-only note from `WorkspaceFrame`.
- No DG0–DG7 text appears on these pages (asserted in the unit tests and the e2e).

## 3. Seam table (exact paths, exports, namespaces)

Route paths are under the `/` shell. Page files are under `apps/web/src/pages/`.

| Route path | Page file | Export | Workspace tab id (`data-tab`) | Namespace | Title key | Owner |
|---|---|---|---|---|---|---|
| `transformations/:id/portfolio` | `portfolio/PortfolioPage.tsx` | `PortfolioPage` | `portfolio` | `portfolio` | `portfolio.title` | FE-A |
| `transformations/:id/initiatives/:initiativeId` | `portfolio/InitiativePage.tsx` | `InitiativePage` | `portfolio` (frame prop) | `portfolio` | `portfolio.initiativeTitle` | FE-A |
| `transformations/:id/readiness` | `readiness/ReadinessPage.tsx` | `ReadinessPage` | `readiness` | `readiness` | `readiness.title` | FE-A |
| `transformations/:id/dispensations` | `dispensations/DispensationsPage.tsx` | `DispensationsPage` | `dispensations` | `dispensations` | `dispensations.title` | FE-A |
| `transformations/:id/prioritization` | `prioritization/PrioritizationPage.tsx` | `PrioritizationPage` | `prioritization` | `prioritization` | `prioritization.title` | FE-B |
| `transformations/:id/roadmap` | `roadmap/RoadmapPage.tsx` | `RoadmapPage` | `roadmap` | `roadmap` | `roadmap.title` | FE-B |
| `transformations/:id/dependencies` | `dependencies/DependenciesPage.tsx` | `DependenciesPage` | `dependencies` | `dependencies` | `dependencies.title` | FE-B |
| `transformations/:id/capacity` | `capacity/CapacityPage.tsx` | `CapacityPage` | `capacity` | `capacity` | `capacity.title` | FE-B |
| `transformations/:id/business-cases` | `business-cases/BusinessCasesPage.tsx` | `BusinessCasesPage` | `business-cases` | `businessCases` | `businessCases.title` | FE-C |
| `transformations/:id/business-cases/:businessCaseId` | `business-cases/BusinessCasePage.tsx` | `BusinessCasePage` | `business-cases` (frame prop) | `businessCases` | `businessCases.detailTitle` | FE-C |
| `transformations/:id/benefit-formulas` | `benefit-formulas/BenefitFormulasPage.tsx` | `BenefitFormulasPage` | `benefit-formulas` | `benefitFormulas` | `benefitFormulas.title` | FE-C |
| `transformations/:id/benefit-formulas/:formulaId` | `benefit-formulas/BenefitFormulaPage.tsx` | `BenefitFormulaPage` | `benefit-formulas` (frame prop) | `benefitFormulas` | `benefitFormulas.detailTitle` | FE-C |

**Namespace keys.**

- Every namespace holds `tab`, `title` and `stub.{title,body}`.
- `portfolio` also has `initiativeTitle`. `businessCases` and `benefitFormulas` also have `detailTitle`.
- Files: `apps/web/src/i18n/{en,ar}/<namespace>.json`. All nine are registered in `i18n/index.ts`.
- The owning task adds its keys to its own files. It removes `stub.*` when it replaces the stub, since `i18n.test.ts` only requires used keys to exist.
- `gates.json` stays FE-A's.

**Tabs.**

- Tab labels come from `<namespace>.tab` through `WORKSPACE_TABS[].labelKey`. The P2 tabs keep `transformations.tabs.<id>`.
- Tab ids are path segments. `WorkspaceTabId` now includes the nine P3 ids, so `WorkspaceFrame tab="…"` accepts them.
- Order: Overview, Diagnose, Charter, Define, Design, Portfolio, Prioritization, Roadmap, Dependencies, Capacity, Business cases, Benefit formulas, Decisions, Gates, Readiness, Dispensations, Evidence, Team. The list wraps (existing CSS). See the screenshots.

**Nav.** `initiatives` (`/initiatives-roadmaps`) is `partial` with `workspaceTab: "portfolio"`. `benefits` (`/benefits-finance`) is `partial` with `workspaceTab: "business-cases"`. Their cross-portfolio view still says "Planned".

**Stub write-permission hints are provisional.** They only drive the read-only note, and the owning task sets the final list.

- portfolio and initiative: `initiative.edit`, `initiative.launch`, `portfolio.select`
- readiness: `initiative.edit`, `initiative.launch`
- dispensations: `gate.submit`, `gate.decide`
- prioritization: `prioritization.score`, `prioritization.edit`, `prioritization.approve`
- roadmap: `roadmap.edit`, `roadmap.approve`, `deliverable.accept`
- dependencies: `dependency.edit`, `dependency_type.configure`
- capacity: `capacity.edit`, `capacity.commit`
- business cases: `business_case.edit`, `funding.approve`, `finance.validate`
- benefit formulas: `benefit_formula.edit`, `finance.validate`

## 4. API seams

**`api/types.ts`** re-exports these types from `@mth/shared/schemas` (BE-A's `portfolio.ts`):

- `AcceptanceDecision`, `Deliverable`, `DiagnosticArea`, `DiagnosticAreaCoverage`
- `FundingDecision`, `FundingState`, `GateDispensation`, `GateReadiness`
- `Initiative`, `InitiativeDecisionLink`, `InitiativeGapLink`, `InitiativeOutcomeContribution`, `InitiativeStatus`
- `Milestone`, `OutcomeHierarchy`, `PortfolioSelection`, `ScheduleFlag`, `TransformationReadiness`
- `GateAgreements`, `GateAgreementRecord`

It also infers:

- `DeliverableList` (`items` plus `countWarning`)
- `InitiativeListPage` (named this way so it doesn't clash with the `InitiativePage` component)
- `PortfolioSelectionPage`, `FundingDecisionPage`, `GateDispensationPage`

No prioritization, roadmap or capacity mirror exists in `@mth/shared/schemas` at this base, so FE-B and FE-C import any further types directly from `@mth/shared/schemas`.

**`api/queries.ts` `p3Keys`.** Every per-transformation key is `[<feature>, tid, …]`.

| Key factory | Key |
|---|---|
| `portfolio(tid)` | `["portfolio", tid]` |
| `initiatives(tid, query)` | `["portfolio", tid, "initiatives", query]` |
| `initiative(tid, iid)` | `["portfolio", tid, "initiative", iid]` |
| `initiativePart(tid, iid, part)` | `["portfolio", tid, "initiative", iid, part]` |
| `readiness(tid)` | `["readiness", tid]` |
| `outcomeHierarchy(tid)` | `["outcome-hierarchy", tid]` |
| `dispensations(tid)` | `["dispensations", tid]` |
| `prioritization(tid)` | `["prioritization", tid]` |
| `prioritizationPart(tid, part, …rest)` | `["prioritization", tid, part, …rest]` |
| **`roadmap(tid)`** | **`["roadmap", tid]`**: the one entry the timeline, table and board share (ADR-0023 §3) |
| `dependencies(tid)` | `["dependencies", tid]` |
| `dependencyTypes` | `["dependency-types"]` (global) |
| `capacity(tid)` | `["capacity", tid]` |
| `businessCases(tid)` | `["business-cases", tid]` |
| `businessCase(tid, id)` | `["business-cases", tid, id]` |
| `businessCasePart(tid, id, part)` | `["business-cases", tid, id, part]` |
| `benefitFormulas(tid)` | `["benefit-formulas", tid]` |
| `benefitFormula(tid, id)` | `["benefit-formulas", tid, id]` |
| `benefitFormulaPart(tid, id, …rest)` | `["benefit-formulas", tid, id, …rest]` |
| `benefitFormulaExamples` | `["benefit-formula-examples"]` (global) |

**`useP3Refresh(tid)`** invalidates every P3 key of the transformation (through `isP3KeyOf`), the P2 tree (`["p2", tid]`, so the live gate readiness including G4 refreshes) and the transformation header. Like `useP2Refresh`, it resolves to whether the session generation is still current: `if (!(await refresh())) return;`.

**Session reset.** `resetSessionCache` (`App.tsx`) already removes every query except `/me` on a session end or identity change, so the P3 keys are covered without changes.

## 5. What `client.ts` exports for FE-B and FE-C

**Already exported, unchanged:**

- `apiRequest<T>(path, options)` returns `{data, status, etag}`. `options.ifMatch` sends `If-Match: "<version>"`, `idempotencyKey` sends `Idempotency-Key`, and `query`, `signal`, `headers` and `rawBody` work as before.
- `api.get<T>` and `api.send<T>`.
- `ApiError`, the parsed problem: `status`, `code`, `fieldErrors`, `currentVersion`, `isConflict`, `requestId`.
- `NetworkError`, `SessionChangedError`, `isSessionChangedError`, `getSessionGeneration`, `newIdempotencyKey`, `buildUrl`, `RequestOptions`, `ApiResponse`.

**Added: the session-bound mutation helpers**, re-exported from their ESLint-mandated home `auth/sessionBound.ts`:

- `beginSessionGuard`
- `useSessionBoundAction`
- `useSessionNavigate`
- the types `SessionGuard` and `SessionBoundAction`

This creates an import cycle (`client.ts` ↔ `auth/sessionBound.ts`). It is safe because neither module uses the other's bindings while it is being evaluated, only inside functions. The comment in `client.ts` says so. Typecheck, the Vite build, all unit tests and all e2e pass with it. If a reviewer prefers no cycle, the alternative is to import `auth/sessionBound.ts` directly, which FE-B and FE-C may do read-only.

**Not in `client.ts`, on purpose:**

- The translated message helpers `errorMessage`, `fieldErrorMessage(s)` and `isNoPermission` are in `lib/problem.ts`. That file imports `client.ts`, and they need i18next.
- `useVersionedSave` (`components/useVersionedSave.ts`) is the If-Match save with 409 handling.

FE-B and FE-C can import both read-only.

## 6. Checks actually run (final tree, Node 24.21.0, offline)

The final checks ran from 2026-10-08 00:48:22 to 00:52:00 UTC. Logs are in `docs/delivery/handbacks/DG3/T-DG3-FE-A0-evidence/`.

| Check | Command | Exit | Result / log |
|---|---|---|---|
| Historical DG2 gate | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` (start and end; `validate-dg2-historical.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` (only the existing Vite chunk-size warning) |
| Lint | `pnpm lint` | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. The first run, before formatting, exited **123**: 13 of my new or edited files were unformatted. I ran `prettier --write` on them and the rerun exited 0. That first log was overwritten. |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | `contrast.log` |
| Unit tests, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 59 files, **1207 passed** (`test-locale-unset.log`) |
| Unit tests, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 59 files, **1207 passed** (`test-c-utf8.log`) |
| e2e, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE QA_PG_PORT=23500 E2E_API_PORT=23501 MTH_PORT_POOL=23510-23549 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | 0 | **76 passed**, 0 failed, 0 skipped (5.0 min; `e2e-locale-unset.log`) |
| e2e, C.UTF-8 | same command with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | **76 passed**, 0 failed, 0 skipped (5.0 min; `e2e-c-utf8.log`) |

The real stack was disposable PostgreSQL on 23500, then migrate (25 migrations including 0025) and seed-dev (synthetic users), then the API with the SPA on 23501. Both runs bound on the first attempt.

**e2e counts per project and spec (the same in both settings):**

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `p2-journeys.spec.ts` (full, including the updated G1 approval, passed in both projects) | 12 | 12 |
| `journeys.spec.ts` | 9 | 9 |
| `session-end.spec.ts` | 5 | 5 |
| `p2-blank-text.spec.ts` | 9 | 9 |
| `p3-seams.spec.ts` (new) | 3 | 3 |
| **Total** | **38** | **38** |

**Earlier e2e runs that failed or were void (disclosed; logs kept):**

1. `e2e-p3-seams-dryrun.log`: `p3-seams.spec.ts` alone, 6 passed, exit 0.
2. `e2e-prefix-run0-stopped.log`: the first full run. In chromium-en, `journeys.spec.ts:258` and `p2-journeys.spec.ts:42` failed with axe `scrollable-region-focusable: .table-wrap` (§1). The G1 approval passed in that run.
   - I tried to stop it with `pkill`. That only killed my own shell, because each command runs in its own sandbox and cannot see the others' processes. The run finished on its own.
   - Its wrapper's `EXIT=1` line was appended by file name to the next log, which is why `e2e-void-run1-prefix2.log` contains two EXIT lines.
3. `e2e-void-run1-prefix2.log`: my first CSS attempt (`overflow-wrap` alone) was not enough. 4 failed (the same two tests in en and ar), 34 did not run (serial specs), 38 passed. Exit 1.
4. `e2e-void-run1b-before-audit-i18n.log`: after the CSS fix, 74 passed and 2 failed: `journeys.spec.ts:560`, which found "field/action without a translation" in the trail, in en and ar. Exit 1. The audit i18n in §1 fixed it, and the two final runs above came after that.

**Interaction checks that actually ran**, in the e2e on the real stack, both languages:

- Opening the G1 decision dialog, choosing Approve, ticking the three confirmations by their translated labels and confirming. This produces 409 superseded, then approval of #2 and the phase advances to Define.
- The blank-rationale refusal in the G1 approve dialog, with focus on the rationale and no request sent.
- Visiting all 12 P3 routes: the h1, the being-built note, `aria-current` on the right tab, no form controls, no write request, axe with no serious or critical issues.
- Following both partial nav areas into their tabs.

**Screenshots** (Playwright, full page) are in `T-DG3-FE-A0-evidence/screenshots/{en,ar}/`:

- `p2-16-gate-409-superseded.png`: the dialog with the three confirmations ticked.
- `p2-17-gate-approved.png`
- `p2-blank-06-gate-rationale.png`
- `p3-seam-portfolio.png`, `p3-seam-roadmap.png`, `p3-seam-business-cases.png`
- `p3-seam-initiatives-detail.png`, `p3-seam-business-cases-detail.png`, `p3-seam-benefit-formulas-detail.png`
- `p3-area-initiatives.png`, `p3-area-benefits.png`
- `05-detail.png`: the overview audit trail with translated, wrapping P3 events.
- `axe-summary-p3-seams.json`

## 7. Known gaps, deviations and notes

- **Namespace names.** The assignment uses camelCase `businessCases` and `benefitFormulas`. `p3-work-split.md` §4 says `business-cases.json` and `benefit-formulas.json`. I followed the assignment because it is the more specific instruction, and recorded the conflict here. FE-C owns `i18n/{en,ar}/{businessCases,benefitFormulas}.json`.
- **Confirm button stays enabled.** The assignment says approval must be "impossible until all three are ticked". It is enforced client-side: nothing is sent, with an inline error and focus on the first unticked box. I did not disable the button. Disabling it would hide the other inline validation, and that is an accessibility anti-pattern. The server still refuses with 422 regardless.
- **Agreement problem texts live in `gates.json`,** as the assignment says, not in `problems.json`. Only the gate dialog translates these two codes. The generic `errorMessage` would show the 422 bucket text elsewhere, but no other screen sends `agreements`.
- **`client.ts` import cycle.** See §5.
- **Out-of-scope fixes.** The audit-trail CSS and i18n fixes in §1 were required for the mandated e2e to pass on the integrated HEAD. They touch `TransformationDetailPage.tsx`, `app.css`, `auditChanges.ts`, its test and `transformations.json`. Other P3 audit events that may later appear on a transformation trail (initiative, business case and similar) are not translated yet. That belongs to the tasks that write those screens and events.
- **Not done (by design):** no P3 screen content. Stubs only, for FE-A, FE-B and FE-C to replace.
- **Not committed.** Integration and commit are left to the orchestrator.

## 8. Merge instructions

- No migrations, no dependency changes, no API or contract changes.
- Merge `apps/web/**` as a whole. It must land before FE-A, FE-B and FE-C start, since they fill these stubs.
- Expected conflicts: none with ARCH-03 or KBE-C. They own `packages/**`, `apps/api/**` and `docs/architecture/**`, and I touched none of those.
- If ARCH-03 changes `packages/shared/src/schemas/portfolio.ts` export names, `apps/web/src/api/types.ts` must follow. `pnpm -r typecheck` will flag it.
- After integration, rebuild (`pnpm -r build`) before the e2e. `with-stack.sh` serves `apps/web/dist`.
