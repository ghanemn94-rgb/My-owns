# Handback T-DG6-BE-X2: pre-freeze repair of QA-A findings F-DG6-QA-A-1/-2/-3 (backend-workflow-engineer)

- **Stage:** P6, gate DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §B/A.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-X2-backend-workflow-engineer-20261030T211128Z-5e06a54e","session_id":"5e06a54e-efae-457b-a375-02b799808028"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-X2.md`, sha256 `c97be9d95e48a99bc69a90c6b4d9d23e8a3aecd638de7e36f7123eb5a6acca04` (verified with `sha256sum`).
- **Tree:** worktree `/home/user/wt/dg6-be-x2`, branch `dg6/be-x2`, `HEAD` = `fb4dfe173` at the start and at the end. The changes are **uncommitted**, as asked.
- **Time:** started `2026-10-30T21:11:41Z`; end time in §9.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (run first, before any edit).
- **Migrations:** none. **New dependency:** none. **Operations routed:** none (all three findings concern routes that already exist).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/server.ts` | **F1:** the composition line `setConnectorSecretProviders(secrets)` directly after `registerBuiltInSecretProviders(...)`, plus its import. The integrations module now resolves webhook signing secrets and connector credential references through the process's SecretProvider registry. |
| `apps/api/src/modules/integrations/runs.ts` | **F2:** `kpisFedBy(db, connector, config)` (the KPIs a run of the connector feeds; see §2) and the `kpiLinks` field on the `connector.run_failed` outbox payload, computed inside the run's failing transaction (database reads only, no remote I/O). |
| `apps/api/src/modules/integrations/adapters/test-adapter.ts` | **F2:** `testAdapterFixtureRows(config)`, the rows the test adapter's fixture defines whatever its mode (no network; an unreadable fixture gives `[]`). |
| `packages/shared/src/schemas/events.ts` | **F2:** `connectorRunFailedV1` gains the **optional** `kpiLinks: [{kpiDefinitionId, transformationId}]` (≤ 100). `schemaVersion` stays 1, and an event written before this change still parses (no links). |
| `apps/worker/src/handlers/integrations.ts` | **F2:** `handleConnectorException` passes `kpiLinks: p.kpiLinks ?? []` to `raiseOperationalExceptionTwin`, so it still raises exactly one exception per failure. The worker reads no KPI record: its job identity `job:integrations.connector_exception` stays `declared = granted = {}` (0116). Header comment updated. |
| `docs/api/openapi.yaml` | **F3:** on `receiveWebhook` only: a `requestBody.description` documenting the accepted item keys, and an `example`. The shared `WebhookDelivery` component and every other operation are unchanged (BE-X1 is editing the evidence-content operation at the same time). |
| `apps/api/test/integration/integrations/secret-composition.test.ts` (new) | **F1 test** through the real `buildServer` composition. It never calls `setConnectorSecretProviders`: the registry is the one `buildServer` creates with the built-in `env` provider. 3 tests. |
| `apps/api/test/integration/integrations/run-failure-kpi-links.test.ts` (new) | **F2 tests:** the KPIs on the event (fixture through field mappings; staged history; target `none`; other-transformation, unknown and non-id values never linked), and the worker's production consumer (one exception, its link row, `getOperationalException`, redelivery adds nothing). 5 tests. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X2-evidence/**` | Logs cited below. |

QA-A's tests (`tests/qa/**`, `e2e/a17-*.spec.ts`) are not edited. A temporary diagnostic copy (§4) was created and deleted within one command.

## 2. Behaviour delivered, per requirement row

### REQ-S17-003: acceptance "A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected"; output "APIs and webhooks are documented in OpenAPI"

- **F-DG6-QA-A-1 (High) repaired.** `server.ts` now hands its registry to integrations. Before the fix, every signed delivery was refused as `secret_unresolvable` → 401.
  - QA-A's `a17-import-and-integration.test.ts > REQ-S17-003 … a correctly signed delivery is accepted (202), staged 10 = 8 + 1 + 1, and its 8 valid rows commit; a replay changes nothing` now **passes**, with the unsigned, wrongly signed, tampered and stale cases still refused with 401 (`evidence/qa-a17-targeted.log`, and the full run in §3).
