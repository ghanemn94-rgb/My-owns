# Handback T-DG4-FE-E: P4 slices F and G screens: adoption, BAU and performance areas, handovers, controls, reviews, CI backlog, lessons (frontend-ux-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. This is an engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6), and no product gate implies any DG gate.
  - All test and demo data is SYNTHETIC.
  - The e2e journey records a BAU handover acceptance. That is a synthetic, in-product demo business decision by the receiving owner. It approves nothing real.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-E-frontend-ux-engineer-20261010T031042Z-fc01f349","session_id":"fc01f349-2b22-4850-a80c-88ad5de64387"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-E.md`, sha256 `40dc4401…7922a5`. I checked it with `sha256sum` at the start, and it matches.
- **Worktree / base:** `/home/user/wt/dg4-fe-e`, branch `dg4/fe-e`, base `HEAD` `7dd77b5`. **Nothing is committed.** The changes are left in the working tree for the orchestrator.
- **Time:** start `Sat Oct 10 03:10:56 UTC 2026`; end in §7 and `run-times.txt`.
- **Preceding gate:** before any implementation, `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0 (`validate-dg3-historical-start.log`). I re-ran it at the end (§4).
- **Scope read:**
  - p4-work-split §1 (S-1…S-14) and §F+G (FG.0–FG.11; FG.8 is my paragraph);
  - ADR-0033 (§1–§13 and amendment A1–A3) and ADR-0034 (§1–§13 and amendment A1–A3);
  - `openapi.yaml`: the 85 slice F/G operations, with their query parameters and request bodies;
  - the zod mirrors `schemas/{adoption-register,adoption-indicators,adoption-assessments,sustainment-areas,sustainment-operations}.ts` and `adoption/form-schema.ts`;
  - D-088…D-090, D-101, D-104–D-106, D-110;
  - the FE-A and FE-D handbacks;
  - the FE-R1 assignment, to check file ownership;
  - the ARCH-R1/R2 code tables;
  - the DG0 glossary (`docs/analysis/glossary.md`).

## 1. Changed files

### Owned (all new): `pages/adoption/**`, `pages/bau/**`, `pages/improvement/**`, `pages/lessons/**`

| File | Purpose |
|---|---|
| `pages/adoption/api.ts` | Request paths (operationId in a comment) and read hooks of the slice F operations the screens call. Keys come from FE-A's `p4Keys.area("stakeholder-groups" / "adoption", tid, …)`, so `useP4Refresh(tid)` refreshes them. |
| `pages/adoption/ui.tsx` | Slice F kit:<br>- `ProvisionalAr`: the "Provisional Arabic translation" flag, shown in Arabic only;<br>- `StanceText`, `LevelText`, `StatusText`: label + icon, never colour alone;<br>- `MeasureValue`: a decimal fraction × 100 via the shared decimal formatter. **Unknown / Not computable are the grey labelled chip with the translated reason, never 0 and never green**, and Stale keeps its chip;<br>- `MeasureName`: the source English indicator stays visible under the Arabic;<br>- `NoReportingPeriod`: every measure Unknown when the organization has no started period;<br>- `AdoptionSubNav`, `NS = ["adoptionP4"]`. |
| `pages/adoption/actions.tsx` | `useActionRunner`: bodiless versioned POSTs (publish, retire, remove, cancel) with If-Match, inside a session guard, with one alert per section. A 409 or 422 reloads the data. Also used by slice G. |
| `pages/adoption/AdoptionPage.tsx` | `/transformations/:id/adoption`:<br>- the **T13 Stakeholder & Adoption Plan** (`getAdoptionPlan`) with its seven B0107 columns (Stakeholder, Impact, Current stance, Required behavior, Intervention, Owner, Adoption KPI), plus **Influence as a separate column** and the champion, open-intervention and open-constraint counts;<br>- the **stakeholder groups** register: create and edit with the **closed lists only** (H/M/L; Support/Neutral/Resist; four intervention checkboxes; at least one required), and archive with a reason;<br>- per group, **champions** (add, remove) and **impacted-team involvement** in T04 design decisions (record, withdraw with a reason; the history stays listed). |
| `pages/adoption/InterventionsPage.tsx` | `/transformations/:id/adoption-interventions` and `…/adoption-interventions/:interventionId` (the `adoption_intervention_due` work-item link):<br>- create with the four B0107 types, an **owner and a due date (both required)**;<br>- update: title, owner, due date, status move, and the outcome note required when done or cancelled;<br>- a worker (below-trajectory) row shows **"Unassigned"** and the due date as **Unknown with its reason**;<br>- filters by status and origin. |
| `pages/adoption/IndicatorsPage.tsx` | `/transformations/:id/adoption-indicators`:<br>- **the seven leading indicators by name** (`sourceIndicatorEn` verbatim; Arabic flagged provisional) with their measures. Indicator 4 has two measures;<br>- current values per target (transformation, outcome, initiative, stakeholder group), Unknown never 0;<br>- **metric links**: attach a measure (create a KPI from the template with its owner, or link an existing KPI; record-fed measures take none) and remove. |
| `pages/adoption/TrainingPage.tsx` | `/transformations/:id/adoption-training`:<br>- **training completion and observed proficiency side by side** for a group, as two separate cards that are never merged, with a note that completion never counts as proficiency;<br>- training records: create with exactly one participant, a person or a label; record the outcome completed / no-show / withdrawn, and completed needs its date;<br>- the group's **proficiency observations**. |
| `pages/adoption/FormBuilder.tsx` | The **question builder** of the validated form JSON:<br>- 1–20 questions; key, type, EN and AR labels, required;<br>- options for single choice; min/max for a scale; the proficiency flag and pass mark;<br>- move up/down, remove.<br>A server 400 `assessment_form.schema_invalid` marks the question its pointer names, with a translated message (no English reason in Arabic). |
| `pages/adoption/FormsPage.tsx` | `/transformations/:id/assessment-forms` and `…/assessment-forms/:formId` (the `assessment_invitation` link):<br>- forms list;<br>- form detail: questions of the current version; **draft clearly marked** ("takes no invitations and no responses until published"; "draft version n not yet published");<br>- **publish** (If-Match), retire;<br>- **invitations**: invite with a work item for the invitee; cancel;<br>- **respond**: feedback or a proficiency observation that names its stakeholder group and the person observed. The answers are typed by question; the API derives the result, and the client never sends it;<br>- the form's responses. |
| `pages/adoption/RecordPage.tsx` | `/transformations/:id/assessment-records/:recordId` (the `assessment_to_review` link): the record with its group, its answers in the shown language, **review** (optional note) and **withdraw** (reason; for a reviewer or the respondent). |
| `pages/adoption/ChampionConstraints.tsx` | The **champion constraints section on the T04 Design Decision Log page**:<br>- filtered by decision through `listChampionConstraints?decisionId=`, and by status;<br>- raise as an active champion of the chosen group (if the caller is not one, the form says so in the API's words);<br>- resolve: addressed with a response, by a decision editor, or withdrawn by its champion. |
| `pages/adoption/adoptionFixtures.ts`, `adoption.test.tsx` | Synthetic fixtures (shared with slice G); **18 unit tests** (9 per language). |
| `pages/bau/api.ts` | Paths and hooks of the slice G operations: areas, links, handovers, controls, checks, reviews, CI items, lessons, and the lesson search (always re-read: not a key of one transformation). |
| `pages/bau/ui.tsx` | Slice G kit:<br>- `StatusText`;<br>- `SignalText`: **an `unknown` review signal is Unknown, never on track**;<br>- `ScheduledDate`: **"Not scheduled", never a guessed date**;<br>- `frequencyText`, `SustainSubNav`, `NS = ["sustainP4"]`;<br>- `AcceptanceNote`: "Business approval", never DG0–DG7. |
| `pages/bau/BauPage.tsx` | `/transformations/:id/bau` (areas list and create) and `…/performance-areas/:areaId` (the `performance_review_due` / `control_check_due` link):<br>- area details: BAU owner and KPI owner **Unknown** until BAU; next review "not scheduled"; a note that the area outlives its transformation;<br>- **cycle history**: every cycle with its reopening reason, **the prior accepted handover with its acceptance time and acceptor, and the closure date it followed, as they were**;<br>- linked KPIs and benefits (add, remove);<br>- the area's handovers, controls, checks and reviews;<br>- edit, **reopen** (reason), retire (reason). |
| `pages/bau/HandoverPage.tsx` | `/transformations/:id/bau-handovers` and `…/bau-handovers/:handoverId` (the `bau_handover_to_accept` link):<br>- **the handover checklist**: the nine M0217 items in the ADR-0034 §12 order, each Provided or **Missing** (from `missingItems`), with its content;<br>- prepare and edit the content (draft or returned only), add evidence;<br>- **submit**: a 422 `bau_handover.incomplete` alert **lists every missing item in the shown language**, from the error pointers;<br>- **accept / return offered to the receiving owner only**. Others see "Only the receiving owner can accept or return this handover". The accept dialog carries the **business-approval** note;<br>- an accepted handover reads "final … a reopening starts a new cycle";<br>- the area's open improvement items beside the backlog summary. |
| `pages/bau/ControlsPage.tsx` | `/transformations/:id/bau-controls` and `…/bau-reviews`:<br>- **controls**: create, edit, retire with a reason; "the area's BAU owner" when there is no owner;<br>- **control checks**: record passed / failed, and failed needs a note. **A failed check links to its slice E recovery case**, or "Being opened" until the consumer has opened it, never a guess;<br>- **reviews** (scan-created; "created up to 7 days before due, whatever the transformation's status"): complete with an outcome and a signal, **assignee only**. |
| `pages/bau/sustain.test.tsx` | **14 unit tests** (7 per language). |
| `pages/improvement/ImprovementPage.tsx` | `/transformations/:id/improvement`: the **CI backlog** ("stays visible and editable after the transformation is closed"):<br>- create, manual or from a lesson;<br>- edit; status move, with the resolution note required for done / rejected;<br>- source, priority, owner, target date. |
| `pages/lessons/LessonsPage.tsx` | `/transformations/:id/lessons`: create and edit; publish; archive. **Draft is marked "not searchable yet"**.<br>`/lessons`: the **lesson search across transformations** (`searchLessons`, `q` and `tag`). It shows each lesson's transformation code and name, needs `lesson.search` (AUD included), and states its scope. |

### Translations

| File | Purpose |
|---|---|
| `i18n/{en,ar}/adoptionP4.json`, `i18n/{en,ar}/sustainP4.json` (new) | The two page namespaces, 318 + 257 keys. They are generated from one table (`T-DG4-FE-E-evidence/i18n-namespaces-gen.py`), so EN and AR key sets are identical; the i18n parity test passes.<br>Arabic follows the DG0 glossary: التحوّل, التبنّي, خطة أصحاب المصلحة والتبنّي, داعم/محايد/معارض, تواصل/تدريب/إشراك/تحفيز, مناصر التغيير, العمليات الاعتيادية, التسليم إلى العمليات الاعتيادية, قائمة التحسين المستمر, المالك التشغيلي للأعمال, مؤشر الأداء الرئيسي. The Arabic is provisional, and the T13 lists and indicator labels carry the on-screen flag. |
| `i18n/{en,ar}/problems.json` | **Append-only:** 73 keys per language at the end of the file. The only removed line is the old last line gaining a comma. They cover:<br>- every ADR-0033 §10 code (36);<br>- every ADR-0034 §12 code (36, the two `closure.value_validation_pending` rows being one key);<br>- ADR-0033 A3's `validation.conflict`.<br>`validation.not_applicable`, `validation.required` and `invalid_transition` already existed and are asserted, not re-added. Texts with `{placeholders}` render without parameters (FE-C/FE-D precedent). Generator: `problems-append.py`. |
| `i18n/index.ts` | 4 import lines and 2 catalogue entries per language (the FE-B/C/D precedent). |
| `i18n/{en,ar}/nav.json` | **Append-only:** 5 `nav.sub.*` labels, the FE-D precedent. This is outside the named folders; it is disclosed here. |

### Navigation and routes (FE-A's files; append-only, as assigned)

| File | Edit |
|---|---|
| `components/Workspace.tsx` | 4 workspace tabs appended: `adoption`, `bau`, `improvement`, `lessons`. |
| `app/nav.ts` | `AreaWorkspaceTab` gains the 4 ids. `NavSubPage` gains 5 entries:<br>- Change and Adoption > Adoption plan (T13);<br>- BAU and Improvement > Performance areas, Improvement backlog, Lessons, Lesson search (`/lessons`, `requiresAny: lesson.search`).<br>Both areas **stay "planned"** (their cross-portfolio views are planned), so the DG1 tests asserting planned areas are unchanged. This is the FE-D pattern. |
| `app/router.tsx` | The 4 FE-E entries were removed from `P4_PLANNED_ROUTES`. 17 real routes were added, among them the four planned paths. **Every slice F/G backend `linkPath` resolves**, except `transition-decisions/:id`, which is FE-F's. |

### Outside my folders (minimal, disclosed)

| File | Edit | Why |
|---|---|---|
| `pages/decisions/DecisionsPage.tsx` (DG2 FE) | 1 import + 1 JSX line: `<ChampionConstraintsSection />` between the T04 log and the gate decisions. | FG.8 assigns "champion constraints on the T04 decision page" to FE-E, but the page file is not in my folders. The DG2 Decision schema and operations are unchanged (ADR-0033 §7). |
| `pages/my-work/my-work.test.tsx` (FE-A's) | 2 lines: the "planned route shows being built" test now opens `/transformations/:id/closure` (FE-F, still planned) and expects `nav.p4.closure.title`. | `/adoption` is now built. This is FE-D's documented hand-over (FE-D handback §7). |
| `e2e/p4-governance.spec.ts` (FE-A's) | 1 line: the planned-route step opens `/closure` instead of `/adoption`. | The same reason. |

### e2e (new)

`apps/web/e2e/p4-adoption-bau.spec.ts`: 8 serial steps × 2 projects on the real stack (§2, §4). The synthetic BO, second BO and AUD users are created through the admin API, as in FE-A's, FE-C's and FE-D's specs. A second synthetic transformation holds the auditor's scope for the lesson search.

No file in `apps/api`, `apps/worker`, `packages/**`, `docs/api/**`, `tools/**`, `docs/source/**`, `styles/**`, any `package.json` or the lockfile changed. `myWork.json` is untouched: the work-item message keys are FE-R1's (its item 3). The untracked `.bashrc`, `CLAUDE.local.md`, `.idea`, `.vscode` and similar files at the worktree root predate the run and are not mine.

## 2. Behaviour delivered, per requirement row (acceptance text quoted)

FG.8 gives FE-E the **screens**. Each FG.10 row has a backend owner who owns the API behaviour. Below is what the screens render for each row and how I checked it.
- "unit" means `adoption.test.tsx` / `sustain.test.tsx`, run in EN and AR.
- "e2e" means `p4-adoption-bau.spec.ts` on the real stack, in EN and AR (screenshots `p4ad-*`).

- **REQ-PB-070**, "A01: T13 persists all 7 columns; stance 'Hostile' is rejected; Intervention accepts the four source values".
  - The plan shows the seven columns. The form offers only the closed lists, and a server 400 lands on its field, translated.
  - unit: the seven headers and influence; the stance select holds exactly support/neutral/resist; a 400 `stakeholder_group.stance_invalid` at `/currentStance` makes that field `aria-invalid` with the translated text.
  - e2e step 1: a group created in the UI with Resist, H/L and Comms+Training appears in the T13 table. A real `PATCH {currentStance:"hostile"}` answers 400 `stakeholder_group.stance_invalid` (`p4ad-01`, `p4ad-02`).
- **REQ-S11-001**, "A11: a group records influence and impact separately; an intervention with owner and due date appears in My Work".
  - Influence is its own column and field. The intervention form requires an owner and a due date.
  - e2e step 2: an intervention planned in the UI for the synthetic BO is in the BO's `GET /me/work-items` as `adoption_intervention_due`. Its `linkPath` opens the intervention detail (`p4ad-03`, `p4ad-04`).
- **REQ-PB-069**, "A11: an initiative with delivery Complete and adoption below trajectory shows adoption at risk and triggers an intervention; an adoption actual below trajectory creates exactly one intervention".
  - Display side: below-trajectory interventions show their origin ("Below trajectory (automatic)"), "Unassigned" when the worker found no owner, and the due date Unknown with its reason (unit).
  - The exactly-once creation is KBE-F's worker test.
  - The "adoption at risk" status is BE-J's status model, whose screen is FE-F's (closure / status model).
- **REQ-PB-071**, "A11: all seven indicators are available by name; an actual below trajectory creates a corrective intervention".
  - The indicators page lists the seven by their verbatim names. Arabic labels are flagged provisional (unit; e2e step 3, `p4ad-05`).
  - The corrective intervention is KBE-F's and is shown by the interventions page.
- **REQ-PB-072**, "A11: 100% training completion with no proficiency observations shows proficiency Unknown, not adopted".
  - unit: completion 100 % beside proficiency Unknown "(no proficiency observations)". No 0, no 100, no green on the proficiency card.
  - e2e step 4: on the real stack, one training record completed in the UI shows "100 %" (1 of 1) while observed proficiency reads Unknown (`p4ad-06`).
- **REQ-S11-002**, "A11: a proficiency observation submitted via the form links to the stakeholder group and counts in the proficiency indicator".
  - e2e step 4: the BO builds a proficiency form in the question builder, publishes it and answers it as an observation for the group. The response shows "Proficient", and the training page then shows observed proficiency "100 %" with the observation listed under the group (`p4ad-07`–`p4ad-09`).
  - unit: the POST carries `stakeholderGroupId` and no `proficiencyResult`.
- **REQ-PB-073**, "A01;A11: a champion's constraint links to a T04 decision and is visible on that decision".
  - unit: the decision filter issues `?decisionId=` and lists the constraint.
  - e2e step 5: the BO, a champion of the group, raises a constraint on a T04 design decision from the decisions page. Filtering by that decision lists it with the decision code (`p4ad-10`).
- **REQ-S16-020** (A11, entity group: StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord, AdoptionMetricLink).
  - The screens create and read each one through the API: groups, interventions, training records, assessment records, metric links.
  - The AUD user gets read-only views (unit; e2e step 8). The entity-group integration test is BE-H2's.
- **REQ-S11-005**, "A11: a handover missing data access is rejected; acceptance by anyone other than the receiving owner returns 403".
  - unit: the checklist marks `data_access` Missing. The 422 alert's list reads the translated "Data access", with no English in Arabic, and If-Match is sent. Only the receiving owner gets the accept button, which carries the business-approval note.
  - e2e step 6: the submission without data access is refused, and the alert names "data access" in EN and AR (`p4ad-11`). A second synthetic BO sees the receiving-owner-only note, no action, and its API accept answers 403 `bau_handover.not_receiving_owner`. The receiving owner accepts in the UI (`p4ad-12`).
- **REQ-PB-083**, "A11;A13: accepting a handover creates recurring BAU review tasks for the BAU owner exactly once".
  - e2e step 6: after the acceptance there is exactly one review, assigned to the BAU owner. A repeated accept answers 422 and the count stays 1. The reviews page lists one row (`p4ad-13`).
- **REQ-S11-009**, "A07;A11: after reopening, the original handover acceptance and closure date remain visible and unchanged".
  - The cycle history shows both, per cycle.
  - unit: cycle 2 carries the prior acceptance `2026-03-10T09:30:00Z` and closure `2026-06-30T12:00:00Z` exactly.
  - e2e step 7: after reopening in the UI, cycle 2's prior acceptance equals the handover's `acceptedAt` (`p4ad-14`).
  - The transformation is not closed in that journey, so the closure column reads "None". Closing needs G6 and FE-F's closure screen.
- **REQ-S11-008**, "A11: a failed control check creates a recovery action; a lesson is searchable from another transformation".
  - unit: a failed check links to `/corrective-actions/<caseId>`.
  - e2e step 7: a lesson published in transformation 1 is found by the auditor of transformation 2 through `/lessons` (`p4ad-16`, `p4ad-17`).
  - Checks are created by the worker's daily scan, which the e2e stack does not run. The failed-check-to-case behaviour is BE-I2/BE-D2's integration test.
- **REQ-PB-084**, "A11: CI backlog items remain visible after transformation closure; G6 lists the backlog".
  - unit: with the transformation `status: "closed"` the item is listed, and its edit sends PATCH with If-Match.
  - e2e step 7: a CI item created in the UI (`p4ad-15`).
  - "G6 lists the backlog" is slice H's (BE-K).
- **REQ-S03-002** / **REQ-S11-004**, "A11: after a transformation is closed its linked performance area still generates scheduled review tasks and accepts KPI actuals" / "A11: after closure, the next scheduled review task is created on time".
  - Display side: the area page says the area outlives its transformation. The reviews page states the scan rule and shows the creation source.
  - The scan is BE-I2's worker test.
- **REQ-PB-009, REQ-S03-003, REQ-S11-006, REQ-S11-007** (status model, closure, transition decisions): **not my screens.** They belong to FE-F's `pages/closure/**` (FG.8). Their ADR-0034 §12 problem codes are translated here (`closure.*`, `initiative.*`, `transition_decision.*`).
- **S-6 / S-7 / S-11.**
  - Every ADR-0033 §10 and ADR-0034 §12 code is translated, and Arabic texts contain Arabic letters (unit).
  - One form-level alert per dialog or section.
  - Every action runs in a session guard with If-Match.
  - AUD sees read-only notes and no write control (unit; e2e step 8).
  - Labels say "business approval", never DG0–DG7 (unit, e2e).
- **Unknown is never 0 or green:**
  - measure values, with the reason;
  - "Unassigned" owners;
  - due dates Unknown with their reason;
  - BAU and KPI owners Unknown before BAU;
  - "Not scheduled" review dates;
  - the review signal `unknown`;
  - the no-reporting-period state.
- **390 px and 200 % text** (e2e step 8):
  - At 390 px there is no page-level horizontal scroll (`scrollWidth − innerWidth ≤ 1`) and axe reports 0 serious or critical issues on the adoption plan, training, a handover, an area and the lesson search.
  - At 200 % root font size the same holds on the adoption plan, an area and the CI backlog.

## 3. Operations routed (pending-list delta)

FE-E has **no** `p4-pending-fe-e.ts` or `p4-exercises-fe-e.ts`. All 85 slice F and G operations were routed by BE-H, BE-H2, KBE-F, BE-I, BE-I2, BE-J and KBE-R2 (their pending lists are empty at base `7dd77b5`). **Delta: none.** `contract.test.ts` is untouched, and no API or contract file changed.

The web client now calls **71 of the 73 slice F/G operations outside closure**. It does not call:
- `getStakeholderGroup`, because the register rows carry the record;
- `getAdoptionMetricLink`, because the list carries it.

The 12 status-model, closure and transition-decision operations are FE-F's.

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-FE-E-evidence/`)

**Environment:**
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; no browser was installed.
- Harness ports, all from my 25450–25499 range:
  - integration: `QA_PG_PORT=25453`;
  - final e2e: `E2E_PG_PORT=25454`, `E2E_API_PORT=25455`;
  - development e2e runs: 25451 and 25452;
  - `MTH_PORT_POOL=25460-25499` throughout.
- Empty `.claude/.cc-writes` directories inside source folders were removed before each test run.
- Free disk was 18–19 GB before each full run (`disk-before-*.txt`).
- The integration logs were written to `$TMPDIR` during the suite and copied here afterwards (the G6 test).

| # | Command | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| 1 | `pnpm -r build` | exit 0 (`build.log`, final build before the e2e run) |
| 1 | `pnpm lint` | exit 0 (`lint.log`) |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`; re-run after this handback: `format-final.log`) |
| 1 | `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 649 operations` (`openapi-lint.log`) |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | exit 0: **2434 passed** (128 files) + **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: **2434 passed** (128 files) + **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| 3 | `QA_PG_PORT=25453 MTH_PORT_POOL=25460-25499 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: **1708/1708** (180 files) (`integration.log`). No pinned count changed (no API, contract or schema change). |
| 4 | `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (full suite) | **exit 1: 254 passed, 1 failed, 3 did not run** (258 tests, 27.6 min) (`e2e.log`). The one failure is the DG2 spec `p2-journeys.spec.ts:828` "Define → G2" in chromium-en: **"Test timeout of 30000ms exceeded"** at 31.7 s, with no assertion failure. The 3 "did not run" are that serial spec's next steps in chromium-en (G3, Team, AUD). See the disclosure below. |
| 4 | `with-stack.sh npx playwright test apps/web/e2e/p2-journeys.spec.ts --workers=1` (targeted re-run, fresh stack) | exit 0: **24 passed** (12 en + 12 ar), 3.0 min; "Define → G2" took 20.3 s in en and 19.0 s in ar (`e2e-rerun-p2-journeys.log`) |
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` at start and end (`validate-dg3-historical-{start,end}.log`) |

**Unit counts:** 2434 includes **32 new**: 18 in `adoption.test.tsx` and 14 in `sustain.test.tsx`. The two retargeted my-work tests keep their count.

**e2e counts:** 258 = the FE-D baseline of 242 + **16 new** (`p4-adoption-bau.spec.ts`, 8 steps × 2 projects, all passed in the full run).
- Per spec and project (`e2e-per-spec.txt`; en = ar unless stated): journeys 9, p2-blank-text 9, p2-journeys 12 ar / 8 passed + 1 failed + 3 did not run en, p3-business-cases 6, p3-g4-refusal 2, p3-inherited-approval 5, p3-journeys 18, p3-portfolio 6, p3-prioritization-roadmap 7, p3-seams 3, p3-ui-completion 7, **p4-adoption-bau 8**, p4-benefits 8, p4-governance 8 (its planned-route step now opens `/closure`), p4-kpi 9, p4-raid-governance 7, session-end 5.
- axe is asserted inside every step (0 serious or critical issues, or the step fails), so every passed step includes it. My spec runs axe 23 times per language, including the 390 px and 200 % pages.

**The full-run e2e failure, disclosed and explained.**
- `p2-journeys.spec.ts:828` is a DG2 journey whose pages I did not change. It ran out of Playwright's whole-test budget of 30 s (31.7 s) after G2 was already approved:
  - the failure screenshots show "Approved" on the office's page and the phase moved to Design (`full-run-failure/test-failed-2.png`);
  - the trace ends with no failed assertion (`full-run-failure/error-context.md`).
- In the earlier recorded runs (FE-A…FE-D evidence), the same test took 19.3–26.8 s, close to the 30 s budget.
- In this run the chromium-ar copy passed in 21.6 s. This machine ran three other agents' suites concurrently (D-004).
- The targeted re-run of the whole spec on a fresh stack passed 24/24, with this test at 20.3 s.
- I read this as load-related timing, **not** a regression. My only edits on its path are four appended workspace tabs and the T04 page section, which the G2 step does not visit.
- I did **not** re-run the full 28-minute suite, because of the time limit. The orchestrator's merged-tree e2e will show whether it recurs. If it does, the journey's test timeout (not mine to change) is the candidate fix.

**Screenshots** (mine only, 20 per language, from the final full run): `screenshots/{en,ar}/p4ad-*.png`. I viewed `ar/p4ad-02-t13-plan.png`, `ar/p4ad-06-training-vs-proficiency-unknown.png`, `en/p4ad-11-handover-incomplete.png` and `en/p4ad-19-390px.png` in the development run (before the glossary fix), and `ar/p4ad-12-accept-business-approval.png` in the final run.

**Disclosed non-zero exits and failures during development** (not the final runs):
- The **first full locale-unset unit run failed 1 test** (`i18n/glossary.test.ts`, "spells the Transformation term consistently"). My Arabic wrote تحول without the shadda.
  - I fixed every string and also aligned the Arabic with the DG0 glossary (BAU, champion, stance, intervention values, CI backlog, Business Owner, KPI).
  - I re-ran both unit invocations from scratch. The logs above are the re-runs, both exit 0.
- **The first e2e run of the new spec failed step 4** in EN and AR (`e2e-dev-run1-new-spec.log`). The form's responses list sent `?formId=`, but the contract's parameter is `assessmentFormId`, and the API answered 400.
  - This was a real UI defect, fixed in `FormsPage.tsx`. The second run passed 16/16 (`e2e-dev-run2-new-spec.log`).
- **First unit run of `adoption.test.tsx`:** 6 of 18 failed on test defects:
  - an unescaped `(` in a label regex;
  - an incomplete decision fixture;
  - a duplicate region name.
  The last one was also a real a11y defect: the values section and its scroll region had the same accessible name. The scroll regions now have their own labels.
- **One `tsc` round** found 4 field-name errors (Outcome `statement`, business unit `nameEn/nameAr`, evidence `title`, the `AssessmentQuestion` type import). All were fixed before the final runs.

## 5. Contract or schema needs (for the orchestrator)

None blocking. Observations:

1. **Work-item message keys** for slice F/G belong to `myWork.json`, which is FE-R1's (its item 3): `adoption.task.intervention_due`, `adoption.task.assessment_invitation`, `adoption.task.assessment_to_review` and the four `sustainment.task.*`. I did **not** place them. Until FE-R1 merges, My Work shows its generic fallback text for those items. The links themselves resolve.
2. **`transition-decisions/:id`** (`sustainment.task.benefit_monitoring_due` and the transition-decision links) is still unrouted in the web until FE-F builds `pages/closure/**`.
3. **No single-form-version read.** A record answered on an older form version shows its answer keys instead of the question labels, because only the current version is readable (`getAssessmentForm`). A `getAssessmentFormVersion` read would let the record page show the labels of the version actually answered.
4. **Indicator values per period.** The indicator views use the API default period (the latest started open or closed period). A period selector would need `listTransformationReportingPeriods` (KBE-R2); that is optional polish.

## 6. What remains

- **Not built**, and outside FG.8's FE-E list, so mentioned for completeness:
  - editing a stakeholder group's adoption KPI from the plan row (it is editable in the group form);
  - recording involvement on a design workshop (the UI records it on a T04 decision; the API accepts both);
  - inviting several people in one submission (the UI invites one at a time; the API accepts up to 100).
- **The worker-driven paths are not exercised in the e2e stack**, which runs no worker: the review and control-check scans, and the below-trajectory intervention. Their screens are covered by unit tests with fixtures, and their behaviour by the backend owners' worker tests.

## 7. Merge instructions

- No migration and no API change. Merge after W14 (base `7dd77b5`).
- Conflicts are possible only with another FE task that edits `router.tsx`, `nav.ts`, `Workspace.tsx`, `nav.json`, `problems.json`, `i18n/index.ts` or `DecisionsPage.tsx`. Resolve them by union: every edit is append-only.
  - FE-R1 also appends to `problems.json` (slices H, I, C, A, J and K codes), so expect a tail conflict there.
- When FE-F builds `/closure`, the planned-route tests I pointed at `/closure` must move to a route that is still planned (e.g. `/transformations/:id/change-requests` or FE-G's `/dashboards/:kind`), or be retired.
- End time: `Sat Oct 10 05:16:59 UTC 2026` (about 2 h 06 min). **The assignment's hard limit of about 2 hours was exceeded by about 6 minutes.** The full e2e suite (27.6 min), its one timeout and the targeted re-run fell at the end; nothing was left half-done.
