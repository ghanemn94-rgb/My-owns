# Handback T-DG5-BE-P2 — the Day-90 leadership test and its task job (backend-workflow-engineer)

## Continuation run (T-DG5-BE-P2B)

- **This run:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-P2B-backend-workflow-engineer-20261016T030611Z-e197771b","session_id":"e197771b-bc1d-456a-a604-d3a2ba036f1c"}`.
  - Assignment: `docs/delivery/assignments/DG5/T-DG5-BE-P2B.md`, sha256 `009f89d6…2ca0` (verified).
  - Started `Fri Oct 16 03:12:58 UTC 2026`. The end time is in §3.
- **Interrupted run:** `DG5-T-DG5-BE-P2-backend-workflow-engineer-20261016T011030Z-511e4c34`. A container restart stopped it at about 03:01Z, and its work was kept as WIP commit `c4de115` on `dg5/be-p2` (D-158).
- **What I found.** I compared the handback with the tree:
  - **Files:** every file in §1 exists, ends cleanly (none truncated) and contains what the handback says. I read the main module, the job handler and the wiring.
  - **Worker port:** the D-156 (a) files match BE-P's `proposed-worker-port.patch` (sha256 `e2272e5b…a871`) line for line. I compared every added and removed line.
  - **Not finished:** the end time and the final-run results (§3 held only a placeholder).
  - **The interrupted run's last checks were not valid evidence:**
    - `test-locale-unset.log` exited 1: an architecture-test timeout plus two unit-web waits.
    - `test-c-utf8.log` stopped mid-run, with 7 timeouts in the first invocation.
    - `integration-final.log` is cut off with no summary.
    - Cause: the integration suite (started 02:15Z) and both `pnpm test` runs (02:32Z, 02:56Z) ran **at the same time**, on 4 cores shared with three other W13 agents.
    - These logs are superseded and kept unchanged for provenance. Its earlier logs (`typecheck.log`, `build.log`, `lint.log`, `openapi-lint.log`, `prettier.log`) are superseded too.
- **What I finished:**
  - §3 final results, from this run's own `-B` logs. Every check was re-run on the final tree, one after another. The one overlap was the 22 s isolated architecture-test diagnosis, which ran during the C.UTF-8 `pnpm test` run (that run still passed).
  - §1: corrected the list of foreign worktree files (`.idea` and `.vscode` are empty files, not directories), and listed the removed `.cc-writes` directories.
  - §5 item 5: corrected the My Work fallback text.
- **Code:** no source or test change was needed in this run.
- **Tree housekeeping:** I removed two empty `.cc-writes` directories and their then-empty `.claude` parents: `apps/api/.claude/.cc-writes` and `docs/delivery/handbacks/DG5/T-DG5-BE-P2-evidence/.claude/.cc-writes`.
- **Everything below** is the interrupted run's handback, corrected where it was no longer true.

---

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING). Section `docs/architecture/p5-work-split.md` §H.2, plus the D-156 (a) added scope (the worker side of the launch-plan port).
- **Invocation (interrupted run):** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-P2-backend-workflow-engineer-20261016T011030Z-511e4c34","session_id":"511e4c34-fcbb-43b0-8d43-3d3fe1edc07a"}`. Assignment `docs/delivery/assignments/DG5/T-DG5-BE-P2.md`, sha256 `941c5113…f422` (verified).
- **Base:** branch `dg5/be-p2` at `cca2ba5` (the integrated HEAD).
  - The orchestrator committed the interrupted run's work as WIP `c4de115` on top of `cca2ba5` (D-158).
  - The continuation run's changes (this handback, the `-B` logs and the removed empty `.cc-writes` directories) are **uncommitted**, as the assignment asks.
  - The full diff to integrate is `cca2ba5..` plus the working tree.
