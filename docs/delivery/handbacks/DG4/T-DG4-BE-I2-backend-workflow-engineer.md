# Handback T-DG4-BE-I2 (backend-workflow-engineer): controls, control checks, reviews, the CI backlog, lessons and the two scans

- **Stage / gate:** P4 "Execution value and sustainment", DG4 (BUILDING). Section: `docs/architecture/p4-work-split.md` §F+G FG.5.
- **Run:** the C run (salvage and completion), task `T-DG4-BE-I2C`. Invocation reference: `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-I2C-backend-workflow-engineer-20261009T143032Z-487bd8c2","session_id":"487bd8c2-f11e-41c9-ba9d-902051b4ad1c"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-I2C.md` (sha256 `405923a3…8517aa3`, checked with `sha256sum` at the start). It reproduces `T-DG4-BE-I2.md` unchanged as the scope.
- **Base:** branch `dg4/be-i2`, `HEAD` `27c0d2c` (WIP commit of the B run), on top of `44fffa1` (WIP commit of the first run), on top of the integrated base `489712f` ("DG4: D-102 …"). Everything below is described **against `489712f`**. My own changes are **uncommitted** on top of `27c0d2c`, as instructed. Git metadata is read-only in this sandbox, so I could not commit anyway.
- **Time:** `date -u` at the start: `Fri Oct  9 14:30:59 UTC 2026`; at the end: `Fri Oct  9 15:19:55 UTC 2026` (§8).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → exit **0**, `PASS gate DG3 (historical)`. I ran it first, before any edit, and again on the final tree (log `T-DG4-BE-I2-evidence/validate-dg3-historical.log`).
- **Two gate systems.** Nothing here is a G1–G6 business approval. No job, seed or test grants a real business, Finance or IT approval. Nothing reads or writes DG0–DG7 records. All test data is synthetic.
- **Closure fixture:** BE-J's closure service is not merged. The "after closure" proofs use the direct closure-record fixture BE-I used (`closeTransformationSynthetic` in `p4-exercises-be-i.ts`, which writes a synthetic `closure_record` and sets `status = 'closed'` without `archived_at`).

## 0. Salvage (D-103, D-104)

I treated both WIP commits as someone else's unverified work. I reviewed every file against FG.5, ADR-0034 §6/§8/§9/§10/§12, ADR-0031 §5.4, the shared rules S-1…S-14, `0048`/`0050` and the OpenAPI schemas. I deleted every stale log in the evidence folder (it held only an empty `.claude/.cc-writes` sandbox directory, which I removed along with an empty `apps/api/.claude/.cc-writes`). Every check in §4 was run from scratch on the final tree. I neither cite nor use the orphaned evidence under `test-evidence/DG4/{be-i2,be-i2b}-orphaned/`.

**Kept from the WIP (reviewed and found correct):**

- **`sustainment/controls.ts`:** the 7 operations. Its `recordControlCheck` writes the `control_check.failed` outbox event in the same transaction with exactly the ADR-0031 §5.4 payload and key `control_check.failed:<checkId>`. A failed check without a note is refused (400 `control_check.result_note_required`), and so is a check that is already recorded (422 `control_check.final`). Retiring a control cancels its due checks and their work items. `completeSustainmentReview` is for the assignee only (403 `sustainment_review.not_assignee`). The §12 codes and English texts are verbatim.
- **`sustainment/improvement.ts`:** the 3 operations. The status machine matches the `improvement_item_guard` edge list. Done and rejected need a resolution note and are final. The source must belong to the same transformation. No guard reads the transformation's status.
- **`sustainment/lessons.ts`:** the 5 operations. `searchLessons` returns published lessons only and uses `plainto_tsquery('simple', q)` on the stored `search_document`. Its scope is ADR-0006 `scopeFilter` on `lesson.search`, widened for a transformation-scoped grant to that transformation's business unit, so a user of transformation 2 finds transformation 1's lessons in the same business unit. A lesson outside the scope is absent, not refused, so its existence is not disclosed.
- **Worker `handlers/sustainment.ts` and `queues/sustainment.ts`:**
  - `sustainment.review_scan` and `sustainment.control_check_scan` both use `runOnce` per subject, version and due date, re-read the subject `FOR UPDATE`, insert if absent (backed by `sustainment_review_due_key` and `control_check_due_key`), advance the next date by one calendar period, and record the audit actor as the service.
  - The 7-day horizon uses each organization's business date (its default calendar's timezone, else the organization's own; default Asia/Riyadh).
  - A worker outage is caught up once per missed due date, bounded at 520 steps per subject.
  - `scheduleAreaReviewInTx` is the worker twin of BE-I's `scheduleAreaReview` (D-102 (2)).
  - Neither scan reads the transformation's status.
