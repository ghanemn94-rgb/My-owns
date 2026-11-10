# Handback T-DG6-BE-K2 — catalogue triggers, starter 16 version 2, the freshness scan, KPI links, error alerts

- **Agent:** backend-workflow-engineer (project agent), stage DG6 (BUILDING), task T-DG6-BE-K2.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-K2-backend-workflow-engineer-20261029T195645Z-b75d0a07","session_id":"b75d0a07-a6b7-4b77-ab2b-2e7f3774e2f2"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-K2.md` (sha256 `bd2827c3ec1ec4cdf28d8f229b8bc67254ad181d56cb8b1e66e307a7868b0595`, verified before starting).
- **Binding scope:** `docs/architecture/p6-work-split.md` §J/C.4 and §2; ADR-0053 §2, §3, §6 (§1 for identities); ADR-0044 §1; ADR-0028 (read only, unchanged); D-193 to D-196 read.
- **Base:** branch `dg6/be-k2` at `b5b33a33144b603a235faac15dd6fcb6aecca3af`, clean tree at start. All changes are **uncommitted**, as instructed.
- **Time:** `date -u` at the start: `Thu Oct 29 19:57:11 UTC 2026`; at the end: `Thu Oct 29 21:53 UTC 2026` (§8).
- **No business approval.** Nothing here grants, records or implies a G1–G6 business, Finance or IT approval. Acknowledging an operational exception is not a business approval. Nothing reads or writes DG0–DG7. Every test datum is SYNTHETIC.

## 1. Changed files