- **Time:** the interrupted run started `Fri Oct 16 01:14:58 UTC 2026` and was stopped at about 03:01Z. The continuation run's start and end times are in the section above and in §3.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0 in the interrupted run. The continuation run ran it again on this tree, with the same result (`validate-dg4-B.log`, §3).
- **Gates:** no G1–G6 business approval, Finance approval or IT approval is granted anywhere. A Day-90 answer is a leader's assessment, and a job never answers it. Nothing reads or writes DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/launch/day-ninety.ts` (new) | The three Day-90 operations, the evidence-suggestion readers, the zod mirrors of the six OpenAPI components, and the ADR-0048 §9 refusals. |
| `apps/api/src/modules/launch/day-ninety.test.ts` (new) | Unit tests: the constraint → problem mapping (exact texts), and the request-body mirror. |
| `apps/api/src/modules/launch/routes.ts` | One import line and one registration line (`registerDayNinetyRoutes`), after BE-P's lines. |
| `apps/api/src/modules/platform/db-errors.ts` | The `day_ninety_*` lines: `mapP5DayNinetyError` and its one call line after `mapP5LaunchPlanError`. |
| `apps/worker/src/handlers/launch.ts` | Fills BE-A's stub. Job `launch.day_ninety_tests`, exactly once through `createWorkItemOnce` (dedupe `day_ninety_test:<testId>:<userId>`). |
| `apps/worker/src/queues/launch.ts` | Fills BE-A's stub: queue `launch.day_ninety_tests`, with the standard retry policy and DLQ. |
| `apps/worker/src/automation/ports/launch-plan-generator.ts` (new) | D-156 (a): BE-P's proposed worker twin of `generateLaunchPlanInTx`, applied unchanged. I own it from now on. |
| `apps/worker/src/worker.ts` | D-156 (a): the one import and one wiring line (`wireWorkerLaunchPlanPort()`). |
| `apps/worker/test/integration/starters.test.ts` | D-156 (a): BE-J's literal test "with the plan flag the 90-day tasks are dated from the start date (day d = start date + d calendar days)". |
| `apps/api/test/integration/launch/worker-parity.test.ts` (new) | D-156 (a), from BE-P's patch: the worker and the API generators write identical plans, and a worker replay writes nothing. |
| `apps/api/test/support/p5-pending-be-j.ts` | D-156 (a): `P5_PENDING_TESTS_BE_J` goes to `[]`, because the test above now passes. |
| `apps/api/test/support/p5-pending-be-p2.ts` | My pending list goes to `[]` (3 operations routed). |
| `apps/api/test/integration/contract/p5-exercises-be-p2.ts` (new) | The three operations through the validating client: success and every reachable refusal. |
| `apps/api/test/integration/contract/contract.test.ts` | One import, one mirror spread line and one `it` for BE-P2 (the KBE-E2 precedent), plus the media-type pin moving 381 → 382 (§5). |
| `apps/api/test/integration/launch/day-ninety.test.ts` (new) | REQ-PB-087 integration tests (§2). |
| `apps/worker/test/integration/day-ninety-tasks.test.ts` (new) | The job's integration tests (§2). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-P2-evidence/*.log` | Command logs (§3). The `*-B.log` and `*-B2.log` files are the continuation run's evidence. The others are the interrupted run's, kept for provenance and superseded. |

- **Before tests** the interrupted run removed the empty `apps/api/.claude/.cc-writes` and `apps/worker/.claude/.cc-writes` directories, as the assignment asks. Their now-empty `.claude` parents went too: `rmdir` removes only empty directories. By the continuation run, `apps/api/.claude/.cc-writes` and `docs/delivery/handbacks/DG5/T-DG5-BE-P2-evidence/.claude/.cc-writes` had appeared again, empty. I removed them the same way.
- **Files in the worktree that are not mine:** untracked `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md` were present (most of them from the start). All of them are empty, read-only files dated 02:15Z, owned by root; they look like sandbox mount placeholders. I did not create or touch them. Leave them out of the merge.

## 2. Behaviour delivered

### REQ-PB-087 — Run the Day-90 leadership test

**Acceptance (requirements.csv):** "A16: all six questions render verbatim; unanswered questions mark the test incomplete". The procedure is "At day 90 the system schedules the test; it pre-fills evidence where available and leaders record responses", with automation "Day 90 reached -> create test task" and "respond:SP,TL; view:scoped".