- **`platform/db-errors.ts`:** `mapP4SustainmentOperationsError` and its call line in the slices F/G block. I checked all 36 constraint names it maps against `0048`, and both message regexes against the `RAISE` texts.
- **`packages/shared/src/schemas/sustainment-operations.ts` and its `schemas/index.ts` line:** I compared every request mirror member by member with `ControlCreate`, `ControlUpdate`, `ControlCheckRecord`, `SustainmentReviewComplete`, `ImprovementItemCreate`/`Update` and `LessonCreate`/`Update` in `openapi.yaml`. They match, and every free-text field uses `freeText` (S-1).
- **`events.ts`:** the `"control_check.failed": { 1: checkFailedPayload }` registry line (see §6).
- **Contract seams:** the 15 exercises appended to `p4-exercises-be-i.ts`, the emptied `p4-pending-be-i2.ts`, and the media-type pin.
- **Tests:** the 4 test files and their proofs (the parity test, the end-to-end failed-check chain, after-closure reviews and KPI actuals, scans run twice).

**Changed, and why:**

- `controls.ts`: I first replaced the hand-written outbox insert with `jobs`' `enqueueOutboxEvent`. The unit test `apps/api/src/architecture.test.ts` (ADR-0002 module boundaries) then failed: "module sustainment may not import module jobs". I reverted that change and kept the module-local insert, which validates against the same registered v1 schema (the BE-H `interventions.ts` and KBE `benefits/values.ts` precedent). I added a comment explaining this. That failed unit run is disclosed in §4.

**Added:**

- **S-4 commit-time authorization tests for every mutation the WIP left untested** (a caller whose grants are revoked after the identity hook gets 403, and nothing is written):
  - `createControl`, `updateControl` and `completeSustainmentReview` (asserted not to be the `not_assignee` 403) in `controls.test.ts`;
  - `createImprovementItem` and `updateImprovementItem` in `improvement.test.ts`;
  - `createLesson`, `updateLesson` and `publishLesson` in `lessons.test.ts`.

  The WIP had this test only for `recordControlCheck`.
- **S-1 free-text tests** (400 `validation.blank` at the exact pointer, and U+0000 → `validation.invalid_character`) on the control name, the review outcome note, the CI title and resolution note, the lesson text and a lesson tag.

## 1. Changed files (against `489712f`)

