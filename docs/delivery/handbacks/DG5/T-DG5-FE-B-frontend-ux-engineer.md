# Handback T-DG5-FE-B (frontend-ux-engineer): P5 slice A screens (Playbook Studio, methodology migrations, source coverage)

- **Stage:** DG5 (P5), wave W10. **Branch:** `dg5/fe-b`, worktree `/home/user/wt/dg5-fe-b`, base `HEAD` = `1487877`. Changes are **uncommitted** for the orchestrator.
- **Invocation:** `DG5-T-DG5-FE-B-frontend-ux-engineer-20261015T101907Z-78c10612` (session `78c10612-28a5-4cd2-a2bb-000445e00b11`).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-B.md` (sha256 `f6ffcb64…6b11`, verified). Scope: `p5-work-split.md` §A; the FE-B row of `p5-plan.md` §5.1 (`pages/studio/**`, `pages/methodology-migrations/**`, `pages/source-coverage/**`).
- **Time:** start `2026-10-15T10:27:05Z`; handback first written `2026-10-15T12:18Z` (about 111 min; the time rule of the assignment applied); updated `13:25Z` after the post-handback runs exposed the e2e defects in §3 item 5, which I fixed.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, **exit 0** at the start (`T-DG5-FE-B-evidence/validate-historical-DG4-start.log`) and again at the end (§4).
- All data in tests, e2e and screenshots is SYNTHETIC. No agent action grants a real business, Finance or IT approval. A configuration review is labelled a configuration review, not a business approval. A migration decision is labelled a business approval inside the product and is never called an engineering gate. Product G6 ≠ DG7.

## 1. Files changed

New (owned by FE-B):

| File | Purpose |
|---|---|
| `apps/web/src/pages/studio/api.ts` | Typed hooks over FE-A's `api/p5.ts`. Pure helpers: `versionState` (a draft never looks published), `checkStatusOf` (Pass/Warning/Fail for the current content hash; **Not run** with no run; **Stale** for a run over another hash; never pass by default), `weightTotal` (BigInt hundredths, no floats), element attribute helpers. |
| `apps/web/src/pages/studio/ui.tsx` | `VersionStateChip`, `CheckChip` (label + icon, never colour alone), `ConfigurationNote`, and `useActionRunner`: a session-bound runner for bodiless actions with If-Match, one form-level alert, and a refresh after success or a 409/422. |
| `apps/web/src/pages/studio/StudioFormDialog.tsx` | The P4FormDialog contract plus `PUT`, which `putConfigElement` needs; `p4ui.tsx` is not FE-B's file (§5). Field errors from `/attributes/<name>` land on their field. |
| `apps/web/src/pages/studio/StudioPage.tsx` | `/admin/studio`: all configuration versions. Kind and status filters, sort (aria-sort), column picker (persisted), pager, "New draft" (`createConfigDraft`) for `methodology.configure`, read-only note otherwise. Links to the Studio sub-pages. |
| `apps/web/src/pages/studio/VersionPage.tsx` | `/admin/studio/versions/:versionId`: details (PATCH `updateConfigDraft`), the pipeline Draft → Preview/Test → Review (where configured) → Publish. Check table per kind for the current content with run buttons (`runConfigPreview`, `runConfigCompatibilityCheck`, `runSourceCoverageCheck`); submit for review, publish, discard, rollback with a required reason (opens the new rollback draft). Side-by-side diff (`getConfigVersionDiff`), affected records (`getConfigAffectedRecords`; a null count is **Unknown**, never 0), review requests with withdraw. Draft banner vs "published, cannot be changed" banner. |
| `apps/web/src/pages/studio/ElementsSection.tsx` | Resolved elements by type (`listConfigElements`, include removed). Edit dialog: labels, help and body in en/ar; approver, recipient and reminder/escalation offsets; tri-state flags so nothing is sent unless chosen. `putConfigElement` and `removeConfigElement` with If-Match; "Add element" (admin origin, D-142 Q4) for the addable types only. |
| `apps/web/src/pages/studio/ReviewPage.tsx` | `/admin/studio/versions/:versionId/reviews/:reviewId`: the request, and the decision (approve / request changes; a note is required for changes) via `decideConfigReview` with the review's version. The requester sees "you cannot decide your own request" (server: 403 `config_review.self_review`). |
| `apps/web/src/pages/studio/ScoringDefaultsPage.tsx` | `/admin/studio/scoring-defaults`: T06 default weights (decimal strings) with a live total (Unknown when invalid; "Does not total 100 % — publishing will be refused"), and the 1–5 rubric descriptors en/ar. Save draft via `putScoringDefaultsDraft` (If-Match), "Draft saved — not published". A published version is read-only, with "Create a draft from this version". A null descriptor reads "No descriptor defined". |
| `apps/web/src/pages/studio/ReviewPoliciesPage.tsx` | `/admin/studio/review-policies`: `listConfigReviewPolicies`; edit (`updateConfigReviewPolicy`, If-Match) only with `config_review_policy.configure` (TO); others read-only. |
| `apps/web/src/pages/studio/RevisionProposalsPage.tsx` | `/admin/studio/revision-proposals`: `listRevisionProposals` with a subject filter, validation chip, impact lines (e.g. affected benefits), reviewer role, review tasks created. |
| `apps/web/src/pages/source-coverage/SourceCoveragePage.tsx` | `/admin/source-coverage`: `getSourceCoverage` for a chosen methodology version (default newest published). The ten sets in M0083 order with expected/present counts, removed keys, planned features and a result chip. "Run source-coverage check" only for an open **draft** (a published version is immutable; the API answers 409, found by the e2e run). |
| `apps/web/src/pages/methodology-migrations/api.ts` | Typed hooks; `itemsByKind` (ADR-0040 §2 order), `previewInputs` (blank → `null` = "leave empty until next edit"), `isOpenMigration`. |
| `apps/web/src/pages/methodology-migrations/ui.tsx` | `MigrationStatusChip` (label + icon; "Draft — plan not submitted", "Approved — not executed" …). |
| `apps/web/src/pages/methodology-migrations/MigrationsEntryPage.tsx` | `/admin/methodology-migrations`: choose a transformation (migrations, pins). |
| `apps/web/src/pages/methodology-migrations/MigrationsPage.tsx` | `/transformations/:id/methodology-migrations`: migrations list, gate re-approvals (`listGateReapprovals`), "Plan a migration" (`createMethodologyMigration`; only newer published versions of the pinned key are offered). |
| `apps/web/src/pages/methodology-migrations/MigrationPage.tsx` | `/transformations/:id/methodology-migrations/:migrationId`: plan items grouped by kind (mappings, new required fields, invalidated calculations, required re-approvals, removed elements, unchanged history), inputs for new required fields, preview, submit, decide (business-approval note; rationale), execute, withdraw, all with If-Match. |
| `apps/web/src/pages/methodology-migrations/ConfigPinsPage.tsx` | `/transformations/:id/config-pins`: `listTransformationConfigPins` (unpinned = "Not pinned (shipped version 1)"), `listConfigPinHistory`. |
| `apps/web/src/i18n/{en,ar}/studio.json` | New `studio` namespace (identical key sets; Arabic glossary terms, "تحوّل" with shadda). |
| `apps/web/src/pages/studio/studio.test.tsx` | 21 unit tests (helpers, Studio home en/ar, version page, element edit, rollback, scoring defaults, source coverage en/ar). |
| `apps/web/src/pages/methodology-migrations/migrations.test.tsx` | 8 unit tests (migration page en/ar, preview/submit If-Match, self-approval 403, pin_moved 409, planning, pins). |
| `apps/web/e2e/p5-studio.spec.ts` | 2 Playwright tests × 2 projects (en, ar) against the real stack (§3, §4 row 9). (1) The T06 scoring-defaults draft → editor → preview/compatibility → review by TO → publish path. (2) Scoring defaults, source coverage, migrations, and the auditor's read-only views. The ADM_METHOD grant to `dev.nobody` is revoked in `finally`. |

Existing files edited (append, or the placeholder swap the shell's protocol prescribes):

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | Appended the 11 lazy page imports and 11 routes (marked T-DG5-FE-B). Removed FE-B's 8 rows from `P5_PLANNED_ROUTES` and filtered FE-B's 3 `P5_SUBPAGES` out of it, as the file's own comment prescribes ("its owning task replaces the element … and removes its row here"). No other line changed. |
| `apps/web/src/app/p5-shell.test.tsx` (FE-A's test) | Needed with the swap above. The "placeholder" feature list no longer contains `studio`, `methodologyMigrations`, `sourceCoverage`; it now asserts that no FE-B row is left in `P5_PLANNED_ROUTES` and that the three admin paths are routed. Every other assertion is unchanged; the "Administration shows the Studio entries" test still passes against the real Studio page. |
| `apps/web/src/i18n/index.ts` | Appended the `studio` namespace imports and the two catalogue entries. |
| `apps/web/src/i18n/{en,ar}/admin.json` | `admin.plannedSections` corrected (F-DG4-160; D-143 flagged it for FE-B), see §6. |

Evidence: `docs/delivery/handbacks/DG5/T-DG5-FE-B-evidence/` (check logs, `summary.log`, `screenshots/{en,ar}/*.png`).

## 2. Behaviour delivered, per requirement row (acceptance text quoted)

**REQ-PB-093:** *"A06;A07: an admin changes the default Feasibility rubric text and the default weights to 30/20/20/15/15 in the UI and publishes without a code change; a transformation created afterwards starts with the new default; an existing transformation keeps its weight set and rubric version; publishing defaults that total 95% is rejected"*
- UI: in a scoring_defaults draft, the admin edits the five weights and the Feasibility 1–5 descriptors, saves, then publishes from the version page (same pipeline). Weights are decimal strings; the total is computed exactly. 95.00 is flagged before publishing, and the server's 422 `config_version.weights_total` is shown translated in the page's one alert.
- Unit tested: 30/20/20/15/15 → 100.00 with the PUT body and If-Match; 95.00 flagged; null descriptors.
- The instantiation effect (new vs existing transformations) is KBE-A's backend behaviour, already tested there; this task makes it reachable in the UI.
- Exercised end-to-end in Playwright (EN and AR): a scoring-defaults draft, the Feasibility score-1 descriptor edited in the UI with the weights at 100.00, preview and compatibility checks, the TO review, then publish (the version becomes "Published (current)"). The 95 % refusal is unit-tested only.

**REQ-S02-001:** *"A01;A06: the report shows 2 modes, 6 phases, 6 gates, 16 templates, 10 TOM dimensions, 5 forums, 6 lifecycle steps, 3 launch windows, 1 roaming example and 25 questions; deleting a template in a draft methodology makes the check fail and blocks publish"*
- Administration > Source coverage shows the ten sets with expected and present counts. E2e asserts 10 rows and 6/16/25 on the real seed; the unit test asserts all ten counts in order.
- The check runs from a draft's version page (or the coverage page with a draft selected). A failing run shows **Fail** and publish is refused with 422 `config_version.source_incomplete`, translated.
- "Remove" on a template is available in the draft editor. The fail-on-delete outcome is BE-B2's server logic, not re-tested in e2e here.

**REQ-S06-004:** *"A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish …"*
- Delivered here: approver routes (gate `defaultApproverRoleCode`, `approver_route.approverRoleCode`), reminders and escalations (offset, recipient role), mandatory flags, labels, help and methodology text in en/ar, elements added and removed, all in a draft through the UI.
- **The T13 field and its validation rule belong to the form builder (FE-C, slice B, ADR-0041), not to this task.** Their acceptance completes with FE-C (§7).

**REQ-S06-006:** *"A06;A12: renaming the label of G3 succeeds; changing its stable ID, deleting a TOM dimension or configuring ADM as an automatic approver is rejected"*
- The G3 label edit is a PUT with If-Match (unit tested). Stable keys are never editable in the UI.
- Removing a protected element, or entering `ADM_METHOD` as approver, shows the server refusal translated (`config_version.source_element_protected`, `config_version.admin_approver_forbidden`; the latter is unit tested in the dialog).

**REQ-S06-007:** *"A06: publish without required review is rejected; editing a published version returns 409; the diff lists the added field"*
- The full path draft → preview/test → compatibility → review (TO) → publish runs in Playwright in EN and AR on a **scoring_defaults** version. The same path on a **methodology** version (with the source-coverage check) also passed in Playwright (run 2, §3). It is not kept in the spec because publishing a methodology version breaks the later specs through a backend defect (§5 item 5).
- Publish without a review shows 422 `config_version.review_required` (unit tested; exactly one alert).
- A published version offers no edit action and carries the "cannot be changed" banner. A 409 `config_version.not_editable` from any write is shown with "nothing was saved; the latest version is loaded".
- The diff lists added, removed and changed elements side by side (e2e asserts the edited element). The added *T13 field* depends on FE-C's provider.

**REQ-S06-008:** *"A06;A07: after publishing v2, an existing transformation still renders v1 forms; the migration preview lists the new required field and a required G2 reapproval; historical records remain unchanged"*
- The pins page shows each transformation's pinned version; publishing does not move it.
- The migration page lists "New required fields" and "Required gate re-approvals" (G2), and labels "History kept unchanged" (unit tested en/ar). The re-approvals list is on the transformation's migrations page.
- Byte-identical history is BE-C's server guarantee.

**REQ-S06-009:** *"A07: after rollback, records created under the rolled-back version remain retrievable and the audit trail shows the rollback"*
- "Roll back to this version" on an earlier published version needs a reason (3–4000 characters) and creates a rollback draft that goes through the same pipeline (unit tested: required reason, If-Match, navigation).
- Retention and audit are BE-B3's.

**REQ-S06-010:** *"A06;A12: a methodology admin can publish a form change but receives 403 approving a funding reallocation; a KPI owner can update assigned KPI actuals but not Studio"*
- The UI shows each action only to the permission that can perform it: configure → edit/draft, publish → publish/rollback, `methodology.review` → decide, `config_review_policy.configure` → policies, `methodology_migration.*` → plan/approve/execute. AUD and other readers get read-only notes (e2e: the auditor sees no New draft and no policy edit).
- The server's 403 is shown translated. The funding-reallocation 403 is DG4 server behaviour.

**REQ-S12-018:** *"A06;A07: proposing a formula change lists affected benefits and creates a review task"*
- Revision proposals list each proposal's validation, impact lines (affected benefits) and "Review tasks created" count.
- The `config_review` work item opens the version page, where a "Open the review" link leads to the decision page.

**REQ-S16-012:** entity-group API test, BE-C's. No UI part.

## 3. Checks actually run

Machine: shared container, with three other W10 tasks running at the same time (D-004), so durations are long. Node 24.21.0, offline. Ports 24150–24199 only.

See §4 for the final table. Intermediate runs during development:

1. `npx tsc --noEmit -p apps/web` → exit 0; `npx eslint <my files>` → exit 0.
2. `npx vitest run src/app/p5-shell.test.tsx src/i18n` → 5 files, 72/72 passed (key parity, Arabic-is-Arabic, literal-key and glossary tests included).
3. `npx vitest run src/pages/studio src/pages/methodology-migrations` → 29/29 passed (after fixing the defects below).
4. `with-stack.sh npx playwright test apps/web/e2e/p5-studio.spec.ts` (E2E_PG_PORT=24150, E2E_API_PORT=24151, MTH_PORT_POOL=24152-24199):
   - First run: **exit 1, 1 passed / 3 failed.** Two real findings, both fixed:
     - (a) the coverage page offered "Run" on a published version, and the API answered 409 `config_version.not_editable`; Run is now offered for open drafts only;
     - (b) the AR journey copied the version the EN journey had just published, so the same help text produced no diff; the e2e text now carries the language and a timestamp.
   - Second run: **exit 0, 4 passed (1.3 m).**

5. After the handback was first written, the queued full web suite started (12:29Z) and was **killed by the session's background time limit** before finishing (`e2e.log`, partial, about 200 of 378 tests reported, **not a result**). The failures it had reported came from this spec:
   - (c) the ADM_METHOD grant to `dev.nobody` was never revoked, so `journeys.spec.ts` "a user without roles sees no Administration" failed in AR. **Fixed:** the grant is revoked in `finally`.
   - (d) the methodology version the spec published left later-created transformations with **empty DG2 catalogues** (`p2-blank-text`, `p2-journeys`: `diagnosticWorkstreams` empty). The cause is backend (§5 item 5). **Mitigated in the spec:** the journey now publishes a scoring_defaults version instead (one rubric descriptor; weights unchanged).
   - Run 3 (`e2e-p5-studio-run3-with-neighbours.log`; journeys + p2-journeys + p5-studio, EN + AR): exit 1, 44 passed / 2 failed. The neighbours passed; my journey failed because the scoring-defaults editor remounted after saving (keyed by record version) and lost its "Draft saved" notice. **Fixed:** keyed by version id, and unsaved edits are kept across refetches.
   - Run 4 (`e2e-p5-studio-run4-with-neighbours.log`, same three specs, after the fix and a web rebuild): **exit 0, 46 passed (6.5 m)**. The screenshots in `screenshots/{en,ar}` are from this run.

Defects found and fixed by my own tests before the e2e:
- the element put sent `submissionEnabled: false` for an untouched checkbox, which would have silently disabled a gate's submission; flags are now tri-state ("Choose…" keeps the shipped value);
- a jsdom accessible-name quirk on row buttons; they now carry an explicit `aria-label`.

## 4. Final acceptance checks (same tree as handed back)

Logs are in `T-DG5-FE-B-evidence/<name>.log`; start and end times are in `summary.log`.

| # | Command | Environment | Exit | Result |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | — | **0** | all packages |
| 2 | `pnpm -r build` | — | **0** | |
| 3 | `pnpm lint` | — | **0** | |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | — | **0** | "All matched files use Prettier code style!" |
| 5 | `pnpm openapi:lint` | — | **0** | contract unchanged |
| 6 | `pnpm test` | locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **1** | Three Vitest invocations. unit-node **1942/1943**: 1 failed, plus 1 unhandled "Timeout calling onTaskUpdate". unit-web **1429/1429** (74 files). Third invocation **259 passed, 2 skipped** (3 files). |
| 7 | `pnpm test` | `LANG=LC_ALL=C.UTF-8` | **1** | unit-node **1942/1943** (same 1 failure); unit-web **1429/1429**; third **259 passed, 2 skipped** |
| 6b | `npx vitest run --project unit-node apps/api/src/architecture.test.ts` | locale unset, alone | **0** | 139/139; the timed-out test passes in 26.8 s alone (load average 19) |
| 8 | `QA_PG_PORT=24160 MTH_PORT_POOL=24161-24175 tests/qa/support/with-pg.sh pnpm test:integration` | — | **0** | **243 files, 2342/2342 passed** (11:56:07Z–12:29:16Z, `integration.log`); it finished after the handback was first written. Pinned-count change: none. |
| 9 | `E2E_PG_PORT=24150 E2E_API_PORT=24151 MTH_PORT_POOL=24176-24199 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | full web suite, EN + AR | **NOT COMPLETED** | Killed by the background time limit after it had started at 12:29Z; partial log, not a result (§3 item 5). Instead, run 4 (`journeys.spec.ts`, `p2-journeys.spec.ts`, `p5-studio.spec.ts`; EN + AR; ports 24150/24151, pool 24152–24199): **exit 0, 46/46 passed**. Full-suite counts: **not available**. |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` | — | **0** | `PASS gate DG4 (historical)` at 12:17Z (`validate-historical-DG4-end.log`) |

**The one unit failure (rows 6 and 7), disclosed.**
- The test is `apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages`. It failed with "Test timed out in 30000ms" in both runs (37.4 s and 34.1 s). It is not an assertion failure.
- The test walks and lints every API module file, normally in about 1–1.5 s (its own comment, F-DG2-143). This task changed **no** file under `apps/api` or `packages/`.
- Run alone on the same tree, it **passes** (row 6b, exit 0, 139/139), but takes 26.8 s even alone. The container's load average was 17–19, with the four W10 tasks running at the same time (D-004).
- The unhandled "Timeout calling onTaskUpdate" in the locale-unset run is Vitest's worker RPC timing out under the same load.
- I did not raise any timeout (the test is not mine, and F-DG4-143…148 forbid hiding load issues). **Acceptance item 2 is therefore not met as literally stated on this machine.** The orchestrator should re-run `pnpm test` on the integrated tree when the machine is not shared.
- Every test of this task's own files passed in both locales: the web invocation's 1429 includes the 29 FE-B tests and the updated `p5-shell.test.tsx`.
- **Pinned-count changes:** none (no contract change).


## 5. Operations routed, contract and dependency needs

- **Operations routed (delta to a pending list):** none. FE-B is a web task and has no `p5-pending-fe-b.ts` or `p5-exercises-fe-b.ts`. All 38 slice A operations were already routed and exercised by BE-A…BE-C and KBE-A (their pending lists are empty). No pinned-count change.
- **No new dependency.** No contract or schema change. No new problem code: every code shown comes from `problems.json` (FE-A).
- **Requests for the orchestrator / owners:**
  1. `pages/my-work/p4ui.tsx` `P4FormDialog` accepts only POST/PATCH. I added `pages/studio/StudioFormDialog.tsx` (same contract plus PUT) rather than edit a file I don't own. Widening `P4FormDialog`'s `method` to include PUT would let FE-C/FE-D reuse it; FE-B could then drop its copy.
  2. `nav.p5.{studioVersion,studioReview,scoringDefaults,reviewPolicies,revisionProposals,methodologyMigration,configPins}` and `nav.p5.{studio,methodologyMigrations,sourceCoverage}.summary` stay in `nav.json` (FE-A's). The titles and summaries of the three nav features are still used as page headings. The seven record-route placeholder texts are now unused and can be removed by FE-A; I did not touch them.
  3. `pages/admin/AdminHomePage.tsx` (not FE-B's) still renders the corrected `admin.plannedSections` text under a "Planned" chip (§6). Its owner may want to retitle the card or add a Studio card.
  4. ADR-0039: there is no `getConfigReview` operation, so the review page finds the review in `listConfigReviews` of its version (a 404-like "not found" state when absent).

5. **Backend defect found by the e2e (for the orchestrator to route to slice A's owner; proposed severity High).**
   - **What:** publishing any methodology version (even a help-text-only change) leaves every transformation created afterwards with **empty DG2 catalogues**.
   - **Cause:** `apps/api/src/modules/methodology/repository.ts` `loadMethodologyCatalogue` selects `diagnostic_dimension`, `diagnostic_workstream`, `tom_dimension`, `charter_scope_check_definition` and `good_outcome_criterion` with `methodology_version_id = <pinned version>`, and filters gate definitions the same way. Those catalogue rows exist only for the seeded v1. A new transformation is pinned to the newest published methodology version, so all of these come back empty.
   - **Reproduction:** run the previous version of `p5-studio.spec.ts`, which published a methodology version in the EN project, followed by `p2-blank-text.spec.ts` / `p2-journeys.spec.ts` in the AR project. `GET /transformations/{id}/methodology` returns `diagnosticWorkstreams: []` (`methodology.diagnosticWorkstreams[0]` is undefined), and the Diagnose region shows 0 of 6 workstreams (partial `e2e.log`).
   - **Expected:** the catalogue rows of a later version are the stable identities of v1, overridden by the version's `methodology_element` rows (ADR-0039 §3, D-142 Q1).
   - **Effect:** it breaks REQ-S06-007/S06-008 once any methodology version is published, and it limits the Studio's real use.
   - **Not fixed by me:** the file is not FE-B's (`methodology/**` belongs to BE-A…BE-C).

## 6. User-facing texts made untrue, and what I did

- `admin.plannedSections` (en/ar) said "Methodology, forms, workflows, automation and branding settings are planned for later releases." The methodology part is untrue once these screens ship (D-143 noted it "stays true until FE-B ships the Studio screens"). **Corrected in both languages:** the Playbook Studio is available in this release; form, workflow, automation and branding settings are not available yet (true while FE-C/FE-D/FE-G's screens are placeholders, and each of those tasks updates it when it ships). The card's "Planned" chip is in `AdminHomePage.tsx`, see §5 item 3.
- The P5 placeholder texts `nav.p5.notAvailable*` no longer apply to FE-B's routes, because those routes no longer render the placeholder. No other en/ar string calls the Studio, migrations or source coverage planned (searched in `i18n/en/*.json`).

## 7. What remains (not done) — stated plainly

1. REQ-S06-004's T13 field and its validation rule: FE-C's form builder (slice B). The "diff lists the added field" part of REQ-S06-007 completes with it.
2. The preview sandbox sends `samples: []`. No sample-input editor (record/formula/submission samples) is built, so the preview check runs without samples.
3. Element attributes not editable in the UI: `dashboard`/`report_layout` `sections`, `approverRoleCodes` (multi-approver arrays and `mode`), `mandatory_artifact`/`checklist_item` `phaseCode`/`gateCode`, `gate.conditionalApprovalEnabled`. These are kept as they are on save and editable only by API.
4. Migration inputs for new required fields are plain text. They are not rendered by the field's type, which needs FE-C's field-type controls.
5. Check findings and plan-item `detail` are rendered generically (short text or JSON) and are not translated per finding code. Affected-record `unknownReason` is shown as the API's reason code in the Unknown chip's hint.
6. Playwright covers the scoring-defaults draft → review → publish path and read-only views. It does **not** cover a methodology publish (kept out of the spec, §5 item 5), a rollback, or a migration plan → approve → execute against the real API; those are covered by unit tests with stubbed responses only.
7. **Checks not completed (acceptance items 2–3, and the web e2e suite).**
   - `pnpm test`: 1 load timeout in an API test this task did not touch (§4); everything else passed in both locales.
   - The integration suite was interrupted by the time limit (no failure seen in the 744 tests reported).
   - The full web e2e suite did not complete (killed; partial `e2e.log`). The FE-B spec with the two neighbour specs it had broken passed 46/46 (run 4).
   - The check runner (`bash $TMPDIR/checks.sh`, a background task of this session) could not be stopped from the sandbox. `e2e.log` (the full web suite started at 12:29:16Z after the handback) in the evidence folder may be **partial or written after this handback** and must not be read as results.
   - The orchestrator should run `pnpm test` (both locales), `with-pg.sh pnpm test:integration` and the full `with-stack.sh npx playwright test apps/web/e2e` on the integrated tree.
8. The e2e journey publishes a new T06 scoring-defaults version in each of the EN and AR projects: one rubric descriptor changes and the weights stay 25/25/20/15/15. Transformations created by later specs start from it; no existing spec asserts rubric descriptor text. The full-suite run the orchestrator makes is the check of that (item 7).