**`GET /transformations/{t}/day-90-test`** (`getDayNinetyTest`, `transformation.read`; AUD reads):
- It returns the six seeded `day_ninety_question` rows **verbatim**, in order, with `sourceRef` B0136–B0141 and the provisional Arabic text.
- The test asserts all six English texts literally against B0136–B0141.
- **Completion:** `completion {answered, total: 6, complete}`.
- **Responses:** each response carries `answer`, `comment`, `evidenceId`, `respondedBy` and `updatedAt`. An unanswered question has `response: null`. No suggestion ever pre-answers.
- **Evidence suggestions (ADR-0048 §4):** up to 5 per question, from the question's `evidence_record_types`, in seeded order. They are scoped to the transformation and exclude archived rows. Each has `recordType`, `recordId`, a label (shortened only through `truncateText`) and a state:
  - charter: `null` (Unknown), because the charter has no lifecycle column;
  - North Star: its status;
  - initiative, TOM gap, outcome, decision right, evidence: their status;
  - baseline: its Finance `validation_status`;
  - benefit formula: the Finance validation state of its current version, `null` while it has none;
  - executive ask: the open or deferred T16 asks (`decision.kind = 'executive'` with an `ask_origin`).
- The response is 404 while no plan exists, or for an outsider.

**`PUT …/day-90-test/responses/{q1..q6}`** (`putDayNinetyResponse`, `day_ninety_test.respond`: SP, TL):
- It takes `If-Match` **of the test**: 428 when missing, 409 when stale. Every write steps the test's version, so two leaders answering at once get one 409; a test proves it with concurrent requests.
- It inserts or updates the response. One audit event goes on the response (`day_ninety_response.create` or `.update`) and one on the test (`day_ninety_test.respond`, with the `answered_count` change). Sending an identical response writes nothing.
- An `evidenceId` must be unarchived evidence of the transformation, else 422 `validation.reference`.
- A response to a completed test gives 422 `day_ninety_test.completed`.

**`POST …/day-90-test/complete`** (`completeDayNinetyTest`, bodiless, `If-Match`):
- It needs all six answers, else 422 `day_ninety_test.incomplete` ("Answer all six questions before completing the Day-90 leadership test.").
- A completed test is final: completing again gives 422 `day_ninety_test.completed`.
- It writes `day_ninety_test.complete`, and closes the test's open `day_ninety_test_due` work items (`closeWorkItemsOfSubject`, each audited).

**Authorization:** every mutation re-checks the permission at commit time. A test proves it: a grant revoked mid-request gives 403 and nothing is written. AUD, TO and WL get 403 on both writes.

**Literal tests (§H.2), in `apps/api/test/integration/launch/day-ninety.test.ts` and `p5-exercises-be-p2.ts`:**
- all six questions are verbatim, equal to B0136–B0141;
- with 5 responses the test reports `completion {answered: 5, total: 6, complete: false}`, and completing gives 422 `day_ninety_test.incomplete` with its exact text;
- a response after completion gives 422 `day_ninety_test.completed` with its exact text;
- AUD gets 403, `If-Match` gives 428/409, and there is one audit event per mutated row.

**"Day 90 reached -> create test task":** job `launch.day_ninety_tests` (`apps/worker/src/handlers/launch.ts`), seeded by 0086 daily at 00:50 Asia/Riyadh.
- **What is due:** every open test whose `scheduled_date` ≤ today in the transformation's time zone (`p4_business_date(now(), transformation.timezone)`). A closed or archived transformation gets no task.
- **Who gets a task:** each active holder of `day_ninety_test.respond` whose live grant applies to the transformation, by the same scope rule as `reports.owner_update_tasks`. Each gets one `day_ninety_test_due` work item, with:
  - dedupe key `day_ninety_test:<testId>:<userId>`;
  - link `/transformations/<t>/day-90-test`;
  - message `launch.task.day_ninety_test_due` with params;
  - due date = the scheduled date.
- **How it runs:** one transaction per test, with the test row locked and re-checked. The audit actor is the service.
- **Literal test:** "The job run twice on day 90 creates one task per SP/TL holder" (`apps/worker/test/integration/day-ninety-tasks.test.ts`). The second run creates 0 and the rows are identical. Each item has one audit event and one notification. AUD, TO and WL get none. A test due tomorrow (day 89 today) and a completed test get none.

**Completes with:** FE-F (`pages/day-90-test/**`) and QA-D (A16).

### REQ-S12-004, the "with the plan flag" part (D-156 a; owner of the row is BE-J)

