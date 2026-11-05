# Handback T-DG6-BE-Z6 (backend-workflow-engineer): a system recurrence no longer makes a human's acknowledge or resolve fail

- **Stage:** DG6 (P6), pre-freeze repair after review round 4 (D-213).
- **Invocation:** `DG6-T-DG6-BE-Z6-backend-workflow-engineer-20261105T144457Z-8624469f`, session `8624469f-4df1-479f-b897-36a1d31c362f`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z6.md`, sha256 `e731b2cd…b24d2c` (verified).
- **Starting revision:** `97ede4db70e4040fdebba30bc508d811c2017b18`, branch `dg6/be-z6`, clean tree.
- **Time:** started `2026-11-05T14:45:16Z`, ended `2026-11-05T15:28:39Z` (about 44 min).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited 0 and printed `PASS gate DG5 (historical)` (`T-DG6-BE-Z6-evidence/validate-dg5.log`).
- **Commits:** none. The changes are left uncommitted for the orchestrator.

No business, Finance or IT approval was granted. Acknowledging or resolving an operational exception is not a business approval (G1–G6) and has nothing to do with DG0–DG7. All test data is synthetic.

## 1. The cause, confirmed

The orchestrator's reading (D-213) is correct, and a deterministic test now proves it.

- **The new test:** `apps/api/test/integration/operations/exception-recurrence-race.test.ts`. Its first case runs the real `heartbeatWatchStep`:
  1. The watch opens `heartbeat_missed` (version 1).
  2. The administrator loads it with `GET` (version 1).
  3. The exception's last occurrence is aged by 61 s, as superuser with `session_replication_role = replica`, to simulate the 30 s `RECUR_MIN_GAP_SECONDS`.
  4. The next watch step recurs it (version 2).
  5. The administrator acknowledges with `If-Match: "1"`.
- **Before the fix** (the unchanged `exceptions.ts` from `HEAD`, swapped in only for this run, then restored), it got `409 {"code":"version_conflict","currentVersion":2}`. The other three raisers hit the same 409, as did the "current view after a human change" half of a control. Result: 5 failed, 2 passed (`T-DG6-BE-Z6-evidence/race-before-fix.log`, exit 1).
- **After the fix:** 7 of 7 passed (`race-after-fix.log`, exit 0).

The web page was **not** silent on that 409. `useRunner` → `FormAlert` already renders a `role="alert"` `data-state="conflict"` banner and re-fetches the exception (§3, now covered by a test). In the failed run the 409 itself was the defect: the page showed the conflict and the reloaded state stayed `open`, which the spec read as "acknowledge did nothing". I found no other cause.

## 2. The design chosen, and why

I chose the second option in the assignment. **acknowledge and resolve accept an If-Match version that is behind the current one only by system occurrence updates.** The rule is `rebaseOverSystemOccurrences` in `apps/api/src/modules/operations/exceptions.ts`. It runs under the row lock, after the commit-time authorization re-check:

- `expectedVersion === version`: the action proceeds as before.
- `expectedVersion` is not an integer, is below 1 or is above the row's version: **409** `version_conflict` (the shared problem, with `currentVersion`).
- Otherwise the action is accepted only if **every** history row in `operational_exception_event` with `expectedVersion < record_version <= version` exists (no gap) and has `event_kind = 'recurred'` with `actor_user_id IS NULL`. Anything else is **409**: a human `acknowledged` or `resolved`, an automatic `recovered` resolution (`resolved`, no user), or an `updated` event.
- When it is rebased, the action applies to the current row. Its audit event records:
  - the **true** `prior_version` (the locked row);
  - `new_version`;
  - `changes.based_on_version = { from: <loaded version>, to: <version it was applied to> }`.

**Why this design, not a separate occurrence counter outside the version:**

1. **ADR-0003 and the 0010 guards:** every update must step `version` by exactly 1 and have an audit event with that `new_version` at commit.
2. **The 0101 history:** `operational_exception_event` is keyed by `UNIQUE (operational_exception_id, record_version)`, and the trigger writes one row per update.

Taking recurrences out of the version would need a forward-only migration that changes the guard and the history keying, plus every reader of `record_version` (the page's event table, the tests and probes). The chosen rule changes no table, trigger or guard. The audit trail keeps one event per occurrence (`operational_exception.recurred`, prior → new) and one per human action (prior → new, plus `based_on_version`).

**Why it is safe:**

- A recurrence changes only the occurrence fields: `occurrence_count`, `last_occurred_at`, `last_error_code`/`message` and `operational_failure_id`. It never changes `status`, the acknowledgement or the resolution. The 0101 history trigger classifies an update as `recurred` only when the status did not change.
- So the state the human acted on (open, or acknowledged) is still the state being changed. The state-machine refusals (`operations.exception_not_open`, `operations.exception_resolved`) still run after the rebase.
- **A human-vs-human conflict stays 409**, because a human action is always an `acknowledged` or `resolved` event. That holds even when it is mixed with recurrences in either order.

**Every raiser is covered**, because the rule lives where the human acts and reads the history, not the raiser. Covered: the API heartbeat watch, the worker job-failure hook (including automation queues and starter 16's job failures), the connector consumer (worker twin) and the `data_stale` raisers (the API service and the worker freshness scan through the twin). All of them recur through `raiseOperationalException` or `raiseOperationalExceptionTwin`, which write `recurred` with `updated_by = NULL`. The worker has no acknowledge or resolve path, so no twin change was needed. The test covers the heartbeat watch, the job hook (automation queue), the connector twin and the `data_stale` service.

## 3. Changed files

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/operations/exceptions.ts` | `rebaseOverSystemOccurrences` (the rule above) and `basedOn` (the audit field), used by `acknowledgeException` and `resolveException` in place of the strict `version !== expectedVersion` check. Doc comments updated. |
| `apps/api/test/integration/operations/exception-recurrence-race.test.ts` (new) | 7 integration tests on the real PostgreSQL: (1) the D-213 heartbeat watch race (acknowledge after a tick, resolve after a second tick, audit trail and `based_on_version`); (2) the same rule for the job hook (automation queue), the connector twin and the `data_stale` service; (3) the controls, all 409 with nothing written: human vs human, a human change mixed with recurrences in either order, an automatic recovery after the load, a version ahead of the row. |
| `apps/web/src/pages/admin/operations/exception-conflict.test.tsx` (new) | 4 web tests (en LTR, ar RTL; acknowledge and resolve). On a 409 the page shows one `role="alert"` `data-state="conflict"` alert with `problems.version_conflict` and `myWork.ui.conflictReloaded` in the page language. It also re-fetches the exception and shows its current state: acknowledged by the other administrator with no Acknowledge action, or resolved and final with no action. |
| `e2e/a22-p6-operability.spec.ts` | The race is forced, not left to the clock. After the exception page loads, the exception's last occurrence is aged by 61 s (superuser, replica role, the same technique the spec already uses for heartbeats). The spec waits until the API watch has recurred it (`occurrenceCount` and `version` above the loaded ones, still `open`). The administrator then acknowledges from the stale page, and the spec asserts that the page's `If-Match` was **below** the recurred version, so the race really ran. No assertion was removed or weakened. The budget is now `300_000` ms, re-measured (§5). |
| `docs/api/openapi.yaml` | The `acknowledgeOperationalException` and `resolveOperationalException` **summaries** state the If-Match rule. Schemas, responses and the operation count (932) are unchanged. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z6-backend-workflow-engineer.md`, `…/T-DG6-BE-Z6-evidence/*` | This handback and its logs. |

**Ownership notes for the orchestrator:**

- `apps/web/src/pages/admin/operations/**` belongs to the frontend (FE-B), and `e2e/**` to qa-verifier.
- **No web page file was changed.** The page already met item 2. I only added a separate test file in that folder and did not edit FE-B's `p6-admin-screens.test.tsx`. The frontend owner has nothing to change.
- The e2e edit was required by item 3 of the assignment. The write guard allowed it.

## 4. Behaviour delivered, per requirement row

- **REQ-S12-019.** Acceptance: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*. Function: *"An exception is shown to admins and data owners; values display as Stale with last update time"*.
  - Unchanged: one exception per source and class, the KPI panel and the freshness labels. The suites `exception-last-known-value`, `freshness-scan`, `run-failure-kpi-links`, the worker's `operations-freshness` and `connector-failure-exception` all pass (§5).
  - New: an administrator or data owner can acknowledge or resolve that exception even while its source keeps failing and recurring it. Before this change, any recurrence between loading the page and acting gave a 409.
- **REQ-S20-022.** Acceptance: *"A22: Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated"*.
  - `e2e/a22-p6-operability.spec.ts` now demonstrates the heartbeat → `heartbeat_missed` → acknowledge → resolve path **with** the watch recurring between the page load and the acknowledgement. It passed 10 of 10 under `--repeat-each=5` plus 2 of 2 after the budget edit.
  - The API-level A22 test (`tests/qa/integration/a22-p6-operability.test.ts`) passes unchanged.

**The rules the assignment restates:**

- **Optimistic concurrency.** A stale version is 409 unless only system recurrences intervened; a missing If-Match is still 428.
- **Authorization.** It is still re-checked at commit, inside the transaction after the row lock and **before** the version rule, so a refused caller learns nothing from it. The existing AUD 403 and scope 404 tests are unchanged and pass.
- **Validation** is unchanged.
- **Audit.** There is one event per human action with its prior and new version, and one per occurrence. Each case has a positive and a negative test.

## 5. Checks run (real exit codes)

All commands ran from the worktree with Node 24.21.0, offline, on harness ports 30100–30149. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z6-evidence/`.

| Command | Exit | Result |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` (`validate-dg5.log`) |
| `QA_PG_PORT=30101 … tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/operations/exception-recurrence-race.test.ts` with `exceptions.ts` from `HEAD` (before the fix) | 1 | 5 failed, 2 passed: the 409s of §1 (`race-before-fix.log`) |
| the same, with the fix | 0 | 7 passed (`race-after-fix.log`) |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm -r typecheck` (final tree) | 0 | `typecheck.log` |
| `pnpm lint` (final tree) | 0 | `eslint . --max-warnings=0` (`lint.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | 0 | "All matched files use Prettier code style!" (`format.log`) |
| `pnpm openapi:lint` (final tree) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (`openapi.log`) |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 190 files / 2899 tests passed; unit-web 121 files / 2054 tests passed; unit-formula-nocodegen 3 files / 259 passed, 2 skipped (`unit-unset.log`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts (`unit-cutf8.log`) |
| `QA_PG_PORT=30100 MTH_PORT_POOL=30101-30109 tests/qa/support/with-pg.sh npx vitest run --project integration <the 21 files below>` | 0 | **21 files, 316 tests passed** (`integration-touched.log`) |
| `QA_PG_PORT=30110 E2E_PG_PORT=30110 E2E_API_PORT=30111 MTH_PORT_POOL=30112-30149 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts --workers=1 --repeat-each=5` (root stack) | 0 | **10 passed** (5 chromium-en, 5 chromium-ar), 2.0 min each, 20.0 min in total (`a22-repeat5.log`) |
| the same spec after the budget edit, `--workers=1` (ports 30120–30149) | 0 | 2 passed (en, ar), 2.0 min each (`a22-final.log`) |

**The 21 integration files:**

- **API, `apps/api/test/integration/`:**
  - `operations/` (all 5 files: `exceptions`, which includes the heartbeat route and watch; `exception-recurrence-race`; `exception-last-known-value`; `freshness-scan`; `service-identity-scope`);
  - `integrations/runs`, `integrations/run-failure-kpi-links`;
  - `automation/automation-failures`, `automation/automation-rules`;
  - `jobs/job-operations`;
  - `tasks/channel-fanout`;
  - `hardening/integrity-sweep`;
  - `contract/contract` (acknowledge and resolve through the validating client).
- **Worker, `apps/worker/test/integration/`:** `connector-failure-exception`, `heartbeat`, `operations-freshness`, `automation-failure-queue`.
- **QA and database:** `tests/qa/integration/a22-p6-operability`, `tests/qa/integration/a13-starters-run`, `packages/db/test/integration/catalogue`.
- The worker `operations` handler unit suite (`apps/worker/src/handlers/operations.test.ts`) runs in `pnpm test`, unit-node, and passed.

**e2e budget (F-DG5-145/146/151 class):**

- The forced recurrence waits for one more 60 s watch tick, so a run takes about 2.0 min instead of the earlier measured worst of 84 s. That is under 123 s given the reporter's 0.1 min rounding.
- The measurement was taken under load: the unit and integration suites were running at the same time on this 4-CPU host.
- 2 × 123 s = 246 s, so the budget went from 240 s to **300 s**, and the spec comment cites `a22-repeat5.log`.

**Disclosures:**

1. **Overwritten log.** My first before-fix run had 2 test-fixture errors besides the 409s: a queue name with a digit (the 0074 letters-only rule) and a missing `source` on the twin actor. I fixed the fixtures and re-ran the corrected test against the unfixed code. `race-before-fix.log` is that second, clean run; the first log was overwritten.
2. **Formatting during the e2e run.** While the `--repeat-each=5` run was going, I ran `prettier --write` on the spec (one line wrapped differently, whitespace only). Playwright had already loaded the file.
3. **Budget edit after the measurement.** After the 10-run measurement I changed only the budget constant and its comment, then re-ran the spec once per locale (`a22-final.log`, 2 passed).
4. **Full suites.** The full `pnpm test:integration` and the full e2e suites were not run here, as the assignment says. The orchestrator runs them on the merged tree.

## 6. Operations routed (pending-list delta)

**None.** No operation was added or routed. `p6-pending-*` and `p6-exercises-*` are unchanged, and `contract.test.ts` passes with the same pinned counts (932 operations).

## 7. Contract, schema, migration and dependency needs (for the orchestrator)

- **Migration:** none. No table, trigger, guard or grant changed.
- **Dependency:** none.
- **Contract:** `docs/api/openapi.yaml` changes only the two summaries above. There is no schema, response or problem-code change. The 409 is still the shared `VersionConflict`.
- **Audit diff:** a new optional key `changes.based_on_version` (`{from, to}`) appears on `operational_exception.acknowledged` and `operational_exception.resolved`, only when the action was rebased.
- **For the architect (ADR-0053 §2 amendment):** please record the If-Match rule of §2 and `based_on_version` in ADR-0053 §2 ("Every mutation … If-Match (409/428)") with an "as shipped" note. ADR files are outside my write scope, so I did not edit it.

## 8. User-facing texts made untrue

**None.** No en/ar string or operations document described a recurrence as a reason for a conflict. The conflict texts the page shows (`problems.version_conflict`, `myWork.ui.conflictReloaded`, both en and ar) remain true for a real human-vs-human conflict.

## 9. What remains

- **In my scope:** nothing.
- **For the orchestrator:** the full verification on the merged tree (D-213 "Then"), including the root e2e run where the failure first appeared, and the ADR-0053 note in §7.
