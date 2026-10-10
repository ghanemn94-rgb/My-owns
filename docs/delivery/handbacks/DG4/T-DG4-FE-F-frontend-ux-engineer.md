# Handback T-DG4-FE-F (frontend-ux-engineer): G5/G6 views, gate reviews and exceptions, the Modular G3 waiver, closure and transition decisions

- **Stage:** DG4 (P4). **Task:** T-DG4-FE-F, the first half of FE-F: p4-work-split §H H.6 and §F+G FG.8.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-F.md` (sha256 `ed8ab216…56642ee2808`, verified at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-F-frontend-ux-engineer-20261010T055035Z-7f31bf30","session_id":"7f31bf30-c5d5-4f9c-b3d7-fda2d017fa79"}`.
- **Base:** branch `dg4/fe-f`, `HEAD` `8db6679`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** `date -u` at start `Sat Oct 10 05:50:47 UTC 2026`; at end see §8.
- **Two gate systems:** G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7 records. Every gate decision, exception, waiver and transition decision in the tests and e2e journeys is a synthetic demo decision by a synthetic person and approves nothing real. G6 never implies DG7, and the screens never show "DG0–DG7" (asserted in the unit tests).

## 0. Items for the orchestrator (read first)

1. **Files outside the pure `pages/gates/**` / `pages/closure/**` ownership.** Each edit is listed here so the merge can be checked.
   - `pages/dispensations/DispensationsPage.tsx` (+31 lines). The assignment mandates the Modular-waiver changes on the DG3 dispensation form. Three edits: the Modular kind hint, the "Waiver of the missing baseline and outcome links" label, and the matching decide-dialog text. A new exported pure helper, `isModularLinksWaiver`, supports them. Nothing else on that page changed, and its DG3 tests (`dispensations.test.tsx`, 7 tests per language) pass unchanged.
   - `apps/web/e2e/p4-governance.spec.ts` (FE-A's e2e spec, 2 lines). Its step "… Transform readiness" also asserted that `/transformations/:id/closure` shows the "being built" placeholder. It now opens `/change-requests`, which is still planned. Nothing else changed. The full e2e run showed that failure in both languages (§3).
   - `pages/my-work/my-work.test.tsx` (FE-A's test, 3 lines). Its "a planned P4 route shows the honest 'being built' state" test used `/transformations/:id/closure` as the example of an unbuilt route. That route is now built, so the test points at `/transformations/:id/change-requests` instead (also FE-F's, still planned for FE-F2). Nothing else changed.
   - Shared files, append-only:
     - `app/router.tsx`: one route line. I also replaced my own `closure` entry in `P4_PLANNED_ROUTES` with a comment; no other task's entry was touched.
     - `components/Workspace.tsx`: one `WORKSPACE_TABS` line, the `closure` tab.
     - `i18n/index.ts`: two imports and one `closureP4` line per locale.
   - `en|ar/gates.json`: keys appended inside existing objects only. The only removed line is the trailing-comma change on `missingItems.g4__capacity_conflict`.
2. **Accessibility fix on the DG2 readiness table** (`GateDetailPage.tsx`, `CriteriaTable`). axe reported `scrollable-region-focusable` (serious) at 390 px on the G5/G6 pages, where the table holds no link. The table's scroll container is now a focusable region (`tabIndex=0`, `role="region"`) with its own name ("Table of required outputs (scrollable)"). This adds three attributes to the G1–G4 DOM and changes no visible text or behaviour. The DG2/DG3 gate tests pass.
3. **No `problems.json` key added.** Every ADR-0034 §12, ADR-0035 §11 and ADR-0038 B4 code I show was already placed by FE-R1 (checked one by one, both locales).
4. **No FE pending list exists**, so there was nothing to move (§5).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/gates/p4api.ts` (new) | Paths and read hooks of the slice H gate operations: review table, reviews, exceptions, scale scope. Defensive readers of the frozen snapshot members (`criteria[].exception`, `modularLinks`). |
| `apps/web/src/pages/gates/GateP4.tsx` (new) | Gate exceptions (list, request, decide, withdraw, revoke) and `ExceptionStatus` (covers until … / expired). The nine-field review table and review dialog. The frozen exception lines and Modular-links block of a submission. The G5 scale-scope view and editor (`scaleScopeBody`). The G5/G6 refusal helpers. `ConfirmActionDialog` for bodiless versioned actions. |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | Wires the above in: exceptions section (every gate); scale scope on G5; the scope editor in the decision dialog (G5 + approved only); frozen lines and review table in the submission detail; G5/G6 refusal lines by translated label; Modular missing-links items in the refusal; refresh now covers P2 and P4 keys; readiness table region (§0 item 2) |
| `apps/web/src/pages/closure/api.ts` (new) | Paths and hooks for the status models, closure records, transition decisions and benefits |
| `apps/web/src/pages/closure/ClosurePage.tsx` (new) | Closure and transition decisions screen (§2) |
| `apps/web/src/pages/dispensations/DispensationsPage.tsx` | Modular G3 waiver labels and hint (§0 item 1) |
| `apps/web/src/app/router.tsx`, `components/Workspace.tsx`, `i18n/index.ts` | Route, tab and namespace registration (append-only) |
| `apps/web/src/i18n/en/gates.json`, `ar/gates.json` | P4 gate keys (§6) |
| `apps/web/src/i18n/en/closureP4.json`, `ar/closureP4.json` (new) | Closure namespace (§6) |
| `apps/web/src/pages/gates/g5-g6.test.tsx` (new) | 17 unit tests (en + ar) |
| `apps/web/src/pages/closure/closure.test.tsx` (new) | 11 unit tests (en + ar) |
| `apps/web/src/pages/dispensations/modular-waiver.test.tsx` (new) | 7 unit tests (en + ar) |
| `apps/web/src/pages/my-work/my-work.test.tsx` | Planned-route example retargeted (§0 item 1) |
| `apps/web/e2e/p4-gates-closure.spec.ts` (new) | 9 real-stack journeys per language (§3) |
| `docs/delivery/handbacks/DG4/T-DG4-FE-F-*` | This handback and its evidence |

## 2. Behaviour delivered, per requirement row (acceptance quoted)

The backend halves of these rows are BE-J, BE-K, BE-K2 and BE-R3 (merged). What follows is the screen half: what a user can now see and do, wired to the real API.

### REQ-PB-015: "A08: submission with missing mandatory evidence is rejected; approval by a non-approver returns 403; approval of a stale submission version is rejected"

- The G5 and G6 pages show the live criteria, each missing item translated from its `g5.*`/`g6.*` code (25 keys, ADR-0035 A3) with only the record code taken from the server text (`R-01`, `PA-02`). The English sentence is never shown in Arabic (unit test).
- A refused G5/G6 submission lists each incomplete criterion by its translated label (`/criteria/g5.risk_closure` → "Risk closure" / «إغلاق المخاطر»).
- The DG2 403 and 409 decision refusals are unchanged and still translated.

### REQ-PB-020: "… G5 submission with an open High-impact risk and no disposition is rejected listing 'Risk closure' …"

- The refusal line names "Risk closure" in the shown language (unit test `a refused G5 submission lists 'Risk closure'…`).
- The live item `g5.risk_open` reads "Risk closure: a High-impact risk is neither closed nor dispositioned. — R-01".

### REQ-PB-021 and REQ-S04-008: "G6 submission without an accepted BAU handover is rejected listing 'Ownership transfer'"

- e2e step 5: the G6 page lists Ownership transfer as incomplete with `g6.performance_area_none` translated. Submission is not offered (the DG2 disabled button and its reason).
- The screens never mention DG0–DG7.

### REQ-S04-007: "… an approval records the scale scope and later scaling outside it is blocked"

- Choosing "Approve" on G5 shows the scale-scope editor: items are (initiative, business unit) pairs, and conditions take a text, an owner and a due date.
- Nothing is sent while an item is incomplete or a pair is duplicated ("Each scope item needs an initiative and a business unit."). Otherwise `scaleScope` is sent with the decision.
- After approval the "Approved scale scope" section lists the items and conditions. Before G5 it says scaling is not allowed yet.
- e2e step 4 runs this on the real API. The scale-transition screen is not part of this task (§7).

### REQ-S04-009: "A08: a gate decision without rationale is rejected by the API; each criterion row persists all nine fields"

- Each submission's detail has the review table with the nine M0124 columns: criterion, required evidence, completeness, reviewer, finding, open condition, risk, decision (recommendation), rationale.
- A row with no review reads **"Not reviewed"** in its six review fields, never "Meets" (unit test and e2e step 3).
- A covering exception is marked on the completeness cell.
- A reviewer with `gate.review` who is not the submitter records a review. The open condition is required with "meets with conditions". The submitter is told they cannot review.

### REQ-S04-010: "A08: all seven statuses exist; a direct Draft -> Approved transition is rejected; each transition writes an audit event"

- The first review moves the gate to **Under review**, shown in the review table (`gateStatus`) and in the gate status chip (e2e step 3).

### REQ-S04-012: "A08: the gate page lists missing items; submission with one missing mandatory item returns 422 listing it; with a valid exception it succeeds and the snapshot records the exception"

- Every gate page lists its exceptions: criterion, status, reason, scope, compensating action and owner, expiry, approver (and on-behalf-of), decision note and revoke reason.
- e2e steps 1–2:
  - the Lead requests an exception in the UI;
  - the Sponsor (the configured approver) accepts it in the UI and it reads "Covers the criterion until …";
  - the Lead submits G5 with the remaining gaps covered;
  - the submission detail shows **"Exceptions recorded in this submission"** with the frozen reason, scope, compensating action and owner, expiry and approver, read from the snapshot.
- The requester is never offered the decision.

### REQ-S04-013: "A08: a waiver without expiry or compensating action is rejected; after expiry the covered evidence item is again reported missing"

- The request form requires all five fields, so nothing is sent without an expiry (e2e step 1, `aria-invalid` on Expires on).
- An accepted exception whose `covering` is false reads **"Expired on {date}: no longer covers the criterion"**, never "covers" (unit test).
- Revoke takes a reason, and the reason is shown (e2e step 4).
- The decision-time `gate.exception_expired` and `gate.exception_revoked` refusals are translated through `problems.*`.

### REQ-PB-005 and REQ-S03-005: Modular G3 waiver (D-110; ADR-0021 W1–W7; ADR-0038 B1). "… G3 submission is rejected by the API until they are supplied or an authorized waiver exists"

- **The dispensation form:**
  - on a Modular transformation it offers the waiver, with the hint that it applies only to G3, for the whole transformation, and covers only the missing links;
  - a G3 waiver without an initiative is labelled "Waiver of the missing baseline and outcome links";
  - every other Modular waiver (G2, or G3 with an initiative) still reaches the server and shows the DG3 refusal `dispensation.waiver_requires_end_to_end`, translated (e2e step 6, unit test).
- **The G3 submission** under an accepted waiver shows its `modularLinks` items, each translated (`baseline_missing`, `outcome_link_missing`), and the waiver used: reason, expiry, approver, and a link to the dispensations page (e2e step 6).
- **A refused G3 submission** (`gate.modular_links_missing`) lists the two items, each translated (unit test).
- **Approval refusals:** after the waiver is revoked, approving the frozen submission shows `gate.modular_waiver_revoked` translated (e2e step 6). `gate.modular_waiver_expired` uses the same path through `problems.*`.
- The DG3 dispensation screens are otherwise unchanged (§0 item 1).

### REQ-S03-003: "A11: setting delivery to Complete leaves adoption, validated value and closure unchanged; the API rejects a closure request while validated value is pending unless a transition decision exists"

- **The closure tab** (`/transformations/:id/closure`) shows the four statuses side by side, each exactly as the server returns it:
  - the transformation: delivery, validated value, BAU acceptance and closure, as cards, plus the label;
  - per initiative: delivery, adoption (with its source: owner or below-trajectory indicator), validated value, closure and the label.
- Nothing is derived on the client.
- **Closure actions with their refusals:**
  - Mark delivery complete (WL/TL, launched only);
  - Set adoption status (BO);
  - Close initiative and Close transformation (TL);
  - every ADR-0034 §12 refusal is shown translated. e2e step 7 closes on the real API and shows the `closure.*` refusal translated; the unit tests cover `closure.value_validation_pending` and `closure.g6_not_approved`.
- Close sends no `If-Match`, as the contract says (asserted).

### REQ-PB-009: "… an initiative with delivery=Complete and no validated benefit cannot be closed (API 422 invalid-transition); UI shows 'Delivered — value validation pending'"

- The label is shown exactly as "Delivered — value validation pending" in English, translated in Arabic with a "Provisional Arabic translation of the status labels" note.
- Closing shows the translated `closure.value_validation_pending`.
- **Proven with stubbed responses (unit test), not on the real stack** (§7 item 2).

### REQ-S11-006: "A11: with all initiatives complete and value pending, the transformation shows 'Delivery complete - value validation pending', not successful"

- The transformation banner shows the server label translated; in English it is exactly the ADR text.
- No label or screen text contains "success" or "ناجح". The unit test asserts this over the whole page, and e2e step 7 asserts it on the real stack.
- A unit test checks that every ADR-0034 §2 label has an English text equal to it.
- Same limitation as REQ-PB-009: the "all initiatives complete" state is proven with stubbed responses.

### REQ-S11-007: "A11: after the transition decision, the benefit's forecast is still shown as forecast and monitoring tasks appear for the residual owner"

- **Transition decisions:** create (benefit, residual owner, rationale, expected realization end, frequency, interval, first monitoring date); edit while draft; submit; withdraw.
- **Status** shows the approval's round and status, and links to the business approval.
- **Round 2 after a return** reads "Returned for changes" and offers "Submit again (round 2)" after an edit.
- **Requester-only** (ADR-0026 E3): another holder of `transition_decision.propose` is told that only the requester can submit again or withdraw. If they try, the server's 403 `approval.not_requester` is shown translated.
- **e2e step 8**, on the real API:
  - BO drafts and submits;
  - the Sponsor returns it;
  - BO edits and submits round 2 (`data-round="2"`);
  - a second BO's withdrawal is refused with `approval.not_requester`;
  - the requester withdraws it.
- The screen states "Forecast stays forecast", and the decision is labelled a business approval.
- The monitoring tasks and the forecast series are the backend's (BE-J) and are not re-proven here.

## 3. Checks actually run (worktree `/home/user/wt/dg4-fe-f`, Node 24.21.0, offline; ports 25550–25599)

Logs are under `docs/delivery/handbacks/DG4/T-DG4-FE-F-evidence/`.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-start.log`) |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` (the web package was rebuilt after each later UI edit; each rebuild exited 0) |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`, run again after this handback was written) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 649 operations` (`openapi-lint.log`) |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 135 files, **2582 passed**; then 3 files, **259 passed / 2 skipped** (`unit-locale-unset.log`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 135 files, **2582 passed**; then 3 files, **259 passed / 2 skipped** (`unit-c-utf8.log`) |
| `QA_PG_PORT=25580 MTH_PORT_POOL=25581-25599 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 184 files, **1739/1739** (`integration.log`). No pinned count changed: this task touches no API, schema or contract file. |
| e2e, new spec alone (`with-stack.sh npx playwright test apps/web/e2e/p4-gates-closure.spec.ts --workers=1`, final run) | 0 | **18 passed** (9 per language), axe 0 serious/critical (`e2e-new-spec-final.log`) |
| e2e, full product suite `E2E_PG_PORT=25563 E2E_API_PORT=25564 MTH_PORT_POOL=25565-25579 with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **269 passed, 4 failed, 5 did not run** (278; 31.6 min). Per spec and project in `e2e-full-per-spec.txt`; log `e2e-full.log`. All four failures are analysed below, and two were caused by this task and are fixed. Re-run: §8. |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |

The 2582 include 35 new tests: 17 in `g5-g6.test.tsx`, 11 in `closure.test.tsx` and 7 in `modular-waiver.test.tsx`. I did not run the suite at the base commit, so I state no base count or delta.

**Non-zero exits along the way, all disclosed** (every development log of the new spec is kept as `e2e-new-spec-dev-run{1..11}.log`):

1. **Targeted unit runs (exit 1)**, all fixed before the final runs:
   - `glossary.test.ts`: my Arabic wrote «تحول» without the glossary's shadda, and I used «مرحلي» for Modular. Both are now the glossary terms.
   - `my-work.test.tsx`: §0 item 1.
   - My own new tests, while I wrote them: field selectors; an empty mocked list made the review table read `snapshotSha256` of undefined, so it is now guarded; and my intro text contained the word "successful", now reworded.
   - The first full unit run (locale unset, exit 1, 2 failed in `p2.test.tsx`): my new table region reused the section's accessible name "Readiness (live)". Each table region now has its own name, and the re-run exited 0.
2. **e2e development runs 1–11 of the new spec (exit 1 each).** Each one exposed a real defect or a setup error, and each was fixed:
   - axe `scrollable-region-focusable` on my tables, then on the DG2 readiness table at 390 px (§0 item 2);
   - a duplicated `data-gate-status` selector;
   - the Sponsor could not choose a business unit (§5 item 1);
   - after the G5 approval the scale scope was not re-read, because the gate page refreshed only P2 keys; it now refreshes P2 and P4;
   - test setup errors: the benefit fields, the SP role mapping (the UI correctly showed the translated routing error), the approval outcome value, `If-Match` on the approval decision, and the CSP refusing `addStyleTag` (now FE-E's `style.fontSize` method).
   No timeout was raised, and no step hit the 30 s timeout except run 3 step 4, a `selectOption` that waited for a missing option: the business-unit defect above.
3. **The full e2e run** (exit 1; 269 passed, 4 failed, 5 did not run because the specs are serial):
   - **`p4-governance.spec.ts` "… Transform readiness", en and ar: caused by this task.** The spec asserted that `/closure` is still a planned route. Fixed in that spec (§0 item 1).
   - **`journeys.spec.ts` "administration screens", ar (2 later tests did not run): caused by this task's test data.** The users list is alphabetical, and my spec's five synthetic users per language ("Synthetic Sponsor", "… Business Owner", "… Auditor" …) sorted before the seed "Synthetic Transformation Lead". That user was pushed off the first page that `journeys.spec.ts` reads in the ar project, after my en users existed. My users now have display names that sort after it ("Synthetic Value Sponsor", "Synthetic Value Owner", "Synthetic Value Owner Second", "Synthetic Viewer Auditor", "Synthetic Waiver Sponsor"). No product code changed.
   - **`p2-journeys.spec.ts` "Define → G2 … G2 is decided", en (3 later tests did not run): a 30 s timeout.** The G2 submit dialog was still "Saving…" when the test timed out at 33.5 s (screenshot: the submission note is filled and the buttons are disabled). The run was under load: three other agents, plus my integration and unit runs. My change does touch this path: after a gate submission the page now also refreshes the P4 gate keys, which adds the exceptions list and scale-scope reads. As the assignment requires, the spec was re-run (§8). The ar project of the same run passed this test.
4. **The first full e2e attempt was killed.** I started it with a shell `&`, and the job died when that shell returned. Its log stops at migration `0017` and is kept as `e2e-full-attempt1-killed.log`. It is **not** cited as a result. The full suite was then re-run as a managed background job (§8).

Disk was checked before the full runs (`disk-before-full-runs.txt`: 18–19 GB free).

## 4. Screenshots and interaction checks (both languages)

`T-DG4-FE-F-evidence/screenshots/{en,ar}/`. Every step below also ran axe with 0 serious or critical issues.

- `p4-gates-01-g5-missing`: G5 live criteria with missing items.
- `p4-gates-02-exception-request`: the request form with all five fields.
- `p4-gates-03-exception-accepted`: the exception covers the criterion until its expiry.
- `p4-gates-04-submitted-with-exceptions`: the exception lines frozen into the submission.
- `p4-gates-05-review-table-under-review`: the nine-field review table, Not reviewed rows, Under review.
- `p4-gates-06-g5-decision-scope`: the scale-scope editor in the G5 decision.
- `p4-gates-07-g5-approved-scope-revoked`: the approved scope and a revoked exception with its reason.
- `p4-gates-08-g6-missing-ownership`: G6 Ownership transfer missing.
- `p4-gates-09-modular-g2-waiver-refused`: the DG3 refusal, translated.
- `p4-gates-10-modular-links-waiver`: the Modular-links waiver label.
- `p4-gates-11-g3-submitted-under-waiver`: missing links and the waiver used.
- `p4-gates-12-g3-approval-refused-waiver-revoked`: `gate.modular_waiver_revoked`, translated.
- `p4-closure-01-statuses-close-refused`: four statuses side by side and the closure refusal.
- `p4-closure-02-transition-round-2`: round 2.
- `p4-closure-03-withdraw-not-requester`: `approval.not_requester`.
- `p4-closure-04-auditor-read-only`: the auditor's read-only view.
- `p4-closure-05-390px` and `p4-closure-06-200pct-text`: the G5, G6, Modular G3 and closure pages at 390 px and at 200 % text, with no page-level horizontal scroll and axe 0 serious or critical issues at both.

Interaction checks run on the real stack:

- keyboard-reachable dialogs and one form-level alert each;
- a required field marked `aria-invalid` before anything is sent;
- the requester never offered the decision;
- the submitter never offered a review;
- the auditor offered no write action;
- every request on the application origin (`trackRequests`).

## 5. Contract, schema and other needs (for the orchestrator)

1. **Business units for the scale scope.** The Sponsor (G5 approver) cannot read `GET /organizations/{id}/business-units`, so the editor always offers the transformation's own business unit and adds the organization's units only where the caller may read them. Scoping G5 to another unit therefore needs an approver with `business_unit.read`, or a read of the units a transformation may scale into. This is a design point for ARCH, not built here.
2. **Dates in the modular-waiver refusals.** `problems.gate__modular_waiver_revoked` and `_expired` (FE-R1) carry no `{date}`. The server's English `detail` has it, but the problem has no structured `params`, so the screen shows the translated text without the date. The waiver's expiry is shown in the submission detail. A `params.date` in the problem would allow it.
3. **The G3 view's `canSubmit`** still ignores the Modular precondition and the waiver (BE-M2/BE-R3 open gap). The screen therefore offers Submit and shows the translated `gate.modular_links_missing` with its two items when it is refused.
4. **Operations routed:** none. Frontend tasks have no `p4-pending-*` list, so the delta is 0. The screens call these existing operations:
   - `listGateSubmissionCriteria`, `listGateCriterionReviews`, `createGateCriterionReview`;
   - `listGateExceptions`, `createGateException`, `decideGateException`, `withdrawGateException`, `revokeGateException`;
   - `getScaleScope`, `createGateDecision` (`scaleScope`), `createGateDispensation`;
   - `getTransformationStatusModel`, `getInitiativeStatusModel`, `completeInitiativeDelivery`, `setInitiativeAdoptionStatus`, `closeInitiative`, `closeTransformation`, `listClosureRecords`;
   - `listTransitionDecisions`, `createTransitionDecision`, `updateTransitionDecision` (including `status: withdrawn`), `submitTransitionDecision`;
   - `getApproval`, `listBenefits`.

## 6. i18n keys added (all EN and AR)

- **`gates.json`** (appended):
  - `exception.*` (43 leaves);
  - `review.*` (21);
  - `scale.*` (23, including `scale.ownUnit`);
  - `modularLinks.*` (2) and `modularWaiver.*` (3);
  - `missingItems.g5__* / g6__*` (25, the ADR-0035 A3 per-item keys);
  - `tableRegion.{readiness,exceptions,review}` (3).
  That is 120 leaves in each language, with identical key sets; none was removed. The exact list is in `T-DG4-FE-F-evidence/gates-keys-added.txt`.
- **`closureP4.json`** (new namespace; 130 leaves, the same set in both languages): the ADR-0034 §2 labels (`label.*`, English identical to the ADR), status vocabularies, initiative and decision texts, `arProvisional` and `tableRegion.*`.
- **Provisional Arabic:** the closure status labels show "ترجمة عربية مؤقتة لتسميات الحالة" in Arabic. The other Arabic UI texts are my translations and await the usual language review.
- **`problems.json`:** nothing added (§0 item 3).

## 7. What remains

1. **The FE-F second half (FE-F2, next wave):** change requests (`pages/change-requests/**`, its route is still planned) and the phase workspace. Not started, as assigned.
2. **The delivered-with-value-pending states on the real stack.** "Delivered — value validation pending" and "Delivery complete - value validation pending" need a launched, then completed, initiative. On the real stack that requires the DG3 prioritization, funding and launch journey, which this spec does not rebuild. These two labels are proven with stubbed responses (unit) and by BE-J's integration tests. The e2e proves the side-by-side statuses with "In delivery" data and the real closure refusal. The orchestrator or QA may want a seeded completed initiative for an A11 e2e.
3. **No scale-transition screen** (`createScaleTransition`, `listScaleTransitions`) and **no risk-disposition screen.** Neither is named in this half's scope, and the scale-transition refusal is backend-proven (BE-K).
4. **The criterion review form** takes a risk note but no RAID entry link (`raidEntryId`). A linked risk that already exists is shown as a link to the RAID register.
5. **Closure actions are offered whenever the permission allows.** The server's refusal (e.g. `closure.delivery_not_complete`) is shown rather than hiding the action.

## 8. Final runs and time

- **Targeted re-run after the fixes** (`E2E_PG_PORT=25566 E2E_API_PORT=25567 MTH_PORT_POOL=25568-25579 with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p4-gates-closure.spec.ts apps/web/e2e/p4-governance.spec.ts --workers=1`): **exit 0, 76 passed** (7.3 min; `e2e-rerun-4-specs.log`). Playwright runs the en project of all four files before ar, so `journeys.spec.ts` (ar) ran after my spec's en users existed, which is the condition that failed. `p2-journeys.spec.ts` "G2 is decided" passed in both languages, with no timeout. So the earlier failure was the 30 s timeout under load; the step was not slowed beyond it here.
- **Not done:** a second full-suite run after these fixes. The fixes are two e2e test edits (one spec line in `p4-governance.spec.ts`, display names in my spec) and no product code, and the four specs they affect pass together above. The orchestrator's merged-tree run is the full confirmation.
- The final `pnpm lint` and prettier check ran after the last edits (`lint-final.log`, `prettier-final.log`).
- `date -u` at the end: see `time-end.txt`. The run went about 10 minutes past the 2-hour limit, to finish the e2e acceptance check (the full run took 31.6 min under load).

## 9. Merge instructions

- No migrations, no API or contract change.
- Union merges are expected in:
  - `router.tsx` (one route line; my `P4_PLANNED_ROUTES` closure entry replaced by a comment);
  - `Workspace.tsx` (one tab line at the end);
  - `i18n/index.ts` (two imports, two catalogue lines);
  - `en|ar/gates.json` (new keys inside `missingItems`; new top-level objects at the end).
- FE-D2, FE-G and QA-A own none of these files (checked in their assignments).