- **Acceptance text:** "… with the plan flag the 90-day tasks are dated from the start date".
- **Change:** BE-P's `proposed-worker-port.patch` (sha256 `e2272e5b…a871`) applied cleanly with `git apply` and is unchanged. I reviewed it:
  - same SQL and rows as `generateLaunchPlanInTx`;
  - ids from `mth_uuid_v7()`;
  - the lock is 730267 on `hashtext(transformationId)`, as the API takes it;
  - a replay returns the existing plan and writes nothing;
  - the audit actor is the service on behalf of the creator, with `source: worker` and `request_id: job:<id>`.
- **Tests:**
  - **BE-J's literal test** in `starters.test.ts`: the handler runs four times and leaves one plan. The windows are dated 2026-10-01..10-31, 11-01..11-30 and 12-01..12-30, and the test is on 2026-12-30.
  - **Parity test:** both generators write identical plans, 33 tasks, the test and 35 audit events.
- It is no longer pending: `P5_PENDING_TESTS_BE_J = []`.

## 3. Checks actually run

The environment is Node 24.21.0, offline. Harness ports are 24750–24799 only: targeted runs used 24750/24752, and the full runs 24770 with pool 24771–24799.

**Run 1 (superseded, disclosed):**
- **Typecheck: exit 2.** My new unit test did not satisfy `exactOptionalPropertyTypes`. Fixed.
- **`pnpm test`: exit 1 in both locales.**
  - Both runs: `architecture.test.ts` reported two ADR-0002 violations of mine: a deep import of `platform/db-errors.ts` in the unit test, and a computed-key lookup in `day-ninety.ts`. Both are fixed: the test now imports `platform/index.ts`, and the lookup uses a `Map`.
  - Locale unset: unit-web `raid.test.tsx` "action register …" failed. The machine was loaded by the concurrent integration run, and I did not change that file.
  - C.UTF-8: three `packages/reporting` PDF tests hit their 5000 ms timeout. Same load, and I did not change those files either.
- **Integration: exit 1.** 2491 passed and 1 failed, out of 2492, in 261 files. The failure was the pinned media-type triple (`[382, 381, 1]` received, `[381, 380, 1]` expected), which my one JSON-body route moves. I updated the pin (§5).
- The logs are `run1-*.log` in the evidence folder.

**Final run (continuation run, on the final tree):**

These results come from the continuation run (T-DG5-BE-P2B), on the final tree. The run used its own `-B` logs in `docs/delivery/handbacks/DG5/T-DG5-BE-P2-evidence/`.

- **Environment:** Node 24.21.0, offline, 4 cores shared with three concurrent W13 agents (load average 5–15).
- **Ports:** 24750–24799 only. The full integration run used 24770 with pool 24771–24799; the targeted run used 24750 with pool 24751–24769.
- **Order:** every check ran one after another. The one overlap was the 22 s isolated architecture-test diagnosis (03:38:19–03:38:43Z), which ran during the C.UTF-8 `pnpm test` run; that run passed.
- **Start:** `Fri Oct 16 03:12:58 UTC 2026`.

