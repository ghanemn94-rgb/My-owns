# Handback T-DG6-QA-A: executable acceptance suites for A17 "Import and integration" (qa-verifier, authoring)

- **Stage:** P6, gate DG6 (BUILDING). This is an **authoring** task, not the DG6 gate review: I wrote and ran the suites before the freeze. The independent DG6 QA review is a separate round run by a separate session.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-QA-A-qa-verifier-20261030T195616Z-73e24ae4","session_id":"73e24ae4-8564-4327-ad4e-e33e4ac474c9"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-QA-A.md` (sha256 `6c88719008bc5446d55dd067fd89d560a9631d66bf27ed82c34116973ba955b4`, verified).
- **Tree:** worktree `/home/user/wt/dg6-qa-a`, branch `dg6/qa-a`, `HEAD` = `772bda86b3f71cb9f61d087d3934bbc5a9e23449` at the start and at the end. My changes are **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-30T19:56:43Z`. The end time is in §9.

## 0. Summary

The A17 suites are written and run on the real server, a real PostgreSQL and the real worker, in chromium-en and chromium-ar.

| Scenario | API suite | e2e (en + ar) |
|---|---|---|
| 8/1/1 import, CSV | PASS | PASS |
| 8/1/1 import, XLSX | PASS | PASS |
| Nothing partial | PASS | n/a |
| Unsigned or wrongly signed webhook refused | PASS | PASS |
| Signed webhook accepted | **FAIL (product defect F1)** | **FAIL (F1)** |
| Failing connector | PASS, except the exception's KPI link (**F2**) | PASS |
| Stopped connector | PASS | PASS |

I found three product defects (§6), each with an exact request and response:

- **F1, High:** a correctly signed webhook is always refused with 401, because the API never hands its SecretProvider registry to the integrations module.
- **F2, Medium:** a connector's operational exception never links the KPIs it concerns.
- **F3, Medium:** the documented webhook item keys (ADR-0056 §7) differ from what the server accepts, and OpenAPI documents no item keys.

The failing tests are kept, and nothing works around a defect.

## 1. Files written (all new; no product, tool or delivery-record file touched)

| File | Purpose |
|---|---|
| `tests/qa/support/a17-files.ts` | Builders with no test-runner import, shared by Vitest and Playwright: <br>- RFC 4180 CSV writer; <br>- **independent minimal XLSX writer** (stored ZIP with `node:zlib` CRC-32, inline-string and numeric cells; no product writer); <br>- the A17 8/1/1 fixture; <br>- decimal-string canonicaliser; <br>- webhook HMAC signer (scheme from OpenAPI `receiveWebhook`); <br>- webhook items. |
| `tests/qa/support/a17.ts` | Vitest-side helpers: <br>- template columns read from `GET /api/v1/import-templates` (contract), not from a product constant; <br>- `enabledConnector` (create, then enable); <br>- re-exports `a17-files.ts`. |
| `tests/qa/integration/a17-import-and-integration.test.ts` | The A17 API suite: 10 tests on the real API (inject), a scratch database of the disposable cluster and the **real production worker** in-process (pg-boss). |
| `tests/qa/integration/a17-s01-005-external-change.test.ts` | REQ-S01-005 (A11;A17): task completion, filename-only link, reviewed evidence, test-adapter confirmation. 4 tests. |
| `e2e/a17-import-and-integration.spec.ts` | Root Playwright spec on the real stack (`apps/web/e2e/support/with-stack.sh`): 5 tests × chromium-en/ar. Checks `<html lang/dir>`, axe (0 serious or critical) and screenshots. |
| `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-A-authoring/**` | This handback, logs, mutation logs, screenshots (`screenshots/{en,ar}/a17-*.png`). |

`tests/qa/support/{api.ts,with-pg.sh}` are reused unchanged.

## 2. Requirement rows (stage DG6, citing A17) → tests

These rows have final gate DG6 and cite A17 in `acceptance`. I tested each one literally.

| Requirement | Binding acceptance text (abridged) | Test that proves it | Result |
|---|---|---|---|
| REQ-S17-002 | "a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons" | API: `REQ-S17-002/003 … > CSV`, `> XLSX` (status codes; 10 = 8+1+1; reasons `import.row.value_not_decimal` and `import.row.duplicate_in_batch` → row 3; 8 KPI actuals in the DB, each matched to its row's lineage, KPI, period and decimal value; `import_row_commit` = 8; the 2 others `not_committed` with reasons; file name and SHA-256 kept). Also `> duplicates against committed data …` (re-import → `duplicate_committed`, 422 `import.nothing_to_commit`, DB unchanged) and `> nothing partial …` (409 `import.revalidation_failed`, zero rows written, batch still `staged`). e2e: `REQ-S17-002/003: the 8/1/1 CSV …`, `… as XLSX …` (en and ar). | **PASS** |
| REQ-S17-003 | "CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected" | CSV and XLSX: as above (PASS). Unsigned, wrong secret, tampered body and stale timestamp give 401 `webhook.unauthenticated`, store no receipt or batch, and change no data: API `… unsigned, wrongly signed, tampered and stale …` (PASS) and e2e (PASS: unsigned 401 on the real server). Signed: API `… a correctly signed delivery is accepted (202) …` and e2e `REQ-S17-003: a signed webhook is accepted …` | **FAIL: F1** (signed → 401). Repair probe R1 shows the test passes once F1 is fixed. |
| REQ-S17-001 | "a test connector run records last success, row counts, errors and retries, all visible in the UI" | API `REQ-S17-001 … healthy run …` (rows read 10, staged 10, rejected 1, duplicate 1, `lastSuccessAt` = the run's `finishedAt`) and `… failing run records its error and its retry …` (attempt 2 `retryOfRunId` = attempt 1, `connector.source_unavailable`, counts null = Unknown, bounded at `retryMaxAttempts`). UI: e2e connector tests show "Never succeeded", "Not verified", the failed run and its Unknown counts (screenshots `a17-connector-*.png`). | **PASS**. The UI view of a *succeeded* run's counts and last-success date is not asserted in my e2e; the FE-C journey covers the page. |
| REQ-S12-019 | "a failing test connector produces one exception and the KPI shows Stale with its last value and date" | API `failing connector (REQ-S12-019, A17) …`: <br>- a KPI whose last accepted actual (250.75, data as of 2026-01-31) is older than `staleAfterDays` (D-197 item 3); <br>- a 2-attempt failure chain gives **exactly one** exception (`sourceKind connector`, open, `connector.source_unavailable`), raised by the real worker; <br>- the KPI panel shows `stale`, 250.75 and 2026-01-31 before and after; <br>- no KPI actual of the transformation changes. | **PARTIAL FAIL: F2.** Exception count, Stale label, last value and date all PASS. The exception's `linkedKpis` is `[]`, so the exception itself does not show the KPI (ADR-0053 §2 acceptance fixture). |
| REQ-S17-005 | "with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message" | API `stopped connector (REQ-S17-005, A17) …`: <br>- the run fails with `connector.stopped`; <br>- `actionableError` names the run, trigger, attempt and time, with fallbacks `kpi_form` and `import_file`; <br>- one exception; no data change; <br>- the KPI actual by form returns 201 with value 77.125 stored; <br>- a CSV import still stages and commits. <br>e2e `… a stopped test connector …` and `… a failing test connector …` (en/ar): <br>- "Run now" in the UI, executed by the API's run watch; <br>- why and what-to-do texts (English verbatim from ADR-0055 §4, Arabic from the shipped catalogue); <br>- both fallback links; "Never succeeded", "Not verified"; <br>- no KPI actual changes; the fallback opens the Imports page; <br>- the form-route submission returns 201. | **PASS** |
| REQ-S01-005 | "marking the task complete leaves the deliverable Unconfirmed; a filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and records the source" | `a17-s01-005-external-change.test.ts`: 4 tests, one per clause. | **PASS** (4/4) |
| REQ-S20-017 | "Deliver and pass the executable acceptance test A17 …" | The two integration files and the e2e spec above. | **Delivered; not passing** (F1, F2) |
| REQ-DLV-038 | "… A17 … the applicable A01–A22 executable tests pass on the DG6 candidate …" | A17 part as above. The full `tests/qa` run is in §3. | A17 part **not passing** (F1, F2) |

**Rows that cite A17 but are not DG6 rows** (listed for completeness; not in this assignment's scope):

| Requirement | Final gate | Coverage here |
|---|---|---|
| REQ-S07-003 | DG4 | Indirectly: the re-import test shows a second import for the same KPI, scope and period is `duplicate_committed`, not a second row. |
| REQ-S17-004 | DG7 | Indirectly: every connector here stays `not_verified` with "Never succeeded", never "live". |
| REQ-S19-007 | DG7 | NOT COVERED: a DG7 handover item. |

## 3. Checks run (exact commands, real exit codes)

Environment for every check:

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`); PostgreSQL 16.15 (disposable cluster, UTF8, C locale).
- Chromium from `/opt/pw-browsers`; offline.
- Ports used: 26350–26399 only.
- `node_modules` is read-only in this worktree, so Vitest is started with `--configLoader runner`, as in the DG5 precedent (T-DG5-BE-X2). Without it, Vitest fails at start-up (`ENOENT mkdir node_modules/.vite-temp`); that first attempt is the start of my console log, not a test result.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | console (§9) |
| 1 | `QA_PG_PORT=26350 MTH_PORT_POOL=26351-26399 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | see §3.1 | see §3.1 | `integration-tests-qa-full.log` |
| 2 | `QA_A17_WEBHOOK_SIGNING_SECRET=<synthetic> E2E_PG_PORT=26360 E2E_API_PORT=26361 MTH_PORT_POOL=26362-26399 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a17-import-and-integration.spec.ts --workers=1 --reporter=list` | 1 | **8 passed, 2 failed** (the signed-webhook test in en and ar: F1). axe: 0 serious or critical on every screen reached. No 30 s timeout. | `e2e-final.log`, `screenshots/` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | Type check of my 3 test files: scratch tsconfig in `$TMPDIR` extending `tsconfig.base.json`, `cd apps/api && npx tsc -p …` | 2 | **0 errors in my files.** The one error is in product `apps/api/src/modules/evidence/preview.ts(45,33)` (`ReadableStream.from`). My scratch config mixes the DOM lib into the API program, so this is an artifact of my config, not a product defect. No repository tsconfig includes `tests/qa`. | `typecheck-a17-files.log` |
| 6 | `… vitest … tests/qa/integration/a17-s01-005-external-change.test.ts` (port 26380) | 0 | 4 passed | `integration-a17-s01-005.log` |
| 7 | Mutation checks | see §5 | see §5 | `mutation-*.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | see §9 | see §9 | console |

**Earlier e2e runs (kept, disclosed):**

- `e2e-run1-serial.log`: exit 1, 4 passed and 2 failed. In serial mode the F1 failure skipped the connector tests; I removed serial mode. This run's API log already shows `secret_unresolvable` on the real server.
- `e2e-run2.log`: exit 1, 6 passed and 4 failed. The 2 extra failures were a test bug of mine: a transformation-scoped KDS read organization reporting periods and got 404. The period id is now resolved by the TO in `beforeAll`.

My first e2e attempt (not kept) failed in `beforeAll` with 400 `validation.too_big` for `limit=200`; the limit is now 100.

The final run (`e2e-final.log`) uses the final files.

### 3.1 Full `tests/qa` integration run: counts per file

The counts are in `integration-tests-qa-full.log` (the final run on the final files). The per-file table is in §8, filled from that log.

Two earlier full runs are kept and disclosed:

- `integration-tests-qa-full-run1.log`: 32 files, 2 failed and 344 passed, exit 1. It started before `a17-s01-005-external-change.test.ts` existed. Besides F1 it shows a **test bug of mine**: the KPI panel was read without `reportingPeriodId`, so it showed the newest period, which is rightly Unknown. That is fixed.
- `integration-tests-qa-full-run2-superseded.log`: 33 files, 2 failed and 348 passed, exit 1. My fix of that test landed while this run was going, so I don't use it as evidence.

## 4. How the scenarios are driven (disclosed)

- **Connector runs** are executed by `connectorRunWatchStep` (`apps/api/src/modules/integrations/runs.ts`). It is the exact step the API process runs every 10 s in production, and it is deliberately not started under `NODE_ENV=test`. In e2e the real API in `development` mode runs its own watch; nothing is called directly.
- **The operational exception** is raised by the real production worker in the same process (`startWorker`, pg-boss on the same scratch database), from the `connector.run_failed` outbox event.
- **The task** in REQ-S01-005 is created with the tasks module's own creation service (`createWorkItemOnce`), because there is no public "create task" route. It is completed through the public route.
- **The webhook secret** is a synthetic process variable read by the built-in `env` SecretProvider (in the test process for the API suite; exported before `with-stack.sh` for e2e). No secret value appears in any log here; I scanned the evidence folder for both synthetic values and found none.
- **Determinism:**
  - Fixed period labels: 2042-01 … 2043-04 in e2e; in the API suite, monthly periods from 2041 plus a fixed 2026-01.
  - Fixed values; `data_as_of` 2041-01-31 and 2026-01-31.
  - Unique codes come from `uniq()` or a random stamp, so names can't collide.
  - The only clock-dependent inputs: the webhook timestamp, which is "now" by the contract's tolerance rule, and the stale KPI's 2026-01-31 date, which stays older than 45 days from now on.
  - Decimals are compared as canonical decimal strings, never floats.

## 5. Mutation checks (sandbox copy, never product source in this tree)

The sandbox is a minimal copy in `$TMPDIR/mutq`: `apps/api` and `apps/worker` without `node_modules`/`dist`, `tests/qa`, the root config files, and symlinks for everything else. `scratchpad/mutate.py` applies exactly one textual change, and the file is restored after each run. The diff is at the top of each log. The sandbox was deleted afterwards.

**Baseline:** `mutation-00-baseline.log` matches the worktree (8 pass, 2 fail). It was run with an earlier version of the test file.

**When each mutation ran:**

- M1, M2, M3 and M3b ran before two test-side changes: webhook items switched to template keys, and the request is sent as an object.
- M4–M7 and R1 ran on the final webhook and connector tests.
- None of the tests these mutations target changed after their run, except the webhook ones (M3, M3b). Those two changes don't touch the 401 cases M3b breaks.

| ID | Central assertion (scenario) | Mutation | Expected | Actual | Log |
|---|---|---|---|---|---|
| M1 | Duplicate detected within the file (8/1/1) | `duplicates.ts`: `if (first !== undefined)` → `if (false && …)` | test fails | **killed**: CSV test fails (staging refused by the database backstop, 409 undeclared) | `mutation-01-no-duplicate-in-batch.log` |
| M2 | Nothing partial | `commit.ts`: skip the re-validation refusal | test fails | **killed**: `expected 'version_conflict' to be 'import.revalidation_failed'` | `mutation-02-no-revalidation.log` |
| M3 | Wrongly signed webhook refused | `webhooks.ts`: on a signature mismatch, accept | test fails | **survived (masked by F1)**: this tree never reaches the comparison. Every request stops at `secret_unresolvable` first, so the mutated line is dead code until F1 is fixed. | `mutation-03-accept-bad-signature.log` |
| M3b | Wrongly signed webhook refused | `webhooks.ts`: any signature accepted (`slot = "current"`, no secret needed) | test fails | **killed**: wrong-secret delivery got 400 `webhook.payload_invalid` instead of 401 | `mutation-03b-accept-any-signature.log` |
| M4 | Failing or stopped connector: one exception | worker `handleConnectorException`: ignore `connector.run_failed` | test fails | **killed**: `timed out after 45000 ms waiting for the stopped connector's operational exception`. The first attempt failed only on the 30 s test timeout; I then gave the file explicit test timeouts (`mutation-04a-…`). | `mutation-04-no-connector-exception.log` |
| M5 | Actionable error with both fallbacks (stopped) | `connectors.ts`: fallbacks `["kpi_form"]` only | test fails | **killed**: `expected [ 'kpi_form' ] to deeply equal ArrayContaining{…}` | `mutation-05-no-import-fallback.log` |
| M6 | Run records last success (REQ-S17-001) | `connectors.ts`: `lastSuccessAt` always null | test fails | **killed**: `expected null to be '2026-10-30T20:33:29.894Z'` | `mutation-06-no-last-success.log` |
| M7 | Stopped connector shows the right state, with no silent data | `test-adapter.ts`: a stopped adapter returns its fixture | test fails | **killed**: run not `failed` | `mutation-07-stopped-adapter-returns-data.log` |
| R1 | **Repair probe for F1** (not a mutation) | `server.ts`: after `registerBuiltInSecretProviders(secrets, …)`, call `setConnectorSecretProviders(secrets)` | the signed-webhook test passes | **both REQ-S17-003 webhook tests pass**: 202, staged 10 = 8+1+1, 8 committed, replay 200 | `mutation-R1-repair-probe-secret-registry.log` |
| R1a, R1b | R1 before my two test-side corrections | same as R1 | n/a | R1a: camelCase items refused (evidence for **F3**). R1b: the harness validates a raw `Buffer` body as an object (a test-side artifact, fixed by sending the object). | `mutation-R1a-…`, `mutation-R1b-…` |

## 6. Product defects found (failing tests kept; no workaround)

The finding IDs are proposals; the orchestrator allocates the final numbers.

### F-DG6-QA-A-1 (proposed): High, mandatory violation: a correctly signed webhook is always refused (REQ-S17-003)

- **Cause, verified by reading:**
  - `apps/api/src/modules/integrations/secret-refs.ts` resolves SecretRefs only through a registry handed over by `setConnectorSecretProviders` ("called on one composition line").
  - No file under `apps/**/src` calls it (`grep -rn setConnectorSecretProviders apps packages` → only the definition, two comments and test files).
  - `apps/api/src/server.ts:581-582` creates the registry and registers the `env` and `file` providers, but never passes it on.
  - So in the running product every webhook signing secret, and every connector credential reference, is unresolvable. The implementers' suites (`webhooks.test.ts`, `connectors.test.ts`, `contract/p6-exercises-be-n.ts`) inject a registry themselves, which hides this.
- **Exact request (API suite):**
  - `POST /api/v1/webhooks/<endpointKey>`, `content-type: application/json`.
  - `X-MTH-Webhook-Timestamp: <now>`, `X-MTH-Webhook-Delivery: qa-a17-signed-0001`, `X-MTH-Webhook-Signature: v1=<HMAC-SHA256(secret, "<ts>.<id>.<body>")>`.
  - Body `{"templateVersion":"kpi_actual.v1","items":[10 items]}`.
  - The endpoint was created with `signingSecretRef {"provider":"env","name":"QA_A17_WEBHOOK_SIGNING_SECRET"}`, and that variable is set in the process.
- **Response:** `401 {"type":"urn:mth:problem:unauthenticated","title":"Unauthorized","status":401,"detail":"The webhook request is not signed correctly.","code":"webhook.unauthenticated",…}`.
- **Expected:** 202 with `rowsTotal 10, rowsValid 8, rowsInvalid 1, rowsDuplicate 1`.
- **Real server (e2e):** the built API, with the variable exported to its process, logs `"webhookRejection":{"reason":"secret_unresolvable",…}` for both signed deliveries (`e2e-final.log`).
- **Repair evidence:** R1 (§5). One composition line makes both webhook tests pass.
- **Evidence:** `integration-tests-qa-full.log`, `e2e-final.log`, `mutation-R1-repair-probe-secret-registry.log`.

### F-DG6-QA-A-2 (proposed): Medium: a connector exception never links the KPIs it concerns (REQ-S12-019; ADR-0053 §2 acceptance fixture)

- **Cause, verified by reading:**
  - `apps/worker/src/handlers/integrations.ts` `handleConnectorException` calls `raiseOperationalExceptionTwin` without `kpiLinks`.
  - The `connector.run_failed` event payload (`packages/shared/src/schemas/events.ts` `connectorRunFailedV1`) carries no KPI ids.
  - Only the data-freshness handler (`apps/worker/src/handlers/operations.ts:346`) writes `operational_exception_kpi`.
- **Request:** `GET /api/v1/admin/operations/exceptions/<id>` (ADM_TECH), for the exception of a failing `test_adapter` connector with `adapterSettings {mode: "failing", kpiId: <stale KPI>}` targeting the KPI's transformation.
- **Response:** 200 with `linkedKpis: []` and `linkedKpiCount: 0`.
- **Expected** (ADR-0053 §2: "exactly one exception (`connector_run_failed`) linked to the KPI, and the KPI shows Stale with its last value and date"): the KPI listed with `freshness: "stale"`, `lastValue: "250.75"` and `lastValueAt`.
- **What still holds:** one exception (PASS); the KPI panel itself shows Stale, 250.75 and 2026-01-31 (PASS).
- **Consequence:** by ADR-0053 §9 a transformation-scoped data owner sees only exceptions linked to a KPI of their transformation. So REQ-S12-019's "shown to admins **and data owners**" also fails for transformation-scoped owners. I inferred that from the scope rule and did not test it separately.
- **Evidence:** `integration-tests-qa-full.log` (`linkedKpis []: expected null to match object { freshness: 'stale', …(2) }`).

### F-DG6-QA-A-3 (proposed): Medium: webhook item keys are documented wrongly (ADR-0056 §7) and not at all in OpenAPI (REQ-S17-003 "webhooks are documented in OpenAPI")

- **Documented vs actual:** ADR-0056 §7 documents the body as `{"templateVersion":"kpi_actual.v1","items":[{"sourceRecordId":…,"kpiId":…,"scopeKind":…,"scopeId":…,"periodLabel":…,"value":…}]}`. The server (no field mappings) accepts only the template's snake_case column keys. OpenAPI `WebhookDelivery.items` names no keys at all.
- **Request:** that ADR-shaped body, correctly signed (with F1 repaired in the sandbox).
- **Response:** `400 {"code":"webhook.payload_invalid","detail":"The webhook body is not valid JSON in the documented format.","errors":[{"pointer":"/items","code":"import.header_mismatch",…}]}`.
- **Consequence:** an IT sender following the documentation is refused.
- **Workaround in my suite (disclosed, not a workaround of a product defect):** the suite sends the `kpi_actual.v1` template's column keys, since the body names that template.
- **Evidence:** `mutation-R1a-repair-probe-camelcase-items-refused.log`.

## 7. What remains, and incidents

- **Blocked by F1:** the signed-webhook tests (API and e2e) fail until F1 is fixed. The e2e assertions after the 202 (the webhook batch page in en/ar with axe) have never run on the real stack.
- **Blocked by F2:** the soft `linkedKpis` assertion fails until F2 is fixed.
- **Not covered:**
  - REQ-S19-007 (DG7).
  - The UI display of a *succeeded* run's counts and last-success date (REQ-S17-001 "visible in the UI"): API-proven only.
  - A data owner's visibility of a connector exception: inferred under F2, not tested.
  - The operational-exception screen in e2e: the stack script starts no worker, so no exception exists there. It is API-proven with the real worker.
- **Disk incident (D-104), disclosed:**
  - My first mutation sandbox was a full `git clone` into `$TMPDIR` (3.7 GB). It briefly lowered free space on the shared `/var/tmp` volume to **2.0 GB**, under the 3 GB floor.
  - I deleted it within a minute (back to 5.5 GB) and used a 19 MB minimal copy instead. Free space stayed at or above 5.1 GB after that.
  - The worktree volume (tmpfs) stayed at 7.9 GB free throughout.
- **My own process slip:** while trying to stop a background run, a `pgrep -f` pattern matched my own command shell and interrupted it (exit 130). No other process was affected, because each command runs in its own namespace. The background run finished by itself.
- **Merge:** no migrations or ordering constraints.
  - `e2e/a17-import-and-integration.spec.ts` needs `QA_A17_WEBHOOK_SIGNING_SECRET` (any synthetic value) exported before `with-stack.sh`. Without it, the webhook test fails with an explicit BLOCKED message.
  - The root `playwright.config.ts` picks up the spec unchanged.

## 8. Final full `tests/qa` run: per-file counts

**Command:** `QA_PG_PORT=26350 MTH_PORT_POOL=26351-26399 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa`

**Run:** started 20:53:18Z, ended 21:02:22Z, duration 543 s.

**Exit 1.** Test files: 1 failed and 32 passed (33). Tests: 2 failed and 348 passed (350). The 2 failures are F1 and F2, both in my A17 file. Every other QA suite passes. Log: `integration-tests-qa-full.log`.

| File | Tests | Result |
|---|---|---|
| `a17-import-and-integration.test.ts` | 10 | **8 passed, 2 failed** (F1: `→ … 401 … webhook.unauthenticated …: expected 401 to be 202`; F2: `→ linkedKpis []: expected null to match object { freshness: 'stale', …(2) }`) |
| `a17-s01-005-external-change.test.ts` | 4 | passed |
| `a01-one-source-of-truth-scorecard.test.ts` | 2 | passed |
| `a02-a08-drafts-before-g2-scale-after-g5.test.ts` | 1 | passed |
| `a02-a21-complete-lifecycle.test.ts` | 13 | passed |
| `a03-modular-entry.test.ts` | 12 | passed |
| `a04-a05-a10-partials.test.ts` | 4 | passed |
| `a04-kpi-propagation.test.ts` | 8 | passed |
| `a05-calculation-correctness.test.ts` | 17 | passed |
| `a06-configuration-change.test.ts` | 27 | passed |
| `a07-historical-integrity.test.ts` | 12 | passed |
| `a08-gate-controls.test.ts` | 31 | passed |
| `a09-decision-escalation.test.ts` | 17 | passed |
| `a10-benefit-integrity.test.ts` | 16 | passed |
| `a11-adoption.test.ts` | 12 | passed |
| `a11-bau-sustain.test.ts` | 17 | passed |
| `a11-value-closure.test.ts` | 11 | passed |
| `a12-cross-scope.test.ts` | 14 | passed |
| `a13-dependency-slip-rule-b.test.ts` | 8 | passed |
| `a13-durable-automation.test.ts` | 12 | passed |
| `a13-job-idempotency.test.ts` | 5 | passed |
| `a13-jobs-rerun.test.ts` | 5 | passed |
| `a13-starter-jobs.test.ts` | 4 | passed |
| `a13-starters-run.test.ts` | 11 | passed |
| `a14-concurrency.test.ts` | 5 | passed |
| `a15-demo-transformation-outputs.test.ts` | 7 | passed |
| `a15-outputs-every-definition.test.ts` | 5 | passed |
| `a15-selected-records-and-injection.test.ts` | 7 | passed |
| `a15-snapshots-and-packs.test.ts` | 15 | passed |
| `a16-health-check.test.ts` | 13 | passed |
| `a16-launch-plan.test.ts` | 11 | passed |
| `a16-s16-021-entities.test.ts` | 6 | passed |
| `a22-operational-readiness.test.ts` | 8 | passed |

**Acceptance item 1 is therefore NOT met:** the command exits 1 because of product defects F1 and F2. I did not mark or skip the failing tests; they stay red until the product is repaired.

## 9. End-of-task checks

| Check | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (start, 19:56Z) | 0 | `PASS gate DG5 (historical)` | console |
| `node tools/gates/validate.mjs --historical --stage DG5` (end, 21:04Z) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-end.log` |
| `pnpm lint` (after the last edit) | 0 | clean | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after the last edit) | 0 | all files formatted | `prettier.log` |
| `git rev-parse HEAD` | — | `772bda86b3f71cb9f61d087d3934bbc5a9e23449` (unchanged); my files are untracked and uncommitted | — |

**Acceptance items:**

1. Full `tests/qa` integration run: **not met** (F1, F2; exit 1).
2. Root e2e in chromium-en and chromium-ar: **not met** (8 of 10 pass; the 2 failures are F1; axe 0 serious or critical on every screen reached).
3. Lint and prettier: **met** (exit 0).
4. Requirement → test table: **delivered** (§2).
5. Mutation checks: **met**, 7 central assertions killed (M1, M2, M3b, M4, M5, M6, M7) plus repair probe R1; M3 survived, masked by F1 and disclosed.
6. Validator: **met** (exit 0 at the start and at the end).

**Ended:** `2026-10-30T21:06Z`, about 70 minutes after the start.