- **The composition test** (`secret-composition.test.ts`) uses the real `buildServer` with no injected registry:
  1. Signed with another secret → 401 `webhook.unauthenticated` and no receipt. Correctly signed → 202 (`rowsTotal 1, rowsValid 1`), one receipt with `secret_slot current`, and no secret value in the response.
  2. A connector's credential view gives `resolvable: true` for a set variable and `false` for an unset one: never `null` ("no registry") and never a value.
  3. A test-connector run with a resolvable reference ends `succeeded`. With an unset reference it ends `failed` with `connector.secret_unresolvable`, naming the variable and never a value.
- **Mutation check:** with the composition line replaced by a comment, all 3 composition tests fail. The file was restored afterwards (`evidence/mutation-F1-composition-line-removed.log`, exit 1 as expected).
- **Worker composition checked for the same gap. Not present, nothing changed:**
  - The worker executes no connector run and resolves no connector reference. `grep -rn "credential_refs\|signing_secret" apps/worker/src` finds nothing.
  - Its `integrations.connector_run` job only creates queued cadence runs. The runs are executed by the API's run watch (`runs.ts` header, ADR-0002 rule 5).
  - `apps/worker/src/main.ts:57-62` already builds its own registry and passes it on (`resolveSecret`).
- **F-DG6-QA-A-3 (Medium) repaired in OpenAPI.** The `receiveWebhook` request body now documents:
  - item keys: the template's column keys exactly as `listImportTemplates` lists them (snake_case, the CSV/XLSX header keys), or the connector's field-mapping `source` names when mappings are configured;
  - for `kpi_actual.v1`, the required keys (`kpi_id`, `scope_kind`, `scope_id`, `period_label`, `data_as_of`) and the optional ones;
  - that the keys of all items together are checked as a header row: a non-column key such as `kpiId`, or a required key that no item carries, is 400 `webhook.payload_invalid` (pointer `/items`, cause `import.header_mismatch`);
  - string or null values, decimals as dot strings, and a JSON number as the row reason `import.row.value_not_decimal`;
  - plus an example body.

  `pnpm openapi:lint` → PASS, 932 operations.

**ADR-0056 §7 correction the architect must make (I did not edit the ADR).** In the "Body" bullet, replace the example
`{"templateVersion": "kpi_actual.v1", "items": [{"sourceRecordId": "…", "kpiId": "…", "scopeKind": "…", "scopeId": "…", "periodLabel": "…", "value": "12.5", …}]}`
with
`{"templateVersion": "kpi_actual.v1", "items": [{"source_record_id": "…", "kpi_id": "…", "scope_kind": "…", "scope_id": "…", "period_label": "…", "value": "12.5", "data_as_of": "YYYY-MM-DD", …}]}`,
then add: "Item keys are the template's column keys as `listImportTemplates` lists them (the CSV/XLSX header keys, snake_case), or the connector's field-mapping `source` names when mappings are configured. The keys of all items together are checked as a header row: a key that is not a column, or a required column that no item carries, refuses the body with 400 `webhook.payload_invalid` (cause `import.header_mismatch`)."

### REQ-S12-019: acceptance "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"