| # | Command | Log | Exit | Result |
|---|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` | `validate-dg4-B.log` | **0** | `PASS gate DG4 (historical)` |
| 1 | `pnpm -r typecheck` | `typecheck-B.log` | **0** | |
| 1 | `pnpm -r build` | `build-B.log` | **0** | |
| 1 | `pnpm lint` | `lint-B.log` | **0** | `eslint . --max-warnings=0` |
| 1 | `pnpm openapi:lint` | `openapi-lint-B.log` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | `prettier-B.log` | **0** | "All matched files use Prettier code style!" (run before this handback was edited; see the re-check below) |
| 2 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | `test-c-utf8-B.log` | **0** | unit-node 128 files / **2102 passed**; unit-web 74 files / **1429 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (first attempt) | `test-locale-unset-B.log` | **1** | unit-node 1 failed / 2101 passed: a load timeout, disclosed below; unit-web 1429 passed; nocodegen 259 passed, 2 skipped |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (second attempt) | `test-locale-unset-B2.log` | **0** | unit-node 128 files / **2102 passed**; unit-web 74 files / **1429 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** |
| 3 | `QA_PG_PORT=24770 MTH_PORT_POOL=24771-24799 tests/qa/support/with-pg.sh pnpm test:integration` | `integration-B.log` | **0** | **261 files / 2492 tests passed**, 0 failed, 1748 s. PostgreSQL bound 24770 on attempt 1. |
| — | targeted, verbose: `starters.test.ts`, `day-ninety-tasks.test.ts`, `day-ninety.test.ts`, `worker-parity.test.ts` | `targeted-verbose-B.log` | **0** | 4 files / 39 tests passed, each literal test named (below) |
| — | the architecture test alone (the diagnosis of the first locale-unset attempt) | `architecture-isolated-B.log` | **0** | 139 passed; the timed-out test took 12.9 s alone, at load 14.75 |

**Disclosed non-zero exit.** The first locale-unset attempt exited 1 (`test-locale-unset-B.log`). The failing test was `apps/api/src/architecture.test.ts` › "every import respects dependsOn, public surfaces and allowed packages", with "Test timed out in 30000ms" (the file took 48 s).
- **Cause:** machine load. The load average was 14.5 on 4 cores, from the other W13 agents.
- **It reported no boundary violation.** Run alone under the same load, it passes in 12.9 s (`architecture-isolated-B.log`).
- **Second attempt:** the full locale-unset `pnpm test` passed with exit 0 (`test-locale-unset-B2.log`).
- **The file is not mine.** I did not change its timeout. It is listed in §7 for its owner, under F-DG4-143..148 (deterministic under load).

**The 2 skipped tests** are `packages/shared/src/formula/fuzz.test.ts` lines 600 and 833: `it.skipIf(NOCODEGEN)`, by design in the no-codegen project. They are pre-existing, not my files, and skipped the same way before this work.

**Named literal tests** (from `targeted-verbose-B.log`; the full run has the same files passing):
- `day-ninety.test.ts` › "renders the six questions verbatim (B0136-B0141), open, scheduled on day 90, incomplete (0/6)" ✓
- `day-ninety.test.ts` › "with 5 responses: completion {answered: 5, total: 6, complete: false}; completing gives 422 incomplete" ✓
- `day-ninety.test.ts` › "with all six it completes (closing the test's due tasks); a response after completion gives 422 completed" ✓
- `day-ninety-tasks.test.ts` › "run twice on day 90 it creates one task per SP/TL holder, and none for AUD, TO or WL" ✓
- `starters.test.ts` › "REQ-S12-004: new transformation instantiation (starter 1, worker part) › with the plan flag the 90-day tasks are dated from the start date (day d = start date + d calendar days)" ✓. It is not skipped: the file has no `skip`, `todo` or `skipIf`, and `P5_PENDING_TESTS_BE_J = []`.
- `contract.test.ts` › "P5 BE-P2 operations (p5-exercises-be-p2.ts)" ✓, in the full integration run.

**Pinned counts:**
- The media-type triple is `[382, 381, 1]` (+1 JSON body, §5 item 1), and it passes in `integration-B.log`.
- The integration test count is 2492, the same total as the interrupted run's run 1 (which had 1 failure, the pin, since fixed).
- No other pinned count changed.

**After the handback edits:** the full-tree prettier check was run again as the last command, on the final tree. Its result is in `prettier-B2.log`.

**End:** `Fri Oct 16 04:26:11 UTC 2026` (before the final prettier re-check, whose log has its own timestamps).

## 4. Operations routed (delta to my pending list)

`p5-pending-be-p2.ts`: `["getDayNinetyTest", "putDayNinetyResponse", "completeDayNinetyTest"]` → `[]`. All three are exercised in `p5-exercises-be-p2.ts`:
- `getDayNinetyTest`: 200, 400, 401, 404;
- `putDayNinetyResponse`: 200, 400 ×2, 401, 403, 404, 409, 422 `validation.reference`, 422 `day_ninety_test.completed`, 428;
- `completeDayNinetyTest`: 200, 401, 403, 404, 409, 422 `day_ninety_test.incomplete`, 422 `day_ninety_test.completed`, 428.

## 5. Pinned counts, contract, schema and dependency needs (for the orchestrator)

1. **Media-type triple** (`contract.test.ts`, the "every route accepts exactly the request media types" test): **+1 JSON body** (`putDayNinetyResponse`). `completeDayNinetyTest` declares no body and `getDayNinetyTest` is a GET. I set the pin to `[382, 381, 1]` with a comment, as KBE-E2 did. Reconcile it with the concurrent W13 deltas (D-079).
   - **Rate-limit floor:** no change observed (that test passed).
   - The operation count (846) is unchanged.
2. **Zod mirrors:** `DayNinetyEvidenceSuggestion`, `DayNinetyResponse`, `DayNinetyQuestion`, `Completion`, `DayNinetyTest` and `DayNinetyResponsePut` have no mirror in `@mth/shared/schemas`. `packages/shared/src/schemas/launch.ts` is BE-P's file and outside my ownership, so I defined them in `apps/api/src/modules/launch/day-ninety.ts` and exported them. **Proposal:** move them to `launch.ts` (plus the barrel), because FE-F needs them for `pages/day-90-test/**` and the web cannot import the API. The definitions are self-contained, so moving them is mechanical. Then the import in `day-ninety.ts` and `p5-exercises-be-p2.ts` changes.
3. **Module readers (ADR-0002 rule 4):**
   - The charter and North Star suggestions use the transformations module's exported `findCharter` and `findCurrentNorthStar`.
   - The owning modules export no list reader for initiatives, TOM gaps, outcomes, decision rights, baselines, benefit formulas, evidence and executive asks. So `day-ninety.ts` restates read-only, transformation-scoped selects of those tables. This is the precedent of BE-P's `outputRecordExists` and of the reporting assemblers, and the architecture test accepts it.
   - "Read through the owning modules' services" (§H.2) is therefore met only for the charter and North Star. **Proposal:** the owning modules (transformations, portfolio, governance, kpi/benefits, evidence) export small `latest<Record>Refs(db, transformationId, limit)` readers, and `day-ninety.ts` switches to them.
4. **Problem codes:** no new code. The `evidenceId` refusal reuses the existing generic `validation.reference` ("No such evidence in this transformation."), as `evidence/routes.ts` does.
5. **Message key:** the work item uses `launch.task.day_ninety_test_due` with params `transformationCode`, `transformationName` and `scheduledDate`. There is no `myWork.message.launch__task__day_ninety_test_due` text yet. The My Work renderer (`apps/web/src/pages/my-work/messages.ts`) falls back to `myWork.message.fallback` with the existing kind label. It shows "Day-90 leadership test due: open the record for details" in English, and the matching Arabic text. Both are true. Optional for the owner of `apps/web/src/i18n/*/myWork.json`: add a message text in en and ar.
6. **Dependencies and migrations:** no new dependency and no migration.

## 6. User-facing texts

- **My work did not make any en/ar string untrue.** The `nav.day90Test` texts ("The six leadership questions at day 90, with their evidence.") and the `myWork.kind.day_ninety_test_due` texts describe the delivered behaviour.
- **The web route `transformations/:id/day-90-test`** stays in `P5_PLANNED_ROUTES` (owner FE-F). The screen itself is still not built, so its "planned" page remains true until FE-F ships `pages/day-90-test/**`.
- **Source coverage:** the `source_element` rows of `launch_window` still say `feature_status = 'planned'`. Migration `0088` (KBE-G2, H.4) moves them to `working` once BE-P and KBE-G2 have shipped. The six Day-90 questions are not `source_element` rows.

## 7. What remains

- **FE-F** (`pages/day-90-test/**`) and **QA-D** (A16) complete REQ-PB-087.
- **Orchestrator:**
  - the zod-mirror move (§5 item 2);
  - the module-reader exports (§5 item 3);
  - the media-type pin reconciliation (§5 item 1).
  - for the owner of `apps/api/src/architecture.test.ts`: its 30 s timeout on the "every import respects dependsOn …" test failed once under load (load average 14.5 on 4 cores) and passed on re-run (§3). That is a determinism-under-load concern (F-DG4-143..148), outside my ownership. I changed nothing there.
- **Not done by design:**
  - Completing the test does **not** change the plan's `day_ninety_test` launch task. That task is a person-edited row; ADR-0048 calls it "the plan's view of the same test" without a sync rule.
  - A start-date shift after the job has created tasks does not reschedule those work items. ADR-0048 states no rule.
  - Both can be added if the architect decides.

## 8. Merge instructions

- No migration and no ordering constraint beyond §H (after BE-P, which is already merged).
- **Expected conflicts:** with the other W13 tasks only in `apps/api/test/integration/contract/contract.test.ts`. That covers the import, mirror and `it` lines (append-only) and the media-type pin line: sum the deltas.
- The `db-errors.ts` change is one new function placed before `mapP5KpiRestatementError`, plus one call line after the `p5LaunchPlan` lines.
