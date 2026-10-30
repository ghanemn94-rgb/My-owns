# T-DG6-QA-C handback: executable acceptance suites A13 and A14 (qa-verifier, authoring)

- **Stage:** DG6 (P6), BUILDING. This is an **authoring** task, not a gate review. The independent DG6 QA review is a separate round.
- **Invocation:** `DG6-T-DG6-QA-C-qa-verifier-20261030T201852Z-8d8ff489` (session `8d8ff489-87dc-4406-bfa1-3ddd793ac0fa`).
- **Working tree:** `/home/user/wt/dg6-qa-c`, branch `dg6/qa-c`, `HEAD` `34023ce54c7a73fe55e951821e1d7514de1fdf88`. The assignment file's sha256 (`6999c488…de56`) was verified.
- **Time:** started 2026-10-30 20:19:05 UTC; finished 21:14 UTC (about 55 minutes, inside the 2-hour bound).
- **Changes:** all left **uncommitted**. No product, tool, agent, source or delivery-record file was edited.
- **Data:** all synthetic. Every approval-like step is a synthetic in-product action on test data. No real business, Finance or IT approval is granted, and no engineering gate is named in product text.

## 1. Files written

| File | Purpose |
| --- | --- |
| `tests/qa/support/a13c.ts` | Drill support. Spawns a child process and waits for READY. A switchable blocking trigger in the drill's own scratch database holds the process mid-transaction. SIGKILL, then `pg_terminate_backend` of the dead client's sessions. A minimal local SMTP double that can hang before accepting a message. |
| `tests/qa/support/a13c-child-api.ts` | The real API composition (`buildServer` with every module and import target) in its own OS process. It either drives the production `connectorRunWatchStep` (mode `watch`) or performs one request (mode `request`). |
| `tests/qa/support/a13c-child-worker.ts` | The production worker (`startWorker`, every handler, the relay, run-now) in its own OS process. It configures the channels as `main.ts` does outside production. |
| `tests/qa/integration/a13-p6-reindex-kill-restart.test.ts` | A13: the worker is killed during a search reindex, then restarted. |
| `tests/qa/integration/a13-p6-connector-run-kill-restart.test.ts` | A13: the process executing a connector run (the API's run watch) is killed mid-run and restarted. |
| `tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts` | A13: the API process is killed during an import commit and restarted; the commit is then replayed. |
| `tests/qa/integration/a13-p6-channel-send-kill-restart.test.ts` | A13: the worker is killed during an email channel send and restarted. |
| `tests/qa/integration/a13-p6-outbound-write-once.test.ts` | REQ-S17-006: an outbound-write replay or race with the same key gives one downstream effect; an unconfirmed write stays `pending_confirmation`. |
| `tests/qa/integration/a14-p6-bulk-compare-reapply.test.ts` | A14: 409 on the second save, compare (values only with `audit.read`), reapply, a save race, a bulk with two stale records, and a bulk racing a single edit. |
| `e2e/a13-connector-run-once.spec.ts` | A13 user-visible path: Run now gives one run, a retried request is refused, the run completes once, and Unknown counts are shown. Runs in en and ar with axe. |
| `e2e/a14-compare-reapply.spec.ts` | A14 user-visible path: two users edit; the second save shows the conflict state with a field-by-field compare; Reapply keeps both changes. Runs in en and ar with axe. |
| `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-C-authoring/**` | This handback, `logs/`, `mutation/` and `screenshots/{en,ar}/`. |

`tests/qa/support/{api.ts,with-pg.sh}` and the other existing support files are unchanged; only new files were added.

## 2. How the A13 drills work (disclosed test technique)

Each A13 drill runs on its **own scratch database** and kills a **real OS process**:

- **Which process is killed.**
  - Connector run and import commit: the API composition. ADR-0055 §2 as built executes due runs in the API process's run watch (header of `apps/api/.../integrations/runs.ts`), and a commit is a request.
  - Channel send and reindex: the production worker.
- **Holding the process mid-job.** A `BEFORE INSERT` trigger that the drill installs as the cluster superuser on the one table the job writes mid-work (`search_document`, `import_batch`, `import_row_commit`) waits on an advisory lock that the test holds. The killed process is therefore provably inside its open transaction.
  - For the channel drill no trigger is used: the SMTP double receives the whole message and never replies 250, so the message is not accepted.
- **Database sessions after the kill.** After SIGKILL the test ends the dead client's sessions with `pg_terminate_backend`. The database server would do this itself in production (keepalive, idle-in-transaction timeout).
- **Job expiry.** pg-boss job expiry is shortened in the drill's scratch database only: `search.reindex` and `notifications.fanout` to 5 s instead of 15 min (the DG5 `a13-durable-automation` precedent).
- **Recovery thresholds are not shortened.** The connector drill waits the real 120 s `STALE_RUNNING_SECONDS`.
- **The child API process runs with `NODE_ENV=test`.** In that mode `startConnectorRunWatch` is not started, so the child calls the same production step `connectorRunWatchStep` itself every 200 ms (production: every 10 s).

## 3. Checks run (real exit codes)

Environment: Node 24.21.0, PostgreSQL 16.15 disposable clusters, Chromium from `/opt/pw-browsers`, ports 26450–26499 only.

| # | Command | Result |
| --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | exit 0, `PASS gate DG5 (historical)` (`logs/00-…`) |
| 2 | `QA_PG_PORT=26450 MTH_PORT_POOL=26451-26499 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **exit 0: 37/37 files, 349/349 tests**, 647 s (`logs/50-full-tests-qa-integration.log`) |
| 3 | `E2E_PG_PORT=26480 E2E_API_PORT=26481 MTH_PORT_POOL=26482-26499 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a13-connector-run-once.spec.ts e2e/a14-compare-reapply.spec.ts --workers=1` | **exit 0: 4 passed** (2 specs × chromium-en, chromium-ar). axe found 0 serious/critical issues on every checked screen (the specs assert it) (`logs/32-…`) |
| 4 | `pnpm lint` | exit 0 (`logs/40-…`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (`logs/41-…`; run again after this handback was written, see §8) |
| 6 | Mutation checks (§6) | 6 of 7 mutants caught (one weakly); 1 equivalent mutant survived (explained). Both controls pass. |
| 7 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | exit 0, `PASS gate DG5 (historical)` (`logs/99-…`) |

**`--configLoader runner`.** In my sandbox `node_modules` is read-only, so Vite cannot write `node_modules/.vite-temp`. The first plain `vitest run` failed with `ENOENT … mkdir node_modules/.vite-temp` before any test ran. Per the D-113 precedent I used `--configLoader runner`; otherwise the command is the assignment's.

**Per-file counts of the new files in run 2.**

| File | Tests | Result | Time |
| --- | --- | --- | --- |
| `a13-p6-reindex-kill-restart` | 1 | ✓ | 12.9 s |
| `a13-p6-connector-run-kill-restart` | 1 | ✓ | 128.2 s, including the real 120 s recovery threshold |
| `a13-p6-import-commit-kill-restart` | 1 | ✓ | 8.9 s |
| `a13-p6-channel-send-kill-restart` | 1 | ✓ | 11.9 s |
| `a13-p6-outbound-write-once` | 3 | ✓ | |
| `a14-p6-bulk-compare-reapply` | 6 | ✓ | |

The other 31 files are the pre-existing A01–A22 suites, all ✓. Every file with its count is listed in the log.

**Disclosed non-zero exits and failed attempts.** Every one is a test-authoring issue or an environment issue, none a product defect. All logs are kept.

- `logs/11-a13-connector-run1-FAILED-fixture.log` (exit 1).
  - My first connector configuration used the adapter's default A17 fixture against the shipped `kpi_actual.v1` target. Its columns do not match that template, so the run `failed` before staging.
  - The drill now supplies a 3-row fixture with every template column.
- `logs/20-a14-api-run1/run2-FAILED-test-assumption.log` (exit 1). Two wrong assumptions of mine:
  - (a) that a TL lacks `audit.read`. TL holds it (seed `0005_seed_roles_permissions.sql`), so the editor-without-`audit.read` is now the contributor.
  - (b) that `scopeIn` compares as its own field. The form shows `scope_in_out` as one composite field whose value is an object, as `logs/20-…-run3-diagnostic.log` shows. The assertion was corrected; the diagnostic line was removed afterwards.
- `logs/11-…-run2-KILLED…` and `logs/13-…-run1-KILLED…`: no result. I started these with a shell `&` inside a tool call, and the sandbox reaped them when the call returned. They were re-run properly in the background (`run3`, `run2`).
- No e2e step hit the 30 s timeout and no flaky result occurred. A13 e2e: 8.3–10.2 s; A14 e2e: 6.5–14.8 s.

## 4. Requirement → test table

The rows are every `requirements.csv` row with `final_gate` DG6 whose acceptance, increments or notes cite A13 or A14 (10 rows).

| Requirement | Binding acceptance (abridged) | Test that proves it |
| --- | --- | --- |
| REQ-S20-013 | A13: retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable | **Covered:** the four `a13-p6-*-kill-restart.test.ts` drills (reindex, connector run, import commit, channel send), `a13-p6-outbound-write-once.test.ts`, and `e2e/a13-connector-run-once.spec.ts` (en/ar). The DG5 A13 files still pass. |
| REQ-S20-014 | A14: conflicting updates show a recoverable conflict rather than silently overwriting | **Covered:** `a14-p6-bulk-compare-reapply.test.ts` (6 tests) and `e2e/a14-compare-reapply.spec.ts` (en/ar). |
| REQ-S16-026 | two users edit the same initiative; the second save returns 409 and the UI offers compare and reapply without losing the first change | **Covered.** API: the first three A14 tests (409 `urn:mth:problem:version-conflict` with `currentVersion`, nothing written; compare; reapply as v3 keeps the other change; save race). UI: `e2e/a14-compare-reapply.spec.ts`. See note N1. |
| REQ-S15-010 | A12;A14: …a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload | **A14 part covered:** 4 items with 2 stale give exactly 2 errors at `/items/0/version` and `/items/3/version`, all-or-nothing, the other user's changes survive the resubmit; plus the bulk-vs-single-edit race. The A12 search-scope part belongs to QA-B. **NOT COVERED:** "a draft survives a browser reload". It is not an A13/A14 scenario of this task, and FE-D2 (draft recovery) is not in this tree. |
| REQ-S15-011 | A14;A20: component tests render each of the six states; a draft is labelled 'Draft - not submitted' and never counted in approved totals | **Partly covered:** the conflict state is rendered and checked in en/ar with axe (`e2e/a14-compare-reapply.spec.ts`). **NOT COVERED:** the six-state component tests (frontend's own test) and the draft label/totals rule. They are outside A13/A14 and await FE-D2. |
| REQ-S16-022 | A06;A13: ERD/migrations contain the 7 entities; an integration test creates and reads each one through the API with authorization enforced | **NOT COVERED** as a whole. My drills create and read IntegrationRun (`runConnector`, `getIntegrationRun`), Job (`runJobNow`) and Notification deliveries, but not all seven entities with authorization matrices. BE-O's `s16-022-entity-group.test.ts` is the implementer's proof; an independent check is left to the DG6 QA review or QA-E. |
| REQ-S17-006 | A13;A12: replaying an outbound write with the same key produces one downstream effect; a write without confirmation stays 'pending confirmation' | **Covered:** `a13-p6-outbound-write-once.test.ts`: 201 then three 200 replays with keys reordered (1 row, 1 effect); 409 `outbound_write.idempotency_key_reused` (no new effect); a concurrent pair (1 row, 1 effect); `confirm: never` stays `pending_confirmation` after a confirm and a replay. The A12 authorization part belongs to QA-B. |
| REQ-S20-029 | A22;A13: the load report states dataset, infrastructure, workload and actual p95 | **NOT COVERED:** the load run is DO-G/QA-E (p6-plan §5.1). |
| REQ-S20-030 | A15;A13: exporting the full load dataset returns a job ID, progress reaches 100 %, requester-only download | **NOT COVERED:** the A15 export suite and the load dataset belong to QA-E/DO-G. No export kill drill was assigned to QA-C. |
| REQ-DLV-038 | A12;A13;A14;A17;A21;A22;A23 tests pass on the DG6 candidate, plus the load report | **Contributes the A13 and A14 parts** (above). The full DLV-038 evidence run on the frozen candidate is QA-E's. |

**N1 (compare and reapply UI).**

- What I tested is the conflict panel that exists in this tree (`FormConflict` in `RecordForm.tsx`): your unsaved values next to the current saved values, field by field, with "Re-apply my change on the current version". It meets the binding text: 409, compare, reapply, and the first change is kept (asserted through the API: version 3 with both values; and on the page).
- ADR-0057 §7's three-way compare (`components/compare/**`, FE-D2) is not in this tree (there is no `T-DG6-FE-D2` handback). If FE-D2 lands later, re-run `e2e/a14-compare-reapply.spec.ts`; its selectors use the catalogue texts `common.conflict.*`.

## 5. What each A13 drill proves (assertions)

| Drill | While killed (mid-job) | After restart |
| --- | --- | --- |
| Reindex | 0 transformation documents; state `reindexing`; search `stale: true`, no results | every type `idle`; `documentsCount` = number of transformations; one document each; every synthetic title found exactly once; `stale: false` |
| Connector run | the run is `running`; `rowsRead`, `rowsStaged`, `rowsCommitted`, `rowsRejected`, `rowsDuplicate` are all null (Unknown); no `import_batch`, no `import_row` | the **same** run `succeeded`; 3 read, 3 staged; `rowsCommitted` null; one batch (3 rows, all valid); reconciliation `matched`; control totals `33.75` compared as decimal strings; no retry run and no second run |
| Import commit | the batch is still `staged` at the same version; `rowsCommitted` null; 0 lineage, 0 KPI actuals, no row lineage | the retried request (same If-Match) is 200 `committed`, 3 committed; exactly 3 lineage rows and 3 KPI actuals; a replay is 409 `import.not_staged` and writes nothing |
| Channel send | the reviewer's delivery is one row, `pending`; the server accepted nothing; one inbox notification | the delivery is `sent`, no `failed` delivery; accepted messages = sent deliveries; the reviewer received exactly one message per sent delivery |

## 6. Mutation checks (disposable copies in `$TMPDIR`; logs in `mutation/`)

- **Method.** Each mutant runs in its own copy of the tree (`node_modules` symlinked read-only, `docs/api` included). One product line is replaced, and the replacement is verified by occurrence counts and a diff in the log. The one relevant test file then runs.
- **Controls.** M0a and M0b run unmutated copies: both pass (6/6 and 1/1).
- **Scripts:** `mutation/mutate.sh.txt` and `mutation/mutate7.sh.txt`.
- **No product file in the working tree was touched.**
- **One earlier batch** failed at setup ("no tests", exit 1) because the copy lacked `docs/api/openapi.yaml`. Those results were **discarded, not counted**; the batch was re-run with the file and the controls.

| Mutant | Scenario | Product change (copy only) | Test result |
| --- | --- | --- | --- |
| M1 | A13 reindex | `search.ts`: reindex sets `status: "idle"` instead of `"reindexing"` | **FAILED as expected:** "the type is marked reindexing…: expected 'idle' to be 'reindexing'" |
| M2 | A13 connector | `runs.ts` `dueRuns`: stale `running` runs are never recovered | **FAILED as expected:** "timed out after 240000 ms waiting for the restarted watch finishes the run" |
| M3 | A13 import | `commit.ts`: both `status !== "staged"` refusals removed | **Survived (equivalent mutant).** The replay is still 409 `import.not_staged`, because the database guard `import_batch_final` refuses it (mapped in `platform/db-errors.ts`). The behaviour the test asserts is still delivered, so this is not a test gap; it is the defence in depth. Replaced by M7. |
| M7 | A13 import | `commit.ts`: the commit loop commits only the first valid row (a partial commit) | **FAILED as expected:** the retried commit got 500 instead of 200 (the database's count invariant refused the partial commit) |
| M4 | A13 channel | `notifications.ts`: the send is replaced by `{ ok: true }` (marked sent without sending) | **FAILED, weakly:** the drill stops at its precondition ("a message on the wire") because nothing reaches the SMTP double. The end assertion "accepted = sent" would also catch it, but the run never gets there. |
| M5 | A14 bulk | `bulk.ts`: the per-item stale check is removed | **FAILED as expected (2 tests):** `version_conflict` instead of `form_record.bulk_conflict`. With the bulk check gone, the per-record lock still refused the stale item (a second layer), but not with the contract's per-item bulk problem. |
| M6 | A14 PATCH | `portfolio/repository.ts`: the If-Match check is removed | **FAILED as expected (3 tests):** "expected 200 to be 409" (silent overwrite), and the race gave `[200, 200]` |

## 7. Product defects found

**None.** No test needed a workaround. Observations for the reviewers (not findings by this task):

- **O1 (Low, presentation; possibly by design).**
  - Request: `GET /api/v1/transformations/{tid}/form-records/T05/{id}/compare?fromVersion=1&toVersion=2` as AUD.
  - The response returns `labelEn: "objective"` and `labelEn: "scope in/out"` (lowercase, key-like), while `labelAr` is a proper Arabic label (`"الهدف"`, `"النطاق داخل/خارج"`).
  - Evidence: `logs/20-a14-api-run3-diagnostic.log` (line `QA-DIAG compare body`). The English page labels elsewhere are title-cased ("Objective").
- **O2 (documented limit, not exercised).** ADR-0054 §3 and the `notifications.ts` header state that a crash *after* the SMTP server accepted a message and *before* `sent` is recorded resends the message (at least once; SMTP has no idempotency key). The A13 text says notifications must not be duplicated. My drill covers the window before acceptance (exactly once, proven). The post-acceptance window is a known residual for the domain and code-security reviewers to judge.
- **O3.** M3 shows that the import "not staged" rule is enforced twice (API and database); M5 shows the same for bulk staleness (bulk check, then the per-record lock). Both are good, and noted for mutation-test design.

## 8. What remains

- **Not covered by this task:** REQ-S16-022 (full 7-entity API matrix), REQ-S20-029, REQ-S20-030, the REQ-S15-010 draft-reload part, and the REQ-S15-011 six-state/draft-label parts (§4).
- **FE-D2 dependency:** when the ADR-0057 §7 three-way compare and the draft recovery land, re-run `e2e/a14-compare-reapply.spec.ts` and add draft-reload checks.
- **Load on the full suite:** the connector drill adds about 128 s (the real recovery threshold), and 2 child processes per drill, to the run.
- **Formatting of this handback:** `npx prettier --check` was re-run after it was written (see the tail of `logs/41-prettier-check.log`).

## 9. Merge instructions

- Only new files; no migrations, no conflicts expected.
- The new tests are picked up by the existing `integration` project glob (`tests/qa/integration/**`) and by the root Playwright `testMatch` (`e2e/**/*.spec.ts`).
- In a sandbox with a read-only `node_modules`, run Vitest with `--configLoader runner`.
