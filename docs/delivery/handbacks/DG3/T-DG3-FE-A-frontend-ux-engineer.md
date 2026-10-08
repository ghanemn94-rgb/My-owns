# Handback T-DG3-FE-A: portfolio, initiative card, readiness, dispensations, outcome hierarchy and the G4 view (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. This is an engineering delivery task only. Nothing here grants or implies a business approval (G1–G6), and no product gate implies any DG gate.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-A-frontend-ux-engineer-20261008T010819Z-855f5a32","session_id":"855f5a32-bf89-449b-9fcf-396cbc94a5fc"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-FE-A.md`, sha256 `312babfd…838622`. I verified it with `sha256sum` before starting.
- **Worktree and base:** `/home/user/wt/dg3-fe-a`, branch `dg3/fe-a`, base `HEAD` `e14993e7f682f405dbabca8b21250d5c227a7a20`. Nothing is committed. The changes are in the working tree for the orchestrator to integrate.
- **Time:** started 2026-10-08 01:08:28 UTC (`date -u`), finished about 02:02 UTC, so about 55 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` returned `PASS gate DG2 (historical)` with exit 0 before implementation. It was run again at the end, also exit 0 (`T-DG3-FE-A-evidence/validate-dg2-historical.log`).
- **Write scope:** I touched only `apps/web/src/{api,pages/portfolio,pages/readiness,pages/dispensations,pages/gates,lib/auditChanges*}`, my i18n files, `apps/web/e2e/p3-portfolio.spec.ts` and this handback with its evidence.
  - I did not touch `apps/api`, `apps/worker`, `packages`, `apps/web/src/app/**`, `i18n/index.ts`, `styles`, any `package.json` or the lockfile.
  - I removed harness `.claude/.cc-writes` directories before the test runs.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/api/client.ts` | **Seam clean-up.** Removed the `sessionBound` re-export, which ends the `client.ts` ↔ `auth/sessionBound.ts` import cycle. No importer used the re-export, so no other file changed. The comment now points readers to `auth/sessionBound.ts`. |
| `apps/web/src/api/types.ts` | Adds `RoadmapWave`, the fields the screens read from contract `RoadmapWave`. No zod mirror exists for it at this base. |
| `apps/web/src/api/portfolio.ts` (new) | Query hooks, all on `p3Keys`: `useInitiatives`, `useInitiative`, the link, milestone and selection parts, `useDeliverables` (which keeps `countWarning`), `useWaves`, `useReadiness`, `useOutcomeHierarchy`, `useDispensations`, `useProposedRanks`. The rank hook uses its own key `["prioritization", tid, "portfolio-ranks"]`, so it never shares FE-B's entry. Unpaged lists use one GET (see §5). |
| `apps/web/src/pages/portfolio/common.tsx` (new) | Shared portfolio components and helpers: <ul><li>status, selection and funding cells;</li><li>`WarningList`;</li><li>`p3ProblemMessage`, which translates a problem from the screen's namespace first, then `problems.*`, and never shows the English `detail`;</li><li>`BusinessApprovalTag`;</li><li>`ActionDialog`, the transition and decision dialog: one text field, the blank-text rule, If-Match, exactly one `role="alert"`, and the 409 conflict reload.</li></ul> |
| `apps/web/src/pages/portfolio/PortfolioPage.tsx` | Replaces the stub. Initiative list, status and wave filters, draft create, and the outcome hierarchy section. |
| `apps/web/src/pages/portfolio/InitiativePage.tsx` | Replaces the stub. The T05 card with 14 fields, transitions, gap links, outcome contributions, decision links, deliverables and milestones (with roadmap links), and selection history. |
| `apps/web/src/pages/readiness/ReadinessPage.tsx` | Replaces the stub. Sequencing, diagnostic areas, G1–G4 status and dispensations. |
| `apps/web/src/pages/dispensations/DispensationsPage.tsx` | Replaces the stub. The register, a hand-written record form (waiver or inherited approval), decide (accept or reject) and revoke. |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | G4 additions. `g4Subject()` keeps the data part of a G4 label, such as initiative code and name, section, role or period. The subject resolver links `/initiatives/{id}`, `/business-cases/{id}` and `/benefit-formulas/{id}`. The 422 `gate_criteria_incomplete` list shows each item's subject. |
| `apps/web/src/lib/auditChanges.ts` | Labels and value kinds for the P3 audit fields: <ul><li>a P3 field catalogue;</li><li>`status` falls back to `transformations.audit.status.*`;</li><li>P3 enums;</li><li>criterion codes;</li><li>booleans;</li><li>JSON shown as code;</li><li>decimals shown exactly as stored.</li></ul> A string `scope`, as in a business case, is shown as text. |
| `apps/web/src/lib/auditChanges.test.ts` | One DG1 expectation changed: a string `scope` is now text, and a malformed scope stays marked. Adds 79 P3 tests: 73 parametrized action tests (each checks EN and AR) and 6 others. |
| `apps/web/src/i18n/{en,ar}/{portfolio,readiness,dispensations}.json` | Every string of the three namespaces. The `stub.*` keys are removed. |
| `apps/web/src/i18n/{en,ar}/gates.json` | `missingItems.g4__*` (15 codes) and `subject.{initiative,businessCase,benefitFormula}`. |
| `apps/web/src/i18n/{en,ar}/transformations.json` | Audit keys only: 77 actions, 166 fields, P3 statuses, enum values and yes/no. |
| `apps/web/src/pages/portfolio/p3fixtures.ts` (new) | SYNTHETIC P3 fixtures and frame handlers for the unit tests. |
| `apps/web/src/pages/portfolio/portfolio.test.tsx` (new) | 32 tests (16 EN, 16 AR). |
| `apps/web/src/pages/readiness/readiness.test.tsx` (new) | 4 tests (EN and AR). |
| `apps/web/src/pages/dispensations/dispensations.test.tsx` (new) | 12 tests (EN and AR). |
| `apps/web/src/pages/gates/g4.test.tsx` (new) | 11 tests, with stubbed responses (EN and AR). |
| `apps/web/e2e/p3-portfolio.spec.ts` (new) | Real-stack e2e: 6 tests per project, with axe and screenshots. |

## 2. Screens and requirements

All data shown is synthetic. Every string goes through i18next in AR-RTL and EN-LTR. No DG0–DG7 text appears; the unit tests and the e2e both assert this.

### Portfolio (`/transformations/:id/portfolio`): REQ-S09-003, REQ-PB-045

- **The list.** It shows code (a link to the card), name, status chip, wave, owners and warnings. **Proposed rank, Selection and Funding are three separate columns.**
  - Funding shows **"Funded"**, **"Selected - unfunded"** (AR "مختارة - غير ممولة") or **"—"**. A revoked funding shows "Selected - unfunded" plus "The funding approval was revoked."
  - The rank comes from the prioritization view. When that view is unavailable the rank is **Unknown**, never 0. When the initiative is in the view but has no rank, the cell says "Not ranked".
- **Warnings:** deliverable count, no gap link, no owner. They are translated from their codes, with icon and text.
- **Filters:** status and wave, sent as server query parameters.
- **Sort, filter, pagination and column selection** come from `RegisterTable`.
- **Create** opens a `RecordDialog` with the shared `initiativeCreate` schema and an Idempotency-Key. Its text says "Drafting is allowed at any time; submitting it to the portfolio needs G1". After saving, the page navigates to the card through `useSessionNavigate`.

### Outcome hierarchy (a section of the Portfolio page): REQ-PB-032

- A read-only five-level tree from `GET …/outcome-hierarchy`: North Star → outcome → KPI → target → initiative contribution.
- **A null target is shown as Unknown** (`data-target="unknown"`), never 0.
- Contributions without a KPI are listed under their outcome.

### Initiative card (`/transformations/:id/initiatives/:iid`): REQ-PB-045, REQ-PB-040, REQ-PB-032, REQ-PB-006, REQ-PB-004, REQ-S09-003

- **All 14 T05 fields, numbered 1–14** in B0072 order: name, executive owner, workstream lead, problem/gap, objective, scope in/out, deliverables, outcome/KPI contribution, financial benefit, customer benefit, dependencies, risks, milestones, required decisions.
  - Linked fields jump to their section. Dependencies link to the T08 map.
  - Editing uses `RecordDialog` with `initiativeUpdate`, If-Match and the standard 409 conflict panel.
- **The 3–7 deliverables warning** reads "Key deliverables: the card should list 3 to 7. This is a warning, not a block." Saving is never blocked.
- **Gap links** go to a T03 gap or a diagnosed finding. A journey is offered under "Other TOM records (refused: not a vehicle link)". The server refuses it, and the dialog's one alert shows the translated **'A project portfolio is not a Target Operating Model: an initiative cannot be attached as G3 TOM evidence.'** This was verified on the real stack.
- **Outcome contributions.** The outcome is required (`aria-required`). The KPI is labelled "KPI (T02 row, optional)" and offers only that outcome's KPIs. "No KPI" is shown when none is set.
- **Decision links.** Code, title, owner, due date and status come from the one decision log.
- **Transitions:** submit, withdraw, select, deselect, launch, cancel.
  - Each has its reason, rationale or note dialog with If-Match.
  - **Select and deselect are labelled "(Business approval)"** on the button, and the dialog carries the business-approval banner. There is no "on behalf of" control.
  - Every 422 is the dialog's single alert, translated:
    - 'Case for change not yet approved (G1)…' (real stack and unit tests);
    - 'Outcome before activity…' (unit tests);
    - 'North Star, outcomes and target state not yet approved' (unit tests);
    - 'Selected - unfunded: a funding approval is required before launch' (unit tests).
  - A 409 shows the conflict banner and reloads the initiative.
- **Deliverables and milestones** are read here and link to the roadmap, which FE-B owns. Milestones show the approved and forecast dates separately.
- **Selection history** is tagged "Business approval".
- **Cancelled or completed initiatives are read-only**, with a note and no write control.
- **Drafts** carry a "Draft - not submitted" note.

### Readiness (`/transformations/:id/readiness`): REQ-PB-007

- **`missingDiagnosticAreas`** are labelled Economics, Customer, Operations, Capability and Technology (AR: الجوانب الاقتصادية، العملاء، العمليات، القدرات، التقنية). The per-area table shows the T01 dimensions and which are missing. "Not covered" is shown with an icon and text, never green.
- **G1–G4 status** shows each gate's status chip and its dispensations:
  - an inherited approval reads "pending verification; it does not count yet" until `counts` is true;
  - even then it says "the gate itself stays not approved in this product";
  - a waiver reads "accepted (the gate is not approved)".
- **Sequencing:** can submit and can launch, each shown with icon and text. Blockers are translated from their codes.

### Dispensations (`/transformations/:id/dispensations`): ADR-0021 §5–§6

- **Waiver** (End-to-End): needs a **reason, a scope** (the whole transformation or one initiative) **and an expiry**. G1 is not offered.
- **Inherited approval** (Modular): needs the **approving body, the approval date and an evidence item**. The evidence options show their verified or unverified state.
- Missing values are refused inline, and nothing is sent.
- The list shows the **verification state**: "Unverified" uses the Unknown chip, never green. It also shows "Counts for sequencing" or "Does not count".
- **Accept, reject and revoke are business approvals**, with a page banner and dialog banners.
  - **The recorder is never offered the decision.** Their row says "Recorded by you: another approver decides."
  - The decide dialog requires accept or reject and has no "on behalf of" control.
  - Delegation (422 `dispensation.on_behalf_not_supported`) and the recorder's 403 `dispensation.decider_is_recorder` are translated. The other `dispensation.*` codes are translated too.

### G4 view (`/transformations/:id/gates/G4`): REQ-PB-019, REQ-S04-006, REQ-PB-046, REQ-PB-055, REQ-PB-059

- The eight `g4.*` criteria use the server's labels.
- Missing items are translated from their code. In EN that is exactly **'Owners'** and **'Finance validation'**; in AR 'المالكون' and 'التحقق المالي'.
- Each item is followed by its subject as the server returns it (initiative code and name, role and period, and so on), with a link where the pointer names an initiative, business case or formula.
- A refused submission (422 `gate_criteria_incomplete`) lists each item with its subject.
- The decision's 403 `gate.not_approver` and `gate.submitter_cannot_decide`, and the 409 `gate.submission_superseded`, are translated.
- G4 asks for no G1 confirmations.
- **These are tested with stubbed responses only.** BE-E ships the evaluators in parallel.

### Seam clean-up and audit trail (the assignment's step 0)

- The `client.ts` ↔ `sessionBound.ts` import cycle is removed.
- The transformation audit trail translates every P3 action and field the integrated API writes, in EN and AR:
  - initiative and its lifecycle;
  - the gap, contribution and decision links;
  - portfolio selection;
  - funding;
  - weight sets, scores, rankings and overrides;
  - waves, deliverables and milestones;
  - dependencies and dependency types;
  - capacity, resource roles and resource demand;
  - business cases and lines;
  - benefit formulas, versions and calculations;
  - dispensations;
  - gate decisions and agreements.
- Business-approval actions say "(business approval)".
- **The funding, capacity and resource-demand action and field names are anticipated, not observed.** BE-E's files were not in this tree. See §5.

## 3. Checks run

Environment: Node 24.21.0, offline. Logs are in `docs/delivery/handbacks/DG3/T-DG3-FE-A-evidence/`.

| Check | Command | Exit | Result |
|---|---|---|---|
| Historical DG2 gate | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)`, at the start and the end (`validate-dg2-historical.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` ("All matched files use Prettier code style!"). It was rerun after this handback was written. |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | `contrast.log` |
| Unit tests, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **1** | 67 files, **1365 passed, 8 failed** (`test-locale-unset.log`) |
| Unit tests, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | 67 files, **1365 passed, 8 failed** (`test-c-utf8.log`) |
| e2e, locale unset | `env -u LANG … QA_PG_PORT=23500 E2E_API_PORT=23501 MTH_PORT_POOL=23510-23549 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **84 passed, 2 failed, 2 did not run** (8.3 min; `e2e-locale-unset.log`) |
| e2e, C.UTF-8 | the same command with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **1** | **84 passed, 2 failed, 2 did not run** (6.9 min; `e2e-c-utf8.log`) |

### Why the unit-test and e2e runs exited 1

All of these failures are the seam-stub assertions from FE-A0 (§5.1). Nothing else failed.

- **Unit tests.** The 8 failing tests are `src/app/p3-seams.test.tsx › stubs (en|ar) › portfolio | initiatives | readiness | dispensations`. Each asserts that the page still shows the "being built" stub and fetches nothing. The assignment requires me to replace those stubs and forbids editing `apps/web/src/app/**`. Every other test passes, including the route→component wiring test in the same file.
- **e2e, failed.** `p3-seams.spec.ts:38` failed in en and ar, because it waits for `[data-state='being-built']` on `/portfolio`.
- **e2e, did not run.** `p3-seams.spec.ts:76` did not run (serial mode after the failure). It also expects the stub on the Portfolio tab.

### Unit tests for this task

All pass, in both locale settings. They are **59 component tests with stubbed API responses, in EN and AR**, plus **79 audit tests**.

| File | Tests | What they cover |
|---|---|---|
| `portfolio.test.tsx` | 32 | three columns and Selected - unfunded; Unknown rank; server filters; draft create with Idempotency-Key; AUD read-only; hierarchy with Unknown target; 14 T05 fields and the 3–7 warning; the four transition 422s translated as one alert; select business approval with blank rationale refused, If-Match and no on-behalf control; 409 conflict reload; not-TOM-evidence 422; outcome required and KPI optional; AUD card; cancelled read-only |
| `readiness.test.tsx` | 4 | the five area labels; never green; inherited approval pending, then counts while G1 stays draft; blocker translated |
| `dispensations.test.tsx` | 12 | unverified evidence; recorder not offered the decision; waiver and inherited-approval required fields; 422 translated; decide is a business approval with the result required; on-behalf 422 and recorder 403 translated; revoke with reason and If-Match; AUD |
| `g4.test.tsx` | 11 | `g4Subject`; the eight criteria with 'Owners', 'Finance validation', initiative names and links; no English in AR; refused-submission 422 list; decision 403/403/409 translated |
| `auditChanges.test.ts` | 79 new | 73 P3 actions labelled in EN and AR (one test each); business-approval actions labelled as such; field kinds, statuses, enums, exact decimals, booleans and agreements |

### e2e per project and setting

The counts are identical in both settings.

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `p3-portfolio.spec.ts` (new) | 6/6 passed | 6/6 passed |
| `journeys.spec.ts` | 9/9 | 9/9 |
| `p2-journeys.spec.ts` | 12/12 | 12/12 |
| `session-end.spec.ts` | 5/5 | 5/5 |
| `p2-blank-text.spec.ts` | 9/9 | 9/9 |
| `p3-seams.spec.ts` (FE-A0) | 1 passed, 1 failed, 1 did not run | the same |

### Earlier runs (disclosed, logs kept)

- **`e2e-p3-portfolio-dryrun1-failed.log`** (my spec alone): exit 1, 4 passed and 2 failed (the card test in en and ar).
  - Cause: the unpaged link lists answered **400** to the `limit` query that `fetchAllPages` adds. The screenshot showed "Some values are not valid" on the gap-link section.
  - Fix: one plain GET for `{items}` lists (§5.3).
- **`e2e-p3-portfolio-dryrun2.log`**: 12/12 passed.
- **Unit test fixes during development:** handler order, ambiguous fixture texts, and the Arabic "revoke" label, which collided with "Cancel" (إلغاء) and is now "إبطال الإعفاء".

### Interaction checks run on the real stack (both languages)

- Status filter emptying and restoring the list.
- Draft creation through the dialog, then navigation to the card.
- Submit refused before G1, with exactly one alert.
- Gap link to a journey refused (not TOM evidence), with exactly one alert.
- Contribution: the missing outcome is refused inline, then saved with "No KPI".
- Readiness: all five missing areas and the G1 blocker.
- Waiver: refused inline without a reason, then recorded with gate, reason, initiative scope and expiry. The recorder sees no decide action.
- AUD (`dev.auditor`) visited the list, card, readiness and dispensations. Each showed the read-only note and no write control, and **no non-GET request was sent**.
- Every request stayed on the application origin.

### Accessibility

axe (WCAG 2.0/2.1 A and AA) ran on 12 screens per language. It found **0 violations of any impact**: `screenshots/{en,ar}/axe-summary-p3-portfolio.json`.

### Screenshots

Twelve per language, in `apps/web/e2e/screenshots/{en,ar}/` (copied to `T-DG3-FE-A-evidence/screenshots/{en,ar}/`):

- `p3-portfolio-list.png`, `p3-portfolio-create.png`, `p3-portfolio-card.png`
- `p3-portfolio-submit-refused.png`, `p3-portfolio-not-tom.png`
- `p3-portfolio-readiness.png`
- `p3-portfolio-dispensation-record.png`, `p3-portfolio-dispensations.png`
- `p3-portfolio-aud-list.png`, `p3-portfolio-aud-card.png`, `p3-portfolio-aud-readiness.png`, `p3-portfolio-aud-dispensations.png`

## 4. Flows tested only with stubs (live e2e is the next wave)

These need BE-E (funding, capacity, G4 evaluators), or a ranking, a sponsor, or a second approver that the seed does not provide in this tree:

1. **G4 view:** the eight criteria with missing items, the refused-submission 422 list, and the decision 403/409.
2. **Funding states** "Funded" and "Selected - unfunded" in the list, and the launch refusals `initiative.selected_unfunded` and `initiative.direction_not_approved`.
3. **Selecting** a ranked initiative, which needs a ranking from FE-B and BE-D, and deselecting.
4. **Dispensation decide and revoke** by the gate's configured approver, including the on-behalf 422 and the recorder 403.
5. **Proposed ranks** in the list.
6. **The P3 audit labels** for funding, capacity and resource-demand events.

## 5. Seam and contract mismatches, and what is left undone

1. **FE-A0 seam tests still assert my stubs.** `apps/web/src/app/p3-seams.test.tsx` (8 tests) and `apps/web/e2e/p3-seams.spec.ts` (2 tests) still expect the portfolio, initiative, readiness and dispensations pages to be "being built" stubs.
   - The assignment requires those stubs to be replaced, but `app/**` is outside my write scope and the e2e file is not in my "Own" list. I did not edit them.
   - **Proposed patch:** `T-DG3-FE-A-evidence/proposed-seam-test-update.patch`. It keeps the route wiring test, skips the stub assertions for the three replaced namespaces, removes the four rows from the e2e `PAGES` table, and expects the real Portfolio screen in the area-navigation test.
   - **The patch has not been applied or run**, because applying it would mean writing outside my scope.
   - FE-B and FE-C will hit the same problem for their stubs. The `REPLACED` set in the patch is the place to add their namespaces.
2. **Problem codes in `RecordDialog` forms.** `RecordDialog` translates server problems only through `problems.*`, which I do not own. On the initiative create and edit forms, a portfolio-specific 422 such as `initiative.read_only` or `initiative.planned_range` falls back to the generic translated 422 text. That text is translated, not raw English, but it is less specific. My own dialogs (transitions, links, dispensations) translate those codes specifically.
   - **Seam suggestion:** let `RecordDialog` accept a `namespaces` prop, or add these codes to `problems.json`.
3. **Unpaged list endpoints refuse `limit`.** `GET …/gap-links`, `…/outcome-contributions`, `…/decision-links`, `…/milestones` and `…/waves` return `{items}`, and their strict query rejects `limit` with a 400. `fetchAllPages` (`api/queries.ts`) always sends `limit`, so FE-B and FE-C must not use it for these endpoints. `api/portfolio.ts` uses a plain GET for them.
4. **Waves have no zod mirror** in `@mth/shared/schemas`. I added a minimal `RoadmapWave` interface to `api/types.ts`.
5. **Audit names for BE-E are anticipated.** The action names `funding_decision.*`, `capacity.*`, `resource_role.*` and `resource_demand.*`, and fields such as `funding_source`, `conditions`, `available_fte` and `demand_fte`, are inferred from ADR-0021/0023 and the shared `fundingDecision` schema. BE-E's audit writes were not in this tree. If BE-E uses other names, `journeys.spec.ts` will flag the untranslated ones on any trail that carries them, and `lib/auditChanges.ts` would need the matching entries.
6. **Some P3 enum codes on the trail are shown as codes, LTR and unmarked**, not as localized labels. This applies to `line_kind`, `benefit_class`, `unit_kind`, `polarity`, `confidence`, `result_*`, `frequency` and `recurrence`. Statuses, kinds, actions, link target types, acceptance, results, outcomes and validation states are fully labelled.
7. **Layout.** The T05 field list uses plain definition-list styling, because `styles/app.css` is outside my scope. No new CSS was added.
8. **Not done:**
   - creating deliverables and milestones from the card (FE-B's roadmap owns them; the card links there);
   - a G4 live e2e (next wave);
   - a separate `#initiative-<id>` anchor on the roadmap (FE-B).

## 6. Merge instructions

- There are no migrations and no changes to dependencies, the API or the contract.
- Merge `apps/web/**` as delivered.
- **Apply the seam-test patch** (§5.1) in the same integration, or the unit tests and e2e stay red on the 10 stub assertions above.
- Expected conflicts:
  - `i18n/{en,ar}/gates.json` and `transformations.json` with any other wave-4 task that adds keys there. They are additive keys only, so merge them by key.
  - `pages/gates/GateDetailPage.tsx` only if another task edits the criteria table.
- Rebuild (`pnpm -r build`) before the e2e. `with-stack.sh` serves `apps/web/dist`.