| File | Status | Purpose |
|---|---|---|
| `packages/db/migrations/0116_p6_operations_triggers_freshness.sql` | new | (1) Adds catalogue triggers `connector.run_failed` and `data.stale`. (2) Redefines the 0074 starter version guard, with one clause changed (§5.1). (3) Seeds starter 16 version 2 and supersedes v1, every change audited. (4) Adds the `kpi.freshness_scan` and `operations.exception_alerts` schedules, plus three job service identities. |
| `apps/worker/src/handlers/operations.ts` | stub → implemented | `kpi.freshness_scan`, `operations.exception_raise` (the `data.stale` consumer, wrapped as starter 16) and `operations.exception_alerts` (the ADR-0053 §6 alert: log line + in-app notification). Also `kpiFreshness`, the DG4 read twin. |
| `apps/worker/src/queues/operations.ts` | stub → implemented | The three queues; `data.stale` → `operations.exception_raise`. |
| `apps/worker/src/handlers/operations.test.ts` | new | Unit tests (no DB): registration, routing, identities, keys, payload contract, migration text. |
| `apps/worker/test/integration/operations-freshness.test.ts` | new | Worker integration test (own disposable DB): the section's test list (§2). |
| `apps/api/test/integration/operations/freshness-scan.test.ts` | new | API-level acceptance: the DG4 panel and `getOperationalException` after the real jobs run. |
| `packages/shared/src/schemas/events.ts` | shared, additive | `dataStaleV1` and `connectorRunFailedV1`, registered in `OUTBOX_EVENT_SCHEMAS` (needed by the relay and by the dry-run samples). |
| `apps/worker/src/kit.ts` | shared registration lines | Three `declare(...)` lines in `JOB_SERVICE_IDENTITIES` (45 queues now); two comment lines. No other line changed. |
| `apps/worker/src/queues/automation.ts` | shared, additive | `connector.run_failed` and `data.stale` added to `AUTOMATION_EVENT_TRIGGERS` (admin-selectable event triggers feed `automation.evaluate`). |
| `apps/api/src/modules/automation/samples.ts` | shared, additive | Builder samples for the two new triggers. Without them, the existing D-164 (d) rule "every trigger with a schema has a sample" fails. |
| `apps/api/src/modules/automation/outbox-registry.test.ts` | shared pin | New outbox write site `apps/worker/src/handlers/operations.ts` (1) and event type `data.stale`. |
| `apps/worker/src/service-identities.test.ts` | shared pin | Reads the 0116 identity table as well; pinned count 42 → 45. |
| `packages/db/src/seed.test.ts` | shared pin | Free-id example 0116 → 0117 (0116 is now shipped). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-K2-*` | new | This handback and its evidence logs. |

No OpenAPI, zod-mirror, `schema.ts`, `catalogue.test.ts`, `P6_OPERATION_IDS` or p6-pending change: §J/C.4 routes no operation.

## 2. Behaviour delivered, per requirement row

### REQ-S12-019 (shared with BE-K, BE-J, FE-B; slice B raises the connector classes)

- **Acceptance text (verbatim, `requirements.csv`):** "An exception is shown to admins and data owners; values display as Stale with last update time".
- **Test column:** "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date".
- **Section test list (§J/C.4):** a KPI whose last accepted actual is older than `staleAfterDays` → one `data_stale` exception linked to it, the KPI still showing Stale with its last value and date (unchanged DG4 response); fresh again → `recovered`; the trigger catalogue lists the two new triggers; starter 16 version 1 is unchanged history; one alert per open, none per recurrence.

What this task delivers, and where it is proven:

1. **Freshness scan (`kpi.freshness_scan`, hourly at minute 25, Asia/Riyadh).**
   - Per organization, through its service principal (`serviceReadScopeFor(principal, "transformation.read")`), it reads every active KPI the way the DG4 panel does: the newest evaluation of the latest open or closed period, with `withReadTimeStaleness` from `@mth/shared`, unchanged.
   - `stale` → one `data.stale` outbox event per stale episode (key `data.stale:<kpiId>:<dataAsOf>`, unique, so a re-scan writes nothing).
   - `fresh` with an active exception → resolved `recovered` (no user).
   - `unknown` → nothing.
   - **No KPI table is written.**
   - Proofs: `operations-freshness.test.ts` "a KPI older than staleAfterDays …" (the evaluation row is byte-identical before and after; one evaluation only) and "… fresh again → recovered".
2. **Exception and KPI link (`operations.exception_raise`, consumer of `data.stale`).**
   - Runs once per event (`runOnce` on the idempotency key).
   - Reads the KPI through the principal (`requireServiceRead`).
   - Opens or recurs `data_freshness:kpi:<id>:data_stale` under lock 730305 through the kit twin, with `service_identity_id`, and links the KPI in `operational_exception_kpi`.
   - A redelivered event → `duplicate`, nothing new.
   - It is wrapped with `withStarterRule("starter.job_failed")`, so each event is **one `automation_execution` of starter 16 version 2** (trigger `data.stale`, `succeeded`). Proven in the worker test.
3. **Stale with its last value and date, through the API.** `freshness-scan.test.ts`, after the real jobs:
   - the DG4 panel `GET …/kpi-definitions/{id}/status` answers `actual "0.4125"`, `actualStatus "stale"`, `freshness {status "stale", dataAsOf "2026-01-15", staleAfterDays 30}`;
   - `listOperationalExceptions` lists exactly one `data_stale` exception for the KPI;
   - `getOperationalException` shows `linkedKpis[0]` `{freshness "stale", lastValue "0.4125", lastValueAt "2026-01-14T21:00:00.000Z"}` (the start of the business date in Asia/Riyadh) and events `["opened"]`;
   - the auditor reads it (200) and is refused the acknowledgement (403);
   - fresh data → `resolved`/`recovered`, and the panel shows `"0.43"`/`fresh`.
4. **"Shown to admins and data owners" (ADR-0053 §6 alerts, `operations.exception_alerts`, every minute).**
   - Once per opened exception (`processed_message` `operations.exception_alert`, keyed by exception id; any raiser: the kit hook, this consumer, the API heartbeat watch, slice B):
     - one in-app notification to each active `operations.acknowledge` holder (org-level holders, or every organization's holders for a platform exception; plus holders at a linked transformation), dedupe `operational_exception:<id>:opened:<userId>`, `messageKey` `operations.exception_opened`, params `{failureClass, sourceKind, sourceCode}`, link `/admin/operations/exceptions/<id>`;
     - after commit, one `level: error`, `alert: true`, `alertCode: <failure class>` log line.
   - A recurrence never alerts. `heartbeat_missed` gets no second log line (the API watch already writes it).
   - AUD (read only) gets nothing.
   - Proofs: worker test "one alert per open, none per recurrence …" and "platform exceptions …"; API test (the admin's `GET /api/v1/me/inbox` carries the alert).
5. **Catalogue triggers.** `connector.run_failed` (event, `integrations`, `{connectorId, failureClass}`) and `data.stale` (event, `kpi`, `{kpiId}`), both admin-selectable, `source_ref` M0239, both fed to `automation.evaluate`, both with registered v1 payload schemas and builder samples. Proof: worker test "lists connector.run_failed and data.stale …".
6. **Starter 16 version 2.**
   - v2: published and effective, triggers `{job.failed, connector.run_failed, data.stale}`, handlers `["jobs.failure_capture", "operations.exception_raise"]`, still a guarantee (enabled, not disableable).
   - v1: content and hash unchanged, now `superseded` (published history).
   - Three audit events: `automation_rule_version.create`, `automation_rule.effective_version`, `automation_rule_version.supersede`.
   - Proof: worker test "version 1 is unchanged published history …". The existing `starters.test.ts` (25/25) and the QA `a13` rule "each starter runs its effective version" are unaffected.
7. **Least privilege.**
   - Each new queue has its own identity, declared in `kit.ts` and seeded by 0116: `kpi.freshness_scan` and `operations.exception_raise` hold `transformation.read` and `operations.read`; `operations.exception_alerts` holds `operations.read` and `access.read`. All three are `sensitive_access none`, read codes only.
   - A narrowed grant fails the scan with `service_identity.out_of_scope`, and restoring it lets it run. Proof: worker test "a narrowed grant …".

Not mine, and not claimed: the **connector** half of A17 (a failing test connector producing a `connector_*` exception linked to its KPIs) is slice B (ADR-0053 §2 table: "raised by the connector run (ADR-0055, BE-L)"); see §6, item 2.

## 3. Checks actually run

Environment:
- Node 24.21.0, pnpm workspace as installed, offline.
- Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`, `QA_PG_PORT=24900`, `MTH_PORT_POOL=24901-24949` (my range).
- The host ran other W9 agents in parallel: load average 12–20 on 4 cores.

Logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-K2-evidence/`.

Exit codes are the commands' real ones; the log for each is in the evidence directory.

| # | Command | Result | Log |
|---|---|---|---|
| A4 | `node tools/gates/validate.mjs --historical --stage DG5` (at the start, 19:57Z) | **exit 0**, "PASS gate DG5 (historical)" | `validate-historical-DG5.log` |
| A4 | the same, at the end (21:35Z) | **exit 0**, "PASS gate DG5 (historical)" | `validate-historical-DG5-final.log` |
| A1 | `pnpm -r typecheck` (final round, finished 21:24:58Z) | **exit 0** | `typecheck.log` |
| A1 | `tsc -p apps/worker/tsconfig.json` (re-run for the two worker edits made at about 21:23Z, see below) | **exit 0** (finished just after the handback was written) | `typecheck-worker-final.log` |
| A1 | `pnpm -r build` (21:37:33Z) | **exit 0** | `build.log` |
| A1 | `pnpm lint` (21:41:56Z) | **exit 0** | `lint.log` |
| A1 | `pnpm openapi:lint` (21:42:01Z) | **exit 0** | `openapi-lint.log` |
| A1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (21:50:31Z) | **exit 0** | `prettier-check.log` |
| A2 | `pnpm test` with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **exit 1** (details below) | `unit-unset.log` |
| A2 | `pnpm test` with `C.UTF-8` | **NOT RUN** (time limit) | — |
| A3 | `QA_PG_PORT=24900 MTH_PORT_POOL=24901-24949 tests/qa/support/with-pg.sh pnpm test:integration` | **NOT COMPLETED**: stopped by the background time limit at about 22:09Z, with no exit code; 144 of 346 files reported (partial results below) | `integration.log` |

**Static-check timing.** The first static round (20:21Z) failed `pnpm -r typecheck` (exit 2) on two `insertAuditEvent` calls in my new worker test that lacked `organizationId`; I fixed it. In the final round, `pnpm -r typecheck` ran 21:14–21:24:58Z. Two worker files changed at about 21:23Z (`queues/index.ts`: one map line moved; `handlers/operations.test.ts`: one assertion). The build (to 21:37Z), lint, openapi lint and prettier check all ran after those edits and exited 0. The targeted worker `tsc` re-run then exited 0.

**`pnpm test`, locale unset (exit 1).** Three Vitest invocations:
- **unit-node:** 168 of 169 files and 2619 of 2620 tests passed. One failure, `packages/shared/src/adoption/measures.test.ts` ("aggregation is the weighted ratio…"), was a 5 s timeout, plus 2 Vitest RPC "Timeout calling onTaskUpdate" errors. **Re-run alone: 24/24, exit 0** (`unit-measures-rerun-alone.log`). That package is unchanged by this task.
- **unit-web:** 85 of 98 files and 1770 of 1787 tests passed; 13 files and 17 tests failed. The causes: 11 "Test timed out" (20 s and 5 s), 2 RPC timeouts, and 4 "Unable to find …" lookups (findBy timeouts).
  - **This task changes no file under `apps/web`** (`git status --porcelain apps/web` is empty).
  - A re-run of the 13 files alone (`unit-web-failed-files-rerun-alone.log`; file list in `unit-web-rerun-files.txt`;

    load average 24–26 at the time) exited 1: 7 files passed; 6 files and 8 tests still failed, every one a Testing Library

    "Unable to find role=… name …" lookup (session-end, p2-blank-forms, render-time-language, portfolio/fe-e,

    traceability en+ar, transformations en+ar). **UNRESOLVED.** No web file is changed here, but that is not proof the

    failures are load-only; they need a re-run on an unloaded host or on the merged tree.
  - The host ran at load average 12–20 on 4 cores, with this task's integration suite and other W9 agents in parallel.
- **unit-formula-nocodegen:** 3 of 3 files; 259 passed, 2 skipped.

**Integration suite (not completed).** It ran serially (346 files, single fork) from 20:35Z. By 21:52Z, 108 files had reported:
- `packages/db/test/integration/catalogue.test.ts` 35/35 and `apps/api/test/integration/contract/contract.test.ts` 101/101 passed (the latter includes the P5 BE-J starter exercises on this tree).
- Six files had failures:
  1. **`apps/worker/test/integration/adoption-below-trajectory.test.ts` (1 failed): CAUSED BY THIS TASK, FIXED.**
     - The D-102 rule requires that an admin-selectable event has at most one domain consumer, with the engine **last**. `data.stale` came out as `[automation.evaluate, operations.exception_raise]`.
     - Fix: `OPERATIONS_EVENT_QUEUES` is registered before `AUTOMATION_EVENT_QUEUES` in `queues/index.ts` (the `PORTFOLIO_EVENT_QUEUES` precedent).
     - Re-run of that file and mine, alone: **14/14 and 7/7, exit 0** (`rerun-after-queue-order-fix.log`, port 24910).
  2. `apps/api/test/integration/forms/form-records.test.ts` (1, 60 s export timeout), `request-io.test.ts` (3, stalled-upload timings) and `blank-text.test.ts` (1, 40 s): **re-run alone, 3 files, 57/57, exit 0** (`rerun-load-failures-alone.log`, port 24920). These are load timeouts in modules this task does not touch.
  3. **`apps/api/test/integration/contract/response-validation.test.ts`, 7 of 109 failed (health; P3 BE-D; P5 BE-J; U+0000 query; undeclared media type; live 429; "covers every operation"): UNDETERMINED.**
     - Vitest prints the failure messages only when the whole run ends, which it had not.
     - Several are 30 s timeouts, and D-201 records earlier load timeouts in this file.
     - The same P5 BE-J exercise passed in `contract.test.ts` on this tree.
     - **Not claimed as load-only:** it must be re-run on the merged tree before it is attributed.

**Targeted runs of this task's own tests** (disposable PostgreSQL 16.15, ports 24900/24910):
- `apps/worker/test/integration/operations-freshness.test.ts`: **7/7, exit 0** (`worker-operations-freshness-integration.log`; again in `rerun-after-queue-order-fix.log`).
- `apps/api/test/integration/operations/freshness-scan.test.ts`: **3/3, exit 0** (`api-freshness-scan-integration.log`).
- `apps/worker/test/integration/starters.test.ts` (existing; with 0116 applied): **25/25, exit 0** (`worker-starters-integration.log`).
- Unit: `apps/worker/src/handlers/operations.test.ts` 8/8, `service-identities.test.ts` 6/6, `packages/db/src/seed.test.ts` 68/68, `apps/api/src/modules/automation/*.test.ts` 23/23 (all exit 0). These ran in the terminal; the counts are also in the suite logs above.

**Pinned-count changes for the orchestrator:**
- `JOB_SERVICE_IDENTITIES` 42 → 45;
- `seed.test.ts` free-id example 0116 → 0117;
- `outbox-registry.test.ts` +1 write site (`apps/worker/src/handlers/operations.ts`) and +1 event type (`data.stale`).

No contract count changes (operations, media types, rate-limit floor, CSRF-exempt routes).

## 4. Operations routed (pending-list delta)

None. §J/C.4 assigns no operation; there is no `p6-pending-be-k2.ts` or `p6-exercises-be-k2.ts`. Contract pins are unchanged: no operation, media type, rate-limit or CSRF change. The served automation catalogue (an existing operation) now returns two more triggers, which is data, not a contract change.

## 5. For the orchestrator: design points, shared files, contract and dependency needs

1. **The P5 starter guard is redefined (0116, `CREATE OR REPLACE FUNCTION automation_rule_version_guard`).**
   - Why: 0074's starter clause pinned every starter version to **version 1's** trigger set, so ADR-0053 §3's version 2 could not be inserted, even by a migration.
   - The function text is 0074's, copied mechanically, with **one** clause changed:
     - The set a starter keeps is that of its latest version that ran (published or superseded) below the new one.
     - Only the owner role (a migration) may seed a version that **adds** triggers to it.
     - The set is checked when it is written (insert, or an update that changes it).
   - For every starter with only version 1, the rule is exactly 0074's.
   - It now agrees with the API, which already compares with the current content (`versions.ts validateContent`). Without the change, an API draft of starter 16 v3 (copying v2) would be refused.
   - Every 0074 constraint name is kept (pinned by `operations.test.ts`).
   - Proven: an application insert that adds a trigger, or drops back to `{job.failed}`, → `automation_rule_version_starter_fixed`; one that keeps v2's set is accepted.
   - **Reviewer attention requested:** this changes a DG5-approved function, additively for migrations only.
2. **`connector.run_failed` and starter 16.**
   - The trigger, its schema `{connectorId, failureClass}` (ADR-0053 §3's condition fields) and its `automation.evaluate` route exist.
   - ADR-0053 §2 has the connector run raise its own exception, so I route `connector.run_failed` **only** to `automation.evaluate`. A second consumer that also raised would double-count.
   - Consequence: v2 names `connector.run_failed`, but no execution of starter 16 is recorded for it until slice B wraps a consumer of it with `withStarterRule("starter.job_failed")`, or records it in the run.
   - **Question for BE-L2/ARCH-03:** emit `connector.run_failed` with exactly `connectorRunFailedV1` `{connectorId, failureClass}` (a strict object; failure classes `connector_run_failed | connector_unreachable | connector_credentials_rejected`), and decide that recording.
3. **Alerts are a one-minute sweep, not inline.** This covers every raiser (the kit hook, the API heartbeat watch, slice B) without editing their files, at up to one minute of latency. Exceptions opened more than 24 h before the sweep are not alerted (the start-up backlog bound). Recipients include holders at a **linked transformation** (ADR-0053 §9 lets them acknowledge it); ADR-0053 §6 names org-level holders. Please confirm.
4. **Stale-episode semantics.** One `data.stale` per (KPI, `dataAsOf`). A manually resolved exception for KPI data that is still stale is not reopened until new (still old) data arrives. A new stale episode while the exception is active **recurs** it (count +1, no alert).
5. **Migration id.** `0116` (the next above 0115 on this branch, D-196). On renumbering, update the two path literals in `apps/worker/src/service-identities.test.ts` and `apps/worker/src/handlers/operations.test.ts`, and the free-id example in `packages/db/src/seed.test.ts`. The row ids `01920006-0116-…` are plain UUIDs and can stay.
6. **Shared-file overlaps to reconcile at merge** (all additive): the `kit.ts` `JOB_SERVICE_IDENTITIES` lines (count 45, mine +3); `queues/automation.ts` `AUTOMATION_EVENT_TRIGGERS` (+2); `events.ts` (+2 schemas); `automation/samples.ts` (+2); `outbox-registry.test.ts` (+1 site, +1 type); `service-identities.test.ts` (migration list, count); `seed.test.ts` (free-id example).
7. **Logger.** `setOperationsAlertLogger` lets `apps/worker/src/main.ts` (DO-D) pass its redacting pino instance. Until it does, the alert line is a JSON line on stderr carrying `level`, `time`, `msg`, `alert`, `alertCode`, `exceptionId`, `organizationId`, `sourceKind`, `sourceCode`, `queue`, `jobId` and `serviceIdentity`. It carries no secret, URL or path.
8. **No dependency** added. No contract or schema.ts change. No new problem code.

## 6. User-facing texts

- **Made untrue by this work:** none found. A search of the en/ar web catalogues and API texts for exceptions, stale data, freshness, alerts or connectors described as planned or later found nothing.
- **Missing text, for FE (FE-A/FE-B own `apps/web/src/i18n/{en,ar}/myWork.json`):**
  - `myWork.message.operations__exception_opened`. Proposed en: "Operational exception opened: {{failureClass}} on {{sourceCode}}". Arabic: provisional.
  - Until added, the inbox shows the generic `myWork.message.fallback` text, which is true but unspecific.
- The two trigger labels are bilingual in the database: "Connector run fails" / "إخفاق تشغيل موصل" and "KPI data becomes stale" / "تقادم بيانات مؤشر الأداء". The Arabic is provisional, as for every P5/P6 label.
- The exception's `last_error_code` is `kpi.stale` (BE-K's test uses the same code). If FE-B renders it through `problems.*`, the key `problems.kpi__stale` is needed.

## 7. What remains

1. **`pnpm test` with `C.UTF-8`: not run** (time limit). It must run on the merged tree.
2. **The full integration suite: not completed** (stopped at about 22:09Z; 144 of 346 files reported, with no failure after the five files listed in §3). The orchestrator's merged-tree run must cover the rest, and must settle `response-validation.test.ts` (7 failures, cause undetermined, §3).
3. **Unit-web: 6 files (8 tests) still failed when re-run alone, under load average 24–26** (§3). This task changes no web file, but that is not proof. Re-run them on an unloaded host or on the merged tree before attributing them.
4. The targeted worker `tsc` re-run exited 0 (`typecheck-worker-final.log`).
5. **Not in this task's scope, open for others:**
   - slice B emits `connector.run_failed` and decides its starter-16 recording (§5.2);
   - FE adds `myWork.message.operations__exception_opened` (en/ar) and, if rendered, `problems.kpi__stale` (§6);
   - DO-D may pass the redacting logger through `setOperationsAlertLogger` (§5.7).
6. **Decisions requested:** the guard amendment (§5.1), the alert recipients at linked transformations (§5.3) and the stale-episode semantics (§5.4).
7. **Separable second half:** none. Every §J/C.4 item is implemented and tested: the triggers, starter 16 v2, the freshness scan, the KPI links, the error alerts, the queue, and the handler tests.

## 8. End

- `date -u` at the end: `Thu Oct 29 21:53 UTC 2026` (about 116 minutes after the start).
- Background runs still active when I stopped (they write only into the evidence directory): the integration suite (`integration.log`). Their logs may grow after this handback was written. The results quoted above are those observed at 21:52Z.
- **Merge instructions:** apply migration `0116` (or the next free id at merge, §5.5) after 0115. There is no data migration and no backfill. Expect overlaps only in the shared registration lines listed in §5.6. Leave the changes uncommitted until the orchestrator integrates them.
