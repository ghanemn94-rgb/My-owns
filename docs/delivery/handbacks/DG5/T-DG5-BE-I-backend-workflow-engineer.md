# Handback T-DG5-BE-I (backend-workflow-engineer): executions, the failure queue, retry and dismiss, service identity

- **Stage:** P5 / DG5 (BUILDING). **Scope:** `docs/architecture/p5-work-split.md` §D.3.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-I.md` (sha256 `31a836d3…1d86ba`, verified).
- **Invocation:** run `DG5-T-DG5-BE-I-backend-workflow-engineer-20261014T174730Z-dacc1207`, session `dacc1207-2eb6-405f-9493-ab2b4f1809bc`.
- **Base:** branch `dg5/be-i` at `09b7428fd6168963452ee6cd2a5702b156ae05fa` (D-149 merge). The changes are left **uncommitted**, as asked.
- **Time:** start `2026-10-14T17:47:44Z`; end `2026-10-14T19:27:06Z` (`date -u`).
- **Product gates:** nothing here grants a business, Finance or IT approval. Retry and dismiss are operational repairs. Every person and value in the tests is synthetic.
- **Migrations:** none. No new dependency. No contract (`openapi.yaml`) change.

## 1. Changed files

**Mine (§D.3 ownership):**

| File | Purpose |
|---|---|
| `apps/api/src/modules/automation/failures.ts` | BE-A's stub, filled in: list, get, retry and dismiss for the failure queue. Retry and dismiss take lock 730259, If-Match, commit-time re-authorization, an audit event per row, and the retry outbox event. It also registers `executions.ts`, so `index.ts` and `routes.ts` stay unchanged. |
| `apps/api/src/modules/automation/executions.ts` (new) | `GET /admin/automation-executions` and `/{executionId}`: the execution history with the action results of every attempt. |
| `apps/api/src/modules/automation/identity.ts` (new) | The API twin of the identity and scope decision (ADR-0043 §3). It is a pure function. |
| `apps/worker/src/automation/identity.ts` (new) | The worker twin. The worker's action planner uses it. |
| `apps/worker/src/kit.ts` (appended block) | The failure capture: `captureJobFailure` (a job's last attempt, plus the `job.failed` event), `settleRetriedJob` (a successful retry resolves its entry), `recordExecutionOutcome` (a failed execution enters the queue at once; a retried one resolves or reopens its entry), and `failureRetryJobId`. |
| `apps/worker/src/worker.ts` (named lines) | Every domain job runs inside `captured`: on its last attempt a failure is recorded, then the error is rethrown, so `ops.failed` behaves as in DG4. Also the retry dispatcher on `automation.failure_retry`. |
| `apps/worker/src/automation/retry.ts` (new) | `resumeExecution`: rebuilds a retried execution from its own rule version and stored trigger, then runs the engine's `executeRule`. |
| `packages/shared/src/schemas/automation.ts` (appended block) | Zod mirrors `automationExecution(Page)`, `automationActionResult`, `operationalFailure(Page)`, the list queries, and `operationalFailureDismiss`. |
| `packages/shared/src/schemas/events.ts` (2 schemas + 2 map lines) | `job.failed` v1 (ADR-0043 §7) and `automation_failure.retry_requested` v1 (see §5.1). |
| `apps/api/test/support/p5-pending-be-i.ts` | Emptied: 6 operations routed. |
| `apps/api/test/integration/contract/p5-exercises-be-i.ts` | Exercises all 6 operations: each success and every declared refusal reachable. |
| `apps/api/test/support/automation-failures.ts` (new) | Test support: a live admin rule (create, dry run, TO review, publish, enable), with an optional planted out-of-scope action. |
| `apps/api/test/integration/automation/automation-failures.test.ts` (new) | 9 API integration tests (REQ-S12-002, -003, -021, refusals, access, parity). |
| `apps/worker/test/integration/automation-failure-queue.test.ts` (new) | 2 worker integration tests with real pg-boss (REQ-S12-020: kill/restart; retry limit → failure queue → retry dispatch). |

**Named lines in files owned by finished tasks** (no W7 task owns them; each line is marked `T-DG5-BE-I`):

| File (owner) | Change | Why |
|---|---|---|
| `apps/worker/src/automation/engine.ts` (BE-H2) | `finishExecution` selects `attempt_no` and calls `recordExecutionOutcome` in the same transaction (one import, one block). | ADR-0043 §3/§5: a failed execution enters the queue at once, atomically with its status. BE-H2's handback §7 hands this to BE-I. |
| `apps/worker/src/automation/actions/common.ts` (BE-H2) | `planRecipients` decides scope and identity through `identity.ts` instead of the inline checks. | §D.3: "service identity" with a worker twin. The behaviour is unchanged: BE-H2's 54-combination planner parity test still passes. |
| `apps/worker/src/queues/automation.ts` (BE-H2) | +2 queues (`automation.failure_retry`, `automation.job_failed`); +2 event-map entries. | Without a queue, the relay records `job.failed` as a relay failure. The retry needs a consumer. |
| `apps/worker/src/handlers/automation.ts` (BE-H2) | +1 handler: the `job.failed` consumer. It validates and records nothing; BE-J wraps it as starter 16. | Same as above. |
| `apps/api/test/integration/automation/automation-engine.test.ts` (BE-H2, test only) | The queue-map pins now include the 2 internal events and queues. The retry dispatcher is registered by `worker.ts`, not `DOMAIN_HANDLERS`, so it is excluded from the "has a domain handler" pin. | The pins listed exact sets. The intent (every admin-selectable trigger reaches `automation.evaluate`; each event keeps its DG4 consumer first; no retry override) is unchanged. |
| `apps/worker/test/integration/adoption-below-trajectory.test.ts` (DG4 test, last edited by BE-H2; test only) | One condition: an event counts as an engine trigger when its `AUTOMATION_EVENT_QUEUES` entry is `automation.evaluate`, not when it is merely present in the map. | The two internal events are in that map with their own queues. The intent is unchanged: engine triggers end with `automation.evaluate` (at most one DG4 consumer before it), and every other event has exactly one queue. |
| `apps/api/test/integration/contract/contract.test.ts` (shared pin) | Media-type pin `[349, 348, 1]` → `[350, 349, 1]`, with a comment. | `dismissAutomationFailure` has a JSON body (**delta +1 JSON**). The orchestrator reconciles the pin (rule 14). |

## 2. Behaviour delivered, per requirement row

**REQ-S12-003**: acceptance: *"A12: a rule configured to create records in a transformation outside its scope fails with an authorization error in the failure queue"*. §D.3's literal test: "a rule on transformation A configured to create a task in transformation B fails with `automation.action_forbidden` and appears in the failure queue".

- `automation-failures.test.ts` › "a rule on transformation A configured to create a task in transformation B fails at once, never retried":
  - The rule is scoped to transformation A. Its `create_task` targets transformation B.
  - The API refuses that configuration at the dry run (the planner says `forbidden`). So the test plants the action in the draft after a passing dry run, then publishes and enables the rule through the API (`test/support/automation-failures.ts`).
  - The real `automation.evaluate` handler runs it on its first attempt. The execution is `failed` with `automation.action_forbidden`, and the result is `forbidden`. No task is created.
  - In the same transaction, one `operational_failure` row: `rule_execution`, `open`, `attempts 1`, key `execution:<id>`, the ADR English text, and a `service`/`worker` audit event.
  - The queue API lists it to ADM_METHOD with `allowedActions [retry, dismiss]`. AUD reads it with `[]`.
  - The execution API shows rule, version 1, trigger code and key, `service`, and the outcome.
  - Not retried: the job does not throw. Replaying the event ×3 adds no execution and no attempt.
- **Identity:** `identity.ts`, API and worker twins.
  - The order is scope first, then the identity.
  - `service` holds exactly the version's `service_permission_codes`, checked against the catalogue's `required_permission_code`. That code is NULL for `create_task`, `notify` and `escalate`; `launch_procedure` (BE-J) will use the check.
  - `initiating_user` must hold the permission on the target; the planner reloads the grants in the action's transaction.
  - Parity: 96 combinations give identical decisions, covering all four outcomes.

**REQ-S12-002** (my part): acceptance: *"A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions"*. The dry-run clause is BE-H2's.

- `automation-failures.test.ts` › "retry resumes the execution; the done action is not repeated; the entry resolves":
  - The rule has two actions. On the event's last attempt, action 1 completes (`done`, one task per TL). Action 2 throws (an in-process fault). The execution is `failed` with `automation.retries_exhausted`, and the entry is open.
  - `POST …/retry` (ADM_TECH, `If-Match: "1"`) returns 200 `retrying`, `retryCount 1`, ETag `"2"`. In one transaction: the execution goes `failed → running` at attempt 2, both audit events are written, and the `automation_failure.retry_requested` outbox event is written.
  - The worker's resume, delivered ×3: the first run `succeeded`; the next two are `stale`.
  - Results: `[1,1,done]` and `[2,2,done]`, two distinct keys. Action 1's tasks are not recreated, and each recipient gets each notification once. The entry is `resolved`.
  - A further retry returns 422 `automation_failure.not_open` with the exact ADR text.
- Dismiss needs a reason of 3–1000 characters. It records who, when and why (audit `reason`). After it, both retry and dismiss return 422 `not_open`.
- The 21st retry returns 422 `automation_failure.retry_limit` with the exact text. Each failed retry reopens the same entry; it never creates a second one.

**REQ-S12-020**: acceptance: *"A13: killing the worker mid-job and restarting completes the job once; after the retry limit it lands in the failure queue"*. `apps/worker/test/integration/automation-failure-queue.test.ts`, real PostgreSQL and pg-boss, production `startWorker`:

1. "completes the job once; nothing enters the failure queue":
   - A real worker process is SIGKILLed inside the job's transaction (DG4's restart child, now running through the capture lines).
   - A restarted worker completes the job: one work item, and no failure entry.
2. "captures the last attempt, keeps ops.failed, and resolves through the retry dispatcher":
   - A job that always throws runs under the **unchanged** `RETRY_POLICY` limit: `retryLimit 5`, so 6 attempts. `pg-boss` `failed` with `retry_count 5`.
   - DG4's dead letter still receives it (`ops.failed`).
   - The failure queue holds one `open` `job` entry: its idempotency key (the envelope's), its original `job_data`, `attempts 6`, `automation.retries_exhausted`, the error message, and the `job.failed` outbox event.
   - The retry is written as the API writes it. The relay delivers the request after COMMIT. The dispatcher re-sends the original data, once, under the deterministic job id `failureRetryJobId(id, 1)`. The handler succeeds and the entry is `resolved`, with audit `create, retry, resolve`.
   - Two replayed requests are `stale`: the handler runs 7 times in total (6 + 1), never 8.

**REQ-S12-021** (my part: retry and replay): acceptance: *"A13: replaying the same event three times yields one reminder, one action and one approval task"*.

- Replaying the failing event ×3: one execution and one entry.
- Delivering the retry ×3: one `done` result per key, one task and one reminder per recipient.
- Replaying the dispatch request ×2: nothing re-sent.
- The "approval task" clause is BE-J's and BE-K's (starters and routes). An admin rule never creates approvals.

**REQ-S12-001** (the history API): acceptance: *"A13: each execution is recorded with rule version, trigger event and outcome"*. BE-H2 records each execution. `listAutomationExecutions` and `getAutomationExecution` expose them, with the action results of each attempt. The list filters by rule, status and transformation, uses a stable microsecond cursor, and is scoped to the reader's organizations (`automation.read`).

**Access, every mutation (§2 rule 4, ADR-0043 §8):**
- Reads: `automation.read` for rule-execution entries and executions, in the reader's organizations. `job.read` for job entries.
- Writes: `automation.repair` or `job.repair` in the entry's organization.
- AUD gets 403 on retry and dismiss, for both sources.
- ADM_METHOD (no `job.read`) gets 404 for a job entry and never sees it in lists. ADM_TECH repairs it.
- A user who can read but holds the repair right only in another organization gets 403.
- Another organization's reader gets 404, and the entry is absent from its lists. A user with no grant gets 403.
- `If-Match`: 428 when missing, 409 when stale.
- Commit-time re-authorization: a grant revoked mid-request gives 403, and neither the entry nor the execution changes.
- One audit event per row written: `operational_failure.create`, `.retry`, `.dismiss`, `.resolve`, `.reopen`, `.fail_again`; `automation_execution.retry`.
- No remote I/O inside a transaction: pg-boss is reached only by the relay after COMMIT.

## 3. Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-I-evidence/`)