| File | Purpose |
|---|---|
| `apps/api/src/modules/sustainment/controls.ts` | `listControls`, `createControl`, `updateControl` (incl. retire, which cancels due checks and their tasks), `listControlChecks` (with slice E's `correctiveCaseId`), `recordControlCheck` (the `control_check.failed` outbox event in the same transaction), `listSustainmentReviews`, `completeSustainmentReview` (assignee only); shared helpers `nextOperationsCode` (`CTL`/`CI`/`LL`), `assertOpenArea`, `organizationBusinessDate`, `diffFields`. |
| `apps/api/src/modules/sustainment/improvement.ts` | `listImprovementItems` (the read slice H's G6 evaluator uses), `createImprovementItem`, `updateImprovementItem` (status machine, resolution note). |
| `apps/api/src/modules/sustainment/lessons.ts` | `listLessons`, `createLesson`, `updateLesson` (incl. archive), `publishLesson` (bodiless), `searchLessons` (scoped, published only, `plainto_tsquery('simple', q)`, tag filter, keyset cursor). |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4SustainmentOperationsError` (the control, check, review, CI and lesson lines of the slices F/G block, after BE-I's) and its call line in `mapDatabaseGuardError`. |
| `apps/worker/src/handlers/sustainment.ts` | The two scans and the worker twin `scheduleAreaReviewInTx`; `SUSTAINMENT_HANDLERS`. |
| `apps/worker/src/queues/sustainment.ts` | The two queue specs (standard bounded retry policy, `ops.failed` dead-letter queue via `queues/index.ts`); no event mapping (both are started by their `0050` schedules). |
| `packages/shared/src/schemas/sustainment-operations.ts` (new) | Zod mirrors of `Control*`, `ControlCheck*`, `SustainmentReview*`, `ImprovementItem*`, `Lesson*`, `LessonSearchHit`/`Page`. |
| `packages/shared/src/schemas/index.ts` | One export line (+ comment), append-only. |
| `packages/shared/src/schemas/events.ts` | One registry line: `control_check.failed` v1 → `checkFailedPayload` (outside the FG.5 list; see §6). |
| `apps/api/test/support/p4-pending-be-i2.ts` | Emptied: all 15 operations routed. |
| `apps/api/test/integration/contract/p4-exercises-be-i.ts` | 15 mirrors appended to `P4_MIRRORS_BE_I`; `exerciseP4BeI2Operations` appended (called at the end of `exerciseP4BeIOperations`), so no new seam file and no `contract.test.ts` call change. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only, plus its comment line (§5). |
| `apps/api/test/integration/sustainment/controls.test.ts` (new) | Controls, checks, reviews, the parity test, commit-time auth and free text (15 tests). |
| `apps/api/test/integration/sustainment/improvement.test.ts` (new) | CI backlog incl. REQ-PB-084 after closure, commit-time auth and free text (8 tests). |
| `apps/api/test/integration/sustainment/lessons.test.ts` (new) | REQ-S11-008 lesson search across transformations in scope; lifecycle; commit-time auth and free text (7 tests). |
| `apps/worker/test/integration/sustainment-scans.test.ts` (new) | The two scans after closure, catch-up, run twice, the end-to-end failed-check → recovery case chain, and registration (5 tests). |
| `docs/delivery/handbacks/DG4/T-DG4-BE-I2-backend-workflow-engineer.md`, `T-DG4-BE-I2-evidence/*.log` | This handback and its logs. |

No migration was written, and no schema change is needed. `sustainment/index.ts`, `server.ts`, `performance-areas.ts`, `handovers.ts` and other slices' files are untouched.

## 2. API endpoints added (15 operations) and jobs (2)

Paths are under `/api/v1/transformations/{transformationId}/` except the search.

| Operation | Method and path | Permission (record rule) |
|---|---|---|
| `listControls` | `GET controls` (`?performanceAreaId&status`, cursor, limit) | `transformation.read` |
| `createControl` | `POST controls` → 201, active, `CTL-nn`, version 1 | `control.manage` (BO, TO) |
| `updateControl` | `PATCH controls/{c}` (If-Match; `status: retired` + `retireReason`) | `control.manage` |
| `listControlChecks` | `GET control-checks` (`?performanceAreaId&status`) | `transformation.read` |
| `recordControlCheck` | `POST control-checks/{k}/record` (If-Match) | `control_check.record` (BO, TO) |
| `listSustainmentReviews` | `GET sustainment-reviews` (`?performanceAreaId&status`) | `transformation.read` |
| `completeSustainmentReview` | `POST sustainment-reviews/{r}/complete` (If-Match) | `sustainment_review.complete` (BO, KDS, FIN); caller = assignee, else 403 `sustainment_review.not_assignee` |
| `listImprovementItems` | `GET improvement-items` (`?performanceAreaId&status`) | `transformation.read` |
| `createImprovementItem` | `POST improvement-items` → 201, open, `CI-nn` | `improvement.edit` (BO, TO) |
| `updateImprovementItem` | `PATCH improvement-items/{i}` (If-Match) | `improvement.edit` |
| `listLessons` | `GET lessons` (`?status`; drafts included) | `transformation.read` |
| `createLesson` | `POST lessons` → 201, draft, `LL-nn` | `lesson.edit` (BO, TO) |
| `updateLesson` | `PATCH lessons/{l}` (If-Match; `status: archived` archives, final) | `lesson.edit` |
| `publishLesson` | `POST lessons/{l}/publish` (bodiless, If-Match) | `lesson.edit` |
| `searchLessons` | `GET /api/v1/lessons/search?q=&tag=&cursor=&limit=` | `lesson.search` (business roles and AUD); business-unit scope |

AUD gets 403 on every write. ADM-only users and outsiders get 404 on the transformation-scoped operations and 403 on `searchLessons` (ADM holds no `lesson.search`). Every write route's `config.consumes` is `["application/json"]`, except the bodiless `publishLesson`, which declares none (S-3). Every mutation re-checks authorization at commit time, validates, needs `If-Match` (428 when missing, 409 when stale; creates are version 1), writes its audit event in the same transaction and does no remote I/O inside it (S-4).

| Job (queue) | Schedule (`0050`) | Idempotency |
|---|---|---|
| `sustainment.review_scan` | `20 0 * * *` Asia/Riyadh | `runOnce(queue, review:<areaId>:v<version>:<dueDate>)`; `sustainment_review_due_key`; work item dedupe `sustainment.review:<areaId>:<dueDate>` |
| `sustainment.control_check_scan` | `25 0 * * *` Asia/Riyadh | `runOnce(queue, check:<controlId>:v<version>:<dueDate>)`; `control_check_due_key`; work item dedupe `sustainment.control_check:<checkId>` |

## 3. Behaviour delivered, per requirement row (acceptance texts quoted from `requirements.csv`)

- **REQ-S11-008.** "A11: a failed control check creates a recovery action; a lesson is searchable from another transformation".
  - *Failed check → recovery action:* `sustainment-scans.test.ts` "end to end: a failed check emits one control_check.failed and slice E opens ONE recovery case (owner, follow-up)".
    - The control-check scan creates the check, and `recordControlCheck` (failed) writes exactly one `control_check.failed` event.
    - The relay mapping is asserted (`QUEUE_FOR_EVENT` → `raid.corrective_control`).
    - The envelope is delivered twice to BE-D2's `handleControlCheckFailed`. Exactly one `corrective_case` is opened, with owner (the control owner), a non-null `follow_up_date` and its `corrective_case_follow_up` work item, and `listControlChecks` shows its `correctiveCaseId`.
    - `controls.test.ts` asserts the exact ADR-0031 §5.4 payload. It also shows that a passed check emits nothing and a recorded check cannot emit a second event.
  - *Lesson searchable from another transformation:* `lessons.test.ts` "found by a user of transformation 2 in the same business unit; not by a user of another business unit". A user granted only on transformation 2 finds transformation 1's published lesson. A user of another business unit or another organization gets 200 without it. Drafts and archived lessons are never returned.
  - *"Control check due → task":* the scan's `control_check_due` work item for the owner, else the BAU owner. With neither, the check is unassigned and has no work item, never a guessed person.
- **REQ-S11-004.** "A11: after closure, the next scheduled review task is created on time". `sustainment-scans.test.ts` "the closed transformation's BAU area gets its next review on time, once; its linked KPI accepts an actual":
  - after the synthetic closure, the scan run 8 days before the next due date creates nothing;
  - run 7 days before it, the scan creates the review for that date for the BAU owner, with its `performance_review_due` work item in the owner's `GET /me/work-items`, audited as `service`/`worker`.
- **REQ-S03-002 (reviews after closure; the areas half is BE-I's).** "A11: after a transformation is closed its linked performance area still generates scheduled review tasks and accepts KPI actuals". The same test proves both after closure:
  - the area's next review is created;
  - the linked KPI accepts an actual (201, `accepted`, direct-accept route).
- **REQ-PB-084.** "A11: CI backlog items remain visible after transformation closure; G6 lists the backlog". `improvement.test.ts` "after closure: listed, edited, closed and created as before; the transformation is closed, not archived". "G6 lists the backlog" is slice H's: it consumes `listImprovementItems` through `GateFactsProvider` (FG.8). Slice G exposes the read, and I make no claim for the G6 half.
- **REQ-PB-083 (BE-I2's scan part).** `sustainment-scans.test.ts` shows the first review created by the acceptance is found (`existing`), not duplicated, and the scan advances past it. "after a worker outage one run catches up every missed due date, once each; a rerun creates nothing". The control-check scan run twice creates one check.
- **D-102 (2) parity:** `controls.test.ts` "parity (D-102 (2)): the worker's review twin writes the same rows as the API's scheduleAreaReview". The comparison covers the review row, the work item (kind, assignee, subject, message key and params, due date, link, dedupe) and the audit event (action, actor type, source, changed fields). A second call returns `existing`.

## 4. Checks run (final tree; logs in `docs/delivery/handbacks/DG4/T-DG4-BE-I2-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; harness ports 24200–24249. Free disk was 21–22 GB before every full run.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | all packages | `build.log` |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` | `openapi-lint.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | first invocation 118 files, **2258 passed**; second (`unit-formula-nocodegen`) 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `env -u LANG -u LANGUAGE LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2258 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=24200 MTH_PORT_POOL=24201-24249 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 120 files, **1318 passed** (1318), 577.7 s; PostgreSQL on port 24200, attempt 1 (no port retry) | `integration.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.log` |

**Disclosed non-zero exits along the way.** None of these is in the final logs, because each log was overwritten by its rerun on the final tree.

- **`pnpm -r typecheck` exit 2, my first run:** `controls.test.ts(544,12): TS18046 'res.body' is of type 'unknown'` in a test I had just added. Fixed with a cast; it then exited 0.
- **`pnpm test` exit 1, both locale settings, 1 failed / 2257 passed:** `apps/api/src/architecture.test.ts` "every import respects dependsOn …" reported "modules/sustainment/controls.ts: module sustainment may not import module jobs". The cause was my `enqueueOutboxEvent` switch (§0), which I reverted. The test then passed (137/137 alone), and the full reruns above exit 0.
- **`git checkout HEAD -- <file>` failed** with "Read-only file system" (git metadata is read-only in this sandbox). I restored the file with `git show HEAD:<file> > <file>` instead.
- **A targeted pre-check** (not an acceptance check): `with-pg.sh npx vitest run --project integration apps/api/test/integration/sustainment apps/worker/test/integration/sustainment-scans.test.ts apps/worker/test/integration/schedules.test.ts` → exit 0, 8 files, 57 tests passed.

## 5. Contract seams

- **Pending list delta (`p4-pending-be-i2.ts`): 15 → 0.** Routed and exercised through the validating client in `p4-exercises-be-i.ts`: `listControls`, `createControl`, `updateControl`, `listControlChecks`, `recordControlCheck`, `listSustainmentReviews`, `completeSustainmentReview`, `listImprovementItems`, `createImprovementItem`, `updateImprovementItem`, `listLessons`, `createLesson`, `updateLesson`, `publishLesson`, `searchLessons`.
- **Media-type pin:** `[257, 256, 1]` at base `489712f` → **`[265, 264, 1]`** (delta **+8** JSON bodies: `createControl`, `updateControl`, `recordControlCheck`, `completeSustainmentReview`, `createImprovementItem`, `updateImprovementItem`, `createLesson`, `updateLesson`; `publishLesson` has no body). The orchestrator reconciles concurrent pins at merge (BE-H2, BE-G and KBE-F run concurrently).
- **Integration count:** 1283 at base (D-102) → **1318** (+35). This task adds 35 integration tests in 4 new files (15 + 8 + 7 + 5). The contract test's count is unchanged, because the exercises are appended to an existing test.

## 6. For the orchestrator (contracts, schema, files outside FG.5)

- **Schema: no need.** No migration was written.
- **Outside the FG.5 file list (accepted precedent, please confirm):** the one `control_check.failed` line in `packages/shared/src/schemas/events.ts`. Without it the outbox writer has no schema for the event. BE-H (`adoption.check_failed`), KBE-B and KBE-E added their event lines the same way (D-095, D-100). It is append-only.
- **Stale comment, not mine to edit:** `apps/worker/test/integration/schedules.test.ts` says the two `0050` rows are "unhandled until BE-I2 registers the sustainment handlers". That test passes its own `handled` set, so it stays green (passed in the targeted run and in §4 row 3), but the comment is now out of date.
- **Merge conflicts to expect:** `contract.test.ts` media-type pin (sum it); `platform/db-errors.ts` (BE-I2's function is appended after BE-I's `mapP4SustainmentAreaError`, plus one call line after BE-I's call); `schemas/index.ts` (union); `p4-exercises-be-i.ts` (BE-I2 appended; BE-J has its own seam file).
- **For BE-J:** add its transition-decision monitoring to `runReviewScan` in `apps/worker/src/handlers/sustainment.ts`. The worker cannot import its `scheduleMonitoringReviews` (ADR-0002 rule 5), so it needs a worker twin and a parity test (D-102 (2)), as here.

## 7. Design choices for the reviewers (not decided by an ADR text)

1. **Lesson-search scope for a transformation-scoped grant.** ADR-0006 `scopeFilter` alone would give a user granted only on transformation 2 just transformation 2's lessons, which defeats REQ-S11-008 A11. The search therefore widens a transformation-scoped `lesson.search` grant to that transformation's business unit (same organization). A transformation without a business unit widens to nothing beyond itself. Organization and business-unit grants are unchanged.
2. **Unassigned check.** A control with no owner, in an area with no BAU owner (still establishing), gets a check with `assignee_user_id = NULL` and no work item. The record is never assigned to a guessed person (FG.11 (6)).
3. **Period arithmetic.** The next review or check date is the previous due date plus `interval` calendar weeks or months (PostgreSQL `date + make_interval`), never working days, per ADR-0034 §5/§6. Month-end dates follow PostgreSQL's clamping (Jan 31 + 1 month = Feb 28, then Mar 28), which is the same rule as BE-I's `businessDatePlusPeriod`.
4. **Retiring a control** cancels its `due` checks (audited with the retire reason) and their `control_check_due` work items. Recorded checks stay as they are.

## 8. What remains

- Nothing in FG.5 remains open.
- Out of scope and stated so they are not claimed: "G6 lists the backlog" (slice H, BE-K); the transition-decision part of `sustainment.review_scan` (BE-J); EN/AR translations of the §12 codes (FE-E via FE-A's `problems.json`).
- `date -u` at the end: `Fri Oct  9 15:19:55 UTC 2026` (about 50 minutes after the start).