- **F-DG6-QA-A-2 (Medium) repaired in the product.** A connector's last failure now links the KPIs its run feeds (ADR-0053 §2 "connector classes: the KPIs the connector's mappings feed, ADR-0055"). `kpisFedBy` works as follows:
  - Only a `kpi_actual` connector with a target transformation feeds KPIs. Any other connector gets `[]`.
  - It collects the `kpi_id` column, after the connector's field mappings (`mapRows`), from:
    - (a) the rows the source defines without a network call (the test adapter's fixture, whatever its mode: the A17 default fixture uses `adapter_settings.kpiId`);
    - (b) the rows the connector staged in its newest 10 batches (run or webhook). This is what a failing `http_pull` source fed when it last answered.
  - It keeps only non-archived KPI definitions of the connector's organization **in its target transformation**. A row naming any other KPI is a row reason at staging and is never "fed". At most 100, ordered by id.
- **Where it runs:** the API computes it in the run's failing transaction (reads only) and writes it on the `connector.run_failed` payload. The worker's consumer passes it to the BE-K kit, which inserts `operational_exception_kpi` (unique per exception and KPI). One failure still gives exactly one exception: T-DG6-BE-K2S's `connector-failure-exception.test.ts` stays green in the full run (§3).
- **Tests** (`run-failure-kpi-links.test.ts`, 5/5 PASS, `evidence/new-suite-run-failure-kpi-links.log`):
  - the KPIs via mappings, case-insensitive, de-duplicated; the other transformation's KPI, an unknown uuid and `not-a-kpi-id` are not linked;
  - a stopped A17-default connector links its `kpiId`;
  - history: a healthy run, then version 2 failing with an empty fixture, still links the staged KPI;
  - target `none` links none;
  - the worker consumer: one open exception and one link row; `getOperationalException` read by a `transformation.read` holder shows `linkedKpiCount 1`, `hiddenKpiCount 0` and the KPI (last value null = Unknown, never 0); a redelivery is `duplicate` and adds nothing.

## 3. Checks actually run (exact commands, real exit codes)

Environment: Node 24.21.0, offline. Harness ports 26600–26649. Empty `.claude/.cc-writes` directories in source folders were removed before the test runs.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` | (console, before any edit) |
| 2 | `pnpm -r typecheck` | **0** | | `evidence/typecheck.log` |
| 3 | `pnpm -r build` | **0** | | `evidence/build.log` |
| 4 | `pnpm lint` | **0** | | `evidence/lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | | `evidence/prettier-check.log` |
| 6 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `evidence/openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | **1** | unit-node 182 files / 2762 passed; unit-web **1 failed** / 1936 passed (111 files); unit-formula-nocodegen 259 passed / 2 skipped | `evidence/unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | identical counts; the same **1 unit-web failure** | `evidence/unit-c-utf8.log` |
| 9 | `QA_PG_PORT=26600 MTH_PORT_POOL=26601-26649 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration <the two new files>` | 1, then **0** | First run: 2 test bugs of mine, fixed (a healthy fixture without the required `data_as_of`; a detail read with a session that cannot read the KPI). Then `secret-composition` 3/3 and `run-failure-kpi-links` 5/5 PASS. | `evidence/new-suite-run-failure-kpi-links.log` |
| 10 | same harness, `tests/qa/integration/a17-import-and-integration.test.ts a17-s01-005-external-change.test.ts` | **1** | 13 passed, **1 failed** (the F2 soft assertion, §4) | `evidence/qa-a17-targeted.log` |
| 11 | `QA_PG_PORT=26600 MTH_PORT_POOL=26601-26649 tests/qa/support/with-pg.sh pnpm test:integration` | see §3.1 | see §3.1 | `evidence/integration-full.log` |

**The unit-web failure (rows 7 and 8) predates this task and does not depend on it.** The test is `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx > … identity shows whether a client secret is configured, never a secret value`: it expects `document.querySelector("input, textarea")` to be null, but finds the shell's global-search `<input class="global-search__input">`.

- It fails in both locales, in the full run and alone.
- With the six tracked files I changed set back to `HEAD` content (`git show HEAD:<f> > <f>`, `git diff` empty), it fails the same way. My patch was re-applied afterwards; the diff's sha256 `2ffc03b9…3d82` was identical before and after (`evidence/unit-web-p6-admin-screens-at-base-HEAD.log`, `evidence/unit-web-rerun-p6-admin-screens-locale-unset.log`).
- I touched no `apps/web` file. It belongs to the owner of that test (FE; the global search came with slice H). I did not fix it ("change no other behaviour").
- **Disclosure:** my first attempt at this base check used `git checkout --`. The read-only worktree index refused it ("index.lock: Read-only file system"), so that run still had my changes. I noticed it and repeated the check with `git show` as described above.

### 3.1 Full integration run

Command: `QA_PG_PORT=26600 MTH_PORT_POOL=26601-26649 tests/qa/support/with-pg.sh pnpm test:integration`. **Exit 1.** 392 files: 8 failed, 384 passed. Tests: **6 failed, 3997 passed, 11 skipped, 2 todo (4016)**. Log: `evidence/integration-full.log`. No pinned count changed.

Every failure, classified:

| Failure | Cause | Evidence |
|---|---|---|
| 3 suites did not start: `health/health-schemes`, `kpi-p4/versions`, `integrations/import-staging` | **Environment:** `ENOSPC: no space left on device` on the shared `/dev/vda` while the run's harness wrote its evidence directory (other P6 tasks share the volume). Afterwards 13 GB were free. | **Rerun with my changes: all 3 PASS** (7 + 10 + 10 tests), `evidence/integration-rerun-6-files-with-x2.log` |
| `contract/response-validation`: "P5 BE-J operations" (`expected [] to have a length of 1`) and "an undeclared request media type …" (**30 s timeout**) | Order or load in the full single-fork run. Not reproduced in isolation. | **Rerun with my changes: 112/112 PASS** (same log) |
| `tests/qa/a12-p6-scope-isolation` "… 403 evidence.parent_forbidden on the download URL" | `downloadEvidenceContent` does not declare 403. This is the defect T-DG6-BE-X1 is repairing in parallel (assignment: "repairing the evidence-content 403"). | full-run log |
| `tests/qa/a17-import-and-integration` "failing connector …" | The F2 soft assertion read with ADM_TECH: §4 | `evidence/probe-F2-link-exists-hidden-for-adm-tech.log` |
| `admin/security` "getSecurityRateLimits … operations" | **Predates this task.** The test pins the `webhook` class's `operationIds` as `[]`, but the server lists `["receiveWebhook"]` (BE-N's route; that class's pin was never updated). It fails identically at HEAD content without my changes. | `evidence/integration-security-assistant-at-base-HEAD.log` (base: 2 failed / 23 passed), `evidence/integration-rerun-6-files-with-x2.log` |
| `assistant/conversations` "the rate-limit class `assistant` and the log line" | **Predates this task.** The expected log line has `dataItems 0`, `replyKind no_sources`; it gets `dataItems 1`. It fails identically at HEAD content without my changes. | same two logs |

With every failure accounted for, my changes break nothing that passes at HEAD. The QA-A A17 signed-webhook test (F1) now passes. T-DG6-BE-K2S's `apps/worker/test/integration/connector-failure-exception.test.ts` passes in the full run. My two new files pass in the full run (`secret-composition` 3/3, `run-failure-kpi-links` 5/5).

The owners of the pre-existing failures (orchestrator to route): `admin/security.test.ts` (BE-E's pin vs BE-N's route), `assistant/conversations.test.ts` (BE-T), and `p6-admin-screens.test.tsx` (FE).

## 4. F2: the one QA-A assertion that still fails, and why I did not make it pass

QA-A's `failing connector (REQ-S12-019, A17)` test reads the exception detail as `admin`, which in its world is ADM_TECH + ADM_ACCESS. Then it soft-expects `linkedKpis` to contain the stale KPI.

**Product state after the repair.** A diagnostic copy of the QA test, with three `console.log` lines added, was run once and deleted (`evidence/probe-F2-link-exists-hidden-for-adm-tech.log`). It shows:
- `operational_exception_kpi` holds exactly the stale KPI;
- the admin's detail: `{"linkedKpiCount":1,"hiddenKpiCount":1,"linkedKpis":[]}`;
- the same detail read by the transformation's auditor: `linkedKpis: [{…, "freshness":"stale","lastValue":"250.75","lastValueAt":"2026-01-30T21:00:00.000Z"}]`, `hiddenKpiCount 0`.

The rest of the scenario passes: exactly one exception, and the KPI panel shows Stale with 250.75 and 2026-01-31.

**Why the admin sees `[]`.** This is the existing read rule, which I did not change. Per ADR-0053 §2 and `operations/exceptions.ts` `exceptionDetail`, a linked KPI the caller cannot read (`transformation.read` at its transformation, the KPI panel's own gate) "only increase[s] `hiddenKpiCount`". ADM_TECH and ADM_ACCESS hold no `transformation.read` (`0005_seed_roles_permissions.sql` lines 100–107). Making this assertion pass with a product change would mean giving technical administrators KPI names, values and dates outside their read scope: an authorization change against ADR-0053. That is not mine to make.

**Decision needed (orchestrator / QA / architect):**
- (a) QA reads the detail with a holder of `transformation.read` at the KPI's transformation (for example its AUD or KDS session). This is a test-side change by qa-verifier; the product already satisfies it.
- (b) The architect decides that technical administrators see linked KPIs in operational exceptions. That is an ADR-0053 amendment and a permission change.

I recommend (a). REQ-S12-019's "shown to admins and data owners" is met: admins see the exception and its linked-KPI count, and data owners see the KPI.

## 5. Contract seams, schema and dependency needs (for the orchestrator)

- **Pending-operation delta:** none (no operation routed; my `p6-pending-*` lists are unchanged).
- **`contract.test.ts` pins:** no change. Operation count 932, request media types, the rate-limit floor and CSRF-exempt routes are untouched. The `receiveWebhook` edit adds only a description and an example.
- **Event schema (internal, additive):** `connector.run_failed` v1 gains the optional `kpiLinks`. Please record it in ADR-0053 §3 / ADR-0055 §2 ("the event names the KPIs the run feeds, computed by the API; the consumer's identity reads no business record"). No consumer breaks: `automation.evaluate` parses with the same schema.
- **Migration:** none. **Dependency:** none.
- **Same class as F1, outside my scope (reported, not fixed):** `setAssistantSecretProviders` (`apps/api/src/modules/assistant/provider.ts:395`) is also never called from `server.ts`. `grep -rn "setAssistantSecretProviders(" apps` finds only its definition. So an assistant HTTP provider configured with a `SecretRef` cannot resolve its credential in the running product. Its comment says the line is the orchestrator's merge line. A one-line wiring plus a composition test like mine is the fix, for its owner (BE-T / orchestrator).

## 6. User-facing texts

None became untrue. `adminP6.json` `operations.exceptionsIntro` ("An exception is opened when a job or connector fails or data becomes stale. Linked KPIs keep their last known value and are labelled Stale.") is now true for connector exceptions too. No en/ar string called webhooks or connector credentials planned.

## 7. What remains

- The F2 soft assertion in QA-A's suite needs the §4 decision. The product side is done.
- The ADR-0056 §7 correction (§2) and the event note (§5) are for the architect.
- The pre-existing failures of §3 and §3.1 belong to their owners (listed there).
- Not run: e2e (`e2e/a17-import-and-integration.spec.ts`). The assignment's checks list does not include it; QA-A's e2e signed-webhook test should now pass, since it failed only on F1, but I did not run it.

## 8. Merge instructions

- No migration, and no ordering constraint beyond the usual.
- `server.ts`: one import line next to BE-O's `setOutboundConfirmationPort` import, and one call line directly after `registerBuiltInSecretProviders(...)`.
- `openapi.yaml`: lines added inside `receiveWebhook`'s `requestBody` only. BE-X1 edits a different operation, so a textual conflict is unlikely.

## 9. End

Ended `2026-10-30T22:59:51Z` (`date -u`), about 108 minutes. `HEAD` is still `fb4dfe173`; my changes are uncommitted. The tree typechecks, builds, lints and is prettier-clean (§3 rows 2–6, run after the last source change). After those checks only test-free evidence and this handback were written, and the base checks restored my patch byte-for-byte (sha256 `2ffc03b9…3d82`).