Environment: Node 24.21.0, offline. Harness ports: `QA_PG_PORT=23850`, `MTH_PORT_POOL=23851-23899`. Disposable PostgreSQL from `tests/qa/support/with-pg.sh`.

Each log ends with an `exit=<n>` line. They ran in this order:

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| A4 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 17:47Z) | **0** | `PASS gate DG4 (historical)` | reported in the run transcript (run before the evidence folder existed) |
| A1 | `pnpm -r typecheck` (final tree) | **0** | 7 packages Done | `typecheck-final.log` (earlier: `typecheck.log`, 0) |
| A1 | `pnpm -r build` (final tree) | **0** | | `build-final.log` (earlier: `build.log`, 0) |
| A1 | `pnpm lint` (final tree) | **0** | `eslint . --max-warnings=0` clean | `lint-final.log` (earlier: `lint.log`, 0) |
| A1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree, after this handback) | **0** | "All matched files use Prettier code style!" | `prettier-final.log` (earlier: `prettier.log`, 0) |
| A1 | `pnpm openapi:lint` (final tree) | **0** | `PASS … OpenAPI 3.1.1, 846 operations` | `openapi-lint-final.log` |
| A2 | `pnpm test`, locale unset (LANG, LC_ALL, LC_CTYPE removed), **first run** | **1** | unit-node **1852/1854**: 2 failures caused by me and fixed (see below); unit-web **1384/1385** (base defect, see below); formula 259 passed + 2 skipped | `unit-locale-unset.log` |
| A2 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` (fixed tree) | **1** | unit-node **1854/1854**; unit-web **1384/1385** (the same base defect); formula **259 + 2 skipped** | `unit-c-utf8.log` |
| A2 | `pnpm test`, locale unset, **final tree** | **1** | unit-node **1854/1854**; unit-web **1384/1385** (the same base defect); formula **259 + 2 skipped** | `unit-locale-unset-final.log` |
| A3 | `QA_PG_PORT=23850 MTH_PORT_POOL=23851-23899 tests/qa/support/with-pg.sh pnpm test:integration`, full suite | **1** | **2197/2198** (226 files; 1949.8 s). One failure caused by me and fixed (see below) | `integration.log` |
| A3 | the same harness, `npx vitest run --project integration` on the fixed file plus every file this task touches (`adoption-below-trajectory`, `automation-failure-queue`, `apps/api/test/integration/automation/` (4 files), `contract.test.ts`), final tree | **0** | **132/132** (7 files) | `integration-rerun-final.log` |
| A4 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **0** | `PASS gate DG4 (historical)` | `validate-dg4-end.log` |

**Every non-zero exit, explained:**

1. **unit-node, first locale-unset run, 2 failures (mine, fixed).**
   - `architecture.test.ts` › module boundaries: `failures.ts` looked up a permission with a computed member (`READ[f.source]`). The boundary checker rejects computed members. Replaced with two explicit functions.
   - `advisory-locks.test.ts` › "no module source … spells a class number": a comment in `failures.ts` spelled the class number. It now names `failureRepair`.
   - Both files then passed in isolation (`unit-fix-check.log`, 142/142, exit 0), and in the C.UTF-8 and final locale-unset runs (1854/1854).
2. **unit-web, every run, 1 failure (NOT mine; present in the base).**
   - `src/i18n/glossary.test.ts` › "spells the Transformation term consistently (with shadda…)": the key `prioritization.weights.intro` writes `التحول` without the shadda.
   - D-149 records this as failure (1) of the W6 merge. T-DG5-FE-A2 repairs it in W7.
   - This task changes no file under `apps/web` (`git status --short apps/web` is empty), and the base text is unchanged (`git show HEAD:apps/web/src/i18n/ar/prioritization.json`).
   - **Because of it, `pnpm test` exits 1 in both locales, so acceptance check 2 is NOT met in this tree.** It is expected to pass once FE-A2's fix is merged.
3. **Full integration, 1 failure (mine, fixed after the run).**
   - `apps/worker/test/integration/adoption-below-trajectory.test.ts` › "the event-to-queue registry (D-102) … every other event keeps its one queue". The test assumed that every entry of `AUTOMATION_EVENT_QUEUES` feeds `automation.evaluate`, and my two internal events have their own queues.
   - One-line test change: the condition is now "this entry feeds `automation.evaluate`". The assertions are unchanged.
   - The file then passed in the targeted re-run (132/132).
   - **The full 32-minute integration suite was not re-run on the final tree within the time limit.** The only change after the full run is that one test condition. The full run was taken after the `failures.ts` fix.
4. **Intermediate runs during development** (`iter-1.log`, exit 1: 3 of my new tests failed because an earlier organization-scoped test rule matched later events; each failing rule now has its own transformation. `iter-2.log`, exit 1: the media-type pin, then updated by +1). Both are superseded by the runs above.

No test was skipped or weakened to pass. No timeout or flaky test was seen in these runs. I could not stop the first background run when I found the unit-node failures (it ran in its own PID namespace), so it finished on the then-current tree; its logs are kept as they are.

## 4. Operations routed (delta to `p5-pending-be-i.ts`)

Removed, so the list is now `[]`: `listAutomationExecutions`, `getAutomationExecution`, `listAutomationFailures`, `getAutomationFailure`, `retryAutomationFailure`, `dismissAutomationFailure`. Each is exercised in `p5-exercises-be-i.ts` through the validating client, with these mirrors:
- `automationExecutionPage` / `automationExecution`;
- `operationalFailurePage` / `operationalFailure` (×3).

The refusals exercised:
- **listAutomationExecutions:** 400, 403.
- **getAutomationExecution:** 400, 403, 404.
- **listAutomationFailures:** 400, 403.
- **getAutomationFailure:** 400, 403, 404.
- **retryAutomationFailure:** 428, 409, 403, 404, 422 `not_open`, 422 `retry_limit`.
- **dismissAutomationFailure:** 400, 428, 409, 403, 404, 422 `not_open`.

**Pinned counts:**
- Media types: **+1 JSON**, so `[350, 349, 1]` on top of the D-149 pin.
- Operation count: unchanged (846).
- Rate-limit floor: no change observed (the contract test passes).

## 5. For the orchestrator: contract, schema and design notes

1. **How the retry reaches pg-boss (ADR-0043 §5 says "`boss.send` … after COMMIT").**
   - The API has no pg-boss client. `apps/api` does not depend on `pg-boss`, and adding it would be a new dependency (D-142 Q8).
   - So the retry transaction writes an internal outbox event, `automation_failure.retry_requested {failureId, retryCount}`, with the `retrying` state (ADR-0008, transaction-safe). The relay publishes it after COMMIT. A worker dispatcher (`automation.failure_retry`, registered in `worker.ts` because it needs `boss`) then either resumes the rule execution or calls `boss.send(original queue, original job_data, {id: failureRetryJobId(id, n)})`.
   - The send still happens outside the API transaction, and a crash between COMMIT and send cannot lose it.
   - The ADR names two new events; this is a third, internal one. I propose a dated ADR-0043 §5/§7 note.
2. **Outbox rows need an organization** (`outbox_event.organization_id NOT NULL`, migration 0004).
   - `job.failed` is therefore written only for a job that names one (outbox envelopes). A scheduled job's failure (no organization) enters the queue without that event.
   - For the retry event of such an entry, the requesting user's own organization is used.
   - BE-J (starter 16) should know this.
3. **Execution error codes in the queue.** `operational_failure.error_code` holds `automation.action_forbidden`, `automation.action_failed` or `automation.retries_exhausted` (ADR-0043 §9). `error_message` holds the ADR English text when there is no detail. A job entry has `automation.retries_exhausted` and the job's own error message.
4. **Job identity in the queue.** The key is:
   - the envelope's `idempotencyKey` for an outbox job;
   - `<schedule code>:<ISO minute of createdOn>` for a queue that has a `job_schedule` row (with `job_schedule_code`);
   - otherwise `job:<pg-boss id>`.
   A successful job resolves a `retrying` entry with the same key, or the entry whose deterministic retry id it carries. An `open` entry is never auto-resolved: the 0074 guard allows `open → retrying | dismissed` only.
5. **Two entries for one fault.** When an `automation.evaluate` job throws on its last attempt, the execution enters the queue (`rule_execution`, `retries_exhausted`) and the job does too (`job`, through the generic capture). They are repaired separately, and neither repair duplicates an effect. Suppressing the job entry for engine queues would be a design decision; I did not make it.
6. **Starter executions (BE-J).** The resume rebuilds the execution from its rule version and runs the engine's executors. A starter's `starter_handler` action has no engine executor, so a retried starter execution would fail again with `automation.action_failed`. BE-J's `withStarterRule` should provide the resume path for starters.
7. **No new problem code.** Every code used is in ADR-0043 §9, with its exact English text.

## 6. User-facing texts (F-DG4-160)

- I changed no en/ar string; this task ships API and worker behaviour only.
- The en/ar `nav.json` entries `automation` ("…dry runs, executions and the failure queue") and `automationFailures` ("Failed automation actions to review and retry") describe screens that FE-D builds. They are true for the release once FE-D ships.
- `admin.json` `plannedSections` ("…automation … settings are planned for later releases") still describes the web UI, which does not exist yet. **For FE-D:** correct it in both languages when the automation screens ship.
- **For FE-D (problem and error keys, en/ar, translated by code):**
  - `automation_failure__not_open`, `automation_failure__retry_limit`;
  - the execution error codes shown in the queue: `automation.action_forbidden`, `automation.action_failed`, `automation.retries_exhausted`.
  None of these exists in `apps/web/src/i18n/{en,ar}` yet.

## 7. What remains

- Nothing in my §D.3 file list is undone.
- **Acceptance check 3 on the exact final tree:** the full `pnpm test:integration` was run once (2197/2198). Its one failure was fixed afterwards with a one-line test change, and that file passed in a targeted re-run (132/132). A full re-run of the whole suite on the final tree is still owed; the orchestrator's merged-tree verification can cover it.
- **Acceptance check 2:** `pnpm test` exits 1 in both locales only because of the base glossary defect (D-149 failure (1)), which FE-A2 owns. It needs no change from this task.
- For BE-J: the starter-16 wrapper on `automation.job_failed`; a resume path for starter executions (§5.6); `launch_procedure`'s `required_permission_code` through `identity.ts`.
- For BE-I2: `job_run` recording in `worker.ts` goes after my `captured` wrapper (both in the domain-handler loop).
- For the orchestrator: decisions on §5.1 and §5.5; reconcile the media-type pin (+1).

## 8. Merge instructions

- No migration. `pnpm -r build` is needed before the worker uses the new `@mth/shared` exports.
- Expected conflicts:
  - `contract.test.ts`: the media-type pin. Sum the increments: +1 from this task.
  - `apps/worker/src/worker.ts`: BE-I2's `job_run` lines come after this task.
  - `packages/shared/src/schemas/events.ts`: other tasks may add events to `OUTBOX_EVENT_SCHEMAS`. Additive.
