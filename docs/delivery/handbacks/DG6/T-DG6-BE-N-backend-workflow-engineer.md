# Handback T-DG6-BE-N — signed webhooks (backend-workflow-engineer)

- **Stage / gate:** P6 "Integration and system hardening", DG6 (BUILDING). Task T-DG6-BE-N, `p6-work-split.md` §B/A.6.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-N-backend-workflow-engineer-20261030T013607Z-064432f0","session_id":"064432f0-2f13-4e0f-816e-1ae7825dd070"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-N.md` (sha256 `f8aab38f…027befd`, verified before starting).
- **Branch / base:** `dg6/be-n` at `a30b05332741a39e6b743731686de9af5e09e035` (clean tree at start). Changes are left **uncommitted** for the orchestrator.
- **Time:** start `2026-10-30T01:36:40Z`; end: see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (`T-DG6-BE-N-evidence/validate-dg5-historical.txt`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. A webhook delivery stages rows; an auto commit submits KPI actuals through the DG4 path, which decides each one (direct accept or review). No business, Finance or IT approval is granted. All secrets, values and users in the tests are synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/integrations/webhooks.ts` (new) | Endpoint administration (list, create, get, rotate, disable), `receiveWebhook` (signature v1, constant-time compare, current and previous secret, tolerance window, lock 730312, replay and `delivery_id_reused`, the receipt, webhook run and staged batch in one transaction, auto commit after it), the ADR-0056 §9 webhook refusals, the redacted rejection log and counter. |
| `apps/api/src/modules/integrations/routes.ts` | The **BE-N block** after BE-M2's (six routes). The receiving route is `{ public: true }` (no session, therefore CSRF-exempt), `consumes: ["application/json"]`, in rate-limit class `webhook`, and is registered in an encapsulated plugin whose `application/json` parser keeps the raw bytes (needed for the HMAC) and refuses more than 1 MiB with 413 `webhook.payload_too_large` while reading. |
| `apps/api/src/modules/platform/hooks.ts` | One line: `receiveWebhook` added to the `webhook` class's `operationIds` in `RATE_LIMIT_CLASSES`. This is the join point the file's own comment assigns to the owning task ("joined by their owner tasks with the same line, adding the operation id"). It is a platform file outside §B/A.6's list, so it is flagged here for the orchestrator. |
| `apps/api/test/integration/integrations/webhooks.test.ts` (new) | 16 integration tests against a disposable PostgreSQL (§3). |
| `apps/api/test/integration/contract/p6-exercises-be-n.ts` | BE-N's block: zod mirrors for the 6 operations, each exercised through `ctx.mirrored` with its success and every reachable declared refusal. |
| `apps/api/test/support/p6-pending-be-n.ts` | Emptied (6 → 0). |
| `apps/api/src/server.test.ts` | The public-route pin gains `POST /api/v1/webhooks/:endpointKey`, with a comment (the ADR's second session-less mutation after dev login). Shared test file, flagged for the orchestrator. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[410, 408, 1]` → `[414, 412, 1]` with its comment (shared pin, rule 16; see §5). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-N-*.md`, `…-evidence/*` | This handback and the logs. |

There is **no migration** (the schema of `0105` and `0107` was enough). There is **no new dependency** (`node:crypto` only). `packages/db/src/schema.ts`, `openapi.yaml`, `P6_OPERATION_IDS`, the outbox registry and `apps/worker/**` are unchanged.

## 2. Behaviour delivered

### REQ-S17-003, BE-N's part

The acceptance text (binding): **"A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected"**. BE-M2 owns the CSV and XLSX part. BE-N delivers the signed webhook call and the unsigned rejection:

- **A signed webhook call commits valid data.** `POST /api/v1/webhooks/{endpointKey}` with the A17 8/1/1 items answers 202 `{receiptId, importBatchId, replay:false, rowsTotal:10, rowsValid:8, rowsInvalid:1, rowsDuplicate:1}`. The staged batch is `source_kind = 'webhook'` and `application/json`, with no `created_by` and the connector set. It is committed either:
  - **`manual`**: by a KDS through BE-M2's `commitImport` (test: 8 rows committed); or
  - **`auto`**: right after the staging transaction, on behalf of the connector configuration's `commit_on_behalf_of`. This gives `committed`, `rows_committed = 8`, 8 lineage rows and `committed_by = null`. The audit event `import_batch.committed` has actor `service` and `on_behalf_of_user_id` set, and its versions step 2 → 3.
- **An unsigned webhook is rejected.** The following all give the same 401 `webhook.unauthenticated` ("The webhook request is not signed correctly."), with an identical body apart from the request id, and no receipt, batch or run is written:
  - no headers;
  - no signature;
  - a wrong secret;
  - a malformed signature or delivery id;
  - a timestamp outside the window (past or future);
  - an unknown key;
  - a disabled endpoint;
  - a disabled connector.

  The reason goes only to a redacted `warn` log line (`{webhookRejection: {reason, endpointId}}`; never a header value, signature, secret or the body) and to the per-reason counter `webhookRejectionCounts()`. The test asserts the per-reason deltas.

### §B/A.6 test list, item by item (all in `webhooks.test.ts`)

| §B/A.6 test | Result |
|---|---|
| A signed delivery → 202 and a staged batch | PASS. The receipt (slot `current`), the `integration_run` (`trigger_kind = 'webhook'`, key `webhook:<receipt id>`, the connector's own service identity, `succeeded` with counts, `reconciliation_status = 'not_applicable'`, `import_batch_id` set) and the batch are all written in one transaction. The six audit events share the request id, all with actor `service`: `webhook_receipt.accepted`, `integration_run.queued`/`started`, `import_batch.created`/`staged`, `integration_run.succeeded`. |
| With `auto` commit → committed on behalf of the configured user | PASS (above). A refusal at commit time (the on-behalf user lacks a target-required permission) leaves the batch `staged` at version 2 and writes `import_batch.auto_commit_refused` (actor `service`, on-behalf user, refusal code), without a version step. |
| Unsigned, wrong signature, stale timestamp, unknown key, disabled endpoint → the same 401, no row | PASS (10 cases, including a disabled connector and malformed headers). |
| Same delivery id and body → 200 replay, nothing new | PASS. The response equals the original with `replay: true`, and the receipt, batch and run counts are unchanged. Two concurrent identical deliveries give 202 + 200 and one receipt. |
| A different body → 409 | PASS: 409 `webhook.delivery_id_reused`, nothing written. |
| Previous secret accepted inside the grace period and refused after it | PASS. After `rotateWebhookSecret` (graceHours 1, so `previous_valid_until − secret_rotated_at` = 3,600,000 ms), the new secret is accepted as slot `current` and the old one as `previous`. With the service clock past `previous_valid_until`, the old secret gives 401 and nothing is written. |
| Body > 1 MiB → 413 | PASS: 413 `webhook.payload_too_large`, refused while the body is read, nothing written. |
| JSON numbers as values → row reason | PASS. `"value": 12.5` is row reason `import.row.value_not_decimal` (`params.value = "12.5"`, the JSON text kept for display and never coerced); the row is invalid. BE-M's engine then also adds the target's `import.row.value_shape`, because the target sees no value. |
| CSRF-exempt pin | `receiveWebhook` was already in the contract test's public-operation list (ARCH-03). It is now live with `{ public: true }`; identity's CSRF hook skips public routes. |

### Also delivered (rule 4, ADR-0056 §7/§9)

- **Admin routes.**
  - **Reads** are `connector.read` through the owning connector: `visibleConnector`; a caller who cannot read it gets 404. The list is organization-scoped (403 without `connector.read` there, 404 for an unknown organization), newest first. Its cursor compares `date_trunc('milliseconds', created_at)` with the id, so a page boundary inside one millisecond neither skips nor repeats a row (tested: a cursor walk covers every endpoint exactly once).
  - **Mutations** are `webhook.configure` (ADM_TECH). AUD and KDS (`connector.read` without `webhook.configure`) get 403 on create, rotate and disable; an outsider gets 404/403; no session gets 401. Nothing is written (tested).
- **Create.** The server generates `endpoint_key` (32 random bytes, base64url, 43 characters). The signing secret must be exactly `{provider, name}`: anything else, including a bare string, gives 422 `connector.secret_value_refused`. A non-webhook connector gives 422 `webhook.connector_not_webhook`; a tolerance outside 30–900 gives 400; an unknown connector gives 404. One audit event at version 1.
- **Rotate.** If-Match is required (428 / 409). `graceHours` outside 1–168 gives 422 `webhook.grace_invalid`. The same reference as the current one gives 422 `connector.secret_value_refused` at `/signingSecretRef`, because it would rotate nothing. A disabled endpoint gives 409 `webhook.endpoint_disabled`. Audit `webhook_endpoint.secret_rotated` (1 → 2).
- **Disable.** If-Match is required. The state is final; a second disable or any later rotate gives 409 `webhook.endpoint_disabled`. Audit `webhook_endpoint.disabled` (2 → 3).
- **Commit-time re-check.** Inside the transaction, after the row lock, on reloaded grants. A right lost meanwhile gives 403 and nothing is written (tested with a re-authenticating request whose grants are gone).
- **No secret value anywhere.**
  - The values are resolved through `SecretProvider` (`resolveCredentials`) before any transaction and compared with `crypto.timingSafeEqual`.
  - A scan finds neither test secret in the create, get or list responses, the stored endpoint row, or the audit events of the endpoint, its connector and its receipts.
  - Audit diff fields avoid the audit layer's forbidden names: `signing_ref`, `previous_ref` and `key_slot` (`secret_slot` is refused by `packages/db` `audit.ts`).
- **Exactly once.** Lock 730312 is held on `<endpointId>:<deliveryId>`, then lock 730310 (`connectorRun`) on the connector, so one active run per connector holds. The replay check runs again under the lock. `webhook_receipt_delivery_key` and `import_batch_webhook_receipt_key` are the unique backstops.
- **No remote I/O in a transaction.** Secret resolution, signature verification, JSON parsing and row validation (`prepareImport`) all run before the transaction; the auto commit runs after it.
- **Body handling.**
  - The body is decoded as strict UTF-8 (`decodeUtf8Body`, BOM refused) and parsed with the platform's JSON parser (`app.getDefaultJsonParser`), and **only after the signature matched**: an unsigned malformed body is 401, not 400 (tested).
  - The shape check gives 400 `webhook.payload_invalid` for: not JSON; not UTF-8; not an object; an extra property; more than 5,000 items or 50 keys; an unknown template; or items that do not fit the template.
  - For that last case the problem's `errors[0]` carries the engine's own code and text (e.g. `import.header_mismatch`), so a sender can see what to fix. The contract declares no 422 for this route.
- **Field mappings.** A webhook connector's `fieldMappings` map item keys to template columns (e.g. camelCase senders), keeping each value's JSON type. With no mappings, items use the template's column keys (`kpi_actual.v1`).

## 3. Checks run (real exit codes; logs in `T-DG6-BE-N-evidence/`)

Environment: Node 24.21.0, offline. PostgreSQL 16.15 disposable clusters via `tests/qa/support/with-pg.sh` on ports 25200–25249 only. Empty `.claude/.cc-writes` directories were removed before the runs.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` | `validate-dg5-historical.txt` |
| 1a | `pnpm -r typecheck` | **0** | all packages Done | `typecheck.txt` |
| 1b | `pnpm -r build` | **0** | all packages Done | `build.txt` |
| 1c | `pnpm lint` | **0** | clean | `lint.txt` |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.txt` |
| 1e | `pnpm openapi:lint` | **0** | PASS | `openapi-lint.txt` |
| 1f | After rows 1a–1e, two files changed (the architecture fix in `webhooks.ts`; the public-route pin in `server.test.ts`, see row 2a). Re-checked: `npx tsc -p apps/api/tsconfig.json --noEmit`, `npx eslint` and `npx prettier --check` on both files plus this handback | **0 / 0 / 0** | clean | (console) |
| 2a | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`), run 1 | **1** | unit-node: 2 failed, 2628 passed (2630), 171 files. Web: 1787 passed (98 files). Third invocation: 259 passed, 2 skipped. Both failures were **mine**: (i) `architecture.test.ts` flagged a computed member with a non-literal key in `webhooks.ts` (`headers[name]`); (ii) `server.test.ts` pins the public routes and lacked `POST /api/v1/webhooks/:endpointKey`. Both are **fixed** (literal header keys; the pin updated with a comment). Re-run: `npx vitest run --project unit-node apps/api/src/architecture.test.ts apps/api/src/server.test.ts` → **exit 0, 147/147**. The run also reported one unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"`, from load: the integration suite (row 3) ran at the same time. | `unit-locale-unset-run1-before-fix.txt` |
| 2b | `pnpm test` with `LANG=C.UTF-8 LC_ALL=C.UTF-8`, run 1 (on the fixed code) | **not captured** | unit-node: **1 failed, 2629 passed (2630)**. The failure is `architecture.test.ts` › "apps/web never imports @mth/db or @mth/config": `Test timed out in 30000ms`, a source-scan test with no relation to this change (it passed in row 2a). It came with the same unhandled `onTaskUpdate` RPC timeout. Both came from my mistake of running it alongside the full integration suite. **Evidence handling error (mine):** I renamed and then deleted the raw log while `pnpm test` was still writing the later invocations, so only the unit-node part was kept, and its final exit code was not captured. | `unit-c-utf8-run1-loaded.txt` (partial) |
| 3 | `QA_PG_PORT=25230 MTH_PORT_POOL=25231-25249 tests/qa/support/with-pg.sh pnpm test:integration` | **still running at hand-off** | At 03:31Z: 112 files done, 110 passed, 2 failed; 979 passing test lines. The 2 failed files are both **worker** tests, unrelated to this change (§7): `apps/worker/test/integration/adoption-below-trajectory.test.ts` (1 failed: "the event-to-queue registry (D-102) › kpi.deviation_evaluated fans out…") and `apps/worker/test/integration/operations-freshness.test.ts` (2 failed: "catalogue triggers and starter 16 version 2 (0116)…", "kpi.freshness_scan and operations.exception_raise…"). The worker imports no API code (ADR-0002 rule 5), and this task changed no worker, db, migration or outbox-registry file. Whether they fail on the base `a30b05332` too, or only under the concurrent load of row 2b, was **not verified**. Passed in this run: `contract.test.ts` (101), `webhooks.test.ts` (16), `connectors.test.ts` (20), `runs.test.ts` (15), `imports.test.ts` (11), `import-staging.test.ts` (10), `catalogue.test.ts` (35). | `integration-partial.txt` (snapshot); `integration-raw.txt` (keeps growing until the run ends) |
| 4 | `with-pg.sh npx vitest run --project integration apps/api/test/integration/integrations/webhooks.test.ts` (port 25220) | **0** | **16/16** | `webhooks-suite.txt` |
| 5 | `with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/contract/response-validation.test.ts` (port 25202, run alone) | **0** | **210/210** | `contract-suites.txt` |
| 5x | The same two files, run **in parallel** with row 4 (an earlier iteration) | 1 | One failure from my exercise (403 expected where the route correctly answers 404, then fixed), plus "an undeclared request media type…" `Test timed out in 30000ms` under the parallel load. It passed in row 5 run alone and in row 3. | `contract-suites-parallel-run-failures.txt` |

**Not done (acceptance items 2 and 3 are therefore not fully demonstrated):**
- A clean, unloaded `pnpm test` in **both** locales on the final tree, with exit codes and counts for every Vitest invocation.
- A completed `pnpm test:integration` run with its final counts.
- A check of the two worker failures against the base commit.

These remain (§7).

## 4. Operations routed (delta to `p6-pending-be-n.ts`)

`P6_PENDING_BE_N`: 6 → **0**. Removed: `listWebhookEndpoints`, `createWebhookEndpoint`, `getWebhookEndpoint`, `rotateWebhookSecret`, `disableWebhookEndpoint`, `receiveWebhook`. Each is exercised in `p6-exercises-be-n.ts`:

- `createWebhookEndpoint`: 201 / 400 / 401 / 403 / 404 / 422.
- `receiveWebhook`: 202 / 200 replay / 400 / 401 / 409 / 413.
- `listWebhookEndpoints`: 200 / 400 / 401 / 403 / 404.
- `getWebhookEndpoint`: 200 / 400 / 401 / 404.
- `rotateWebhookSecret`: 200 / 400 / 401 / 403 / 404 / 409 / 422 / 428.
- `disableWebhookEndpoint`: 200 / 400 / 401 / 403 / 404 / 409 / 428.

All six have zod mirrors. `receiveWebhook` is signed over its exact bytes, so the exercise sends it raw with `contract: false` and then applies `assertContract` (which records coverage) and `assertAcceptedRequest` itself.

## 5. For the orchestrator: contract, pins, shared files, dependencies

1. **Media-type pin (rule 16), already updated in `contract.test.ts` with a comment:** `[410, 408, 1]` → `[414, 412, 1]`. This adds 4 JSON request bodies: `createWebhookEndpoint`, `rotateWebhookSecret`, `disableWebhookEndpoint`, `receiveWebhook`. Reconcile with the parallel deltas at merge.
2. **CSRF-exempt / public pin:** `receiveWebhook` was already in the pinned public list (ARCH-03); no change was needed.
3. **Rate-limit class:** `RATE_LIMIT_CLASSES.webhook.operationIds = ["receiveWebhook"]` (`platform/hooks.ts`; flagged in §1). The class is keyed by `endpoint_key`. The security test pins this list to the routes declaring the class; it ran in the integration suite (§3).
4. **Contract vs ADR mismatch (needs a decision; no edit made):** the contract's `WebhookDelivery.items[]` declares `additionalProperties: { type: [string, "null"] }`. However, ADR-0056 §7 and §B/A.6 ("JSON numbers as values → row reason") require a JSON number to be accepted and staged as `import.row.value_not_decimal`. The implementation follows the ADR, so a body the contract calls invalid is answered 202. Suggested fix: relax the item value schema to any JSON value (or `[string, number, boolean, "null"]`) with a description saying non-strings become row reasons. My test marks that one call `offContract` and still validates the response.
5. **Design choices the ADR leaves open, for review:**
   - **Disabled connector:** a delivery to an active endpoint whose connector is **disabled** gives the same 401, logged as `connector_disabled`. This follows ADR-0055 §2: a disabled connector's runs are cancelled.
   - **Narrowed service identity:** a connector service identity whose grant no longer includes `transformation.read` also gives 401 (logged as `service_identity_out_of_scope`), because the contract declares no other refusal.
   - **Endpoint key format:** a malformed endpoint key (not `^[A-Za-z0-9_-]{32,64}$`) is 401 `endpoint_unknown`, not a 400 path validation, so a probe learns nothing.
6. **Rejection counter:** `webhookRejectionCounts()` is a process-local counter by reason. If DO-D's monitoring wants it exported as a metric, that is a wiring line for them.
7. **i18n (FE-A owns `i18n/{en,ar}/problems.json` B/A blocks):** these codes need en/ar texts. The English texts are ADR-0056 §9's, verbatim:
   - `webhook.unauthenticated`
   - `webhook.delivery_id_reused`
   - `webhook.payload_invalid`
   - `webhook.payload_too_large`
   - `webhook.endpoint_disabled`
   - `webhook.grace_invalid`
   - `webhook.connector_not_webhook`: "A webhook endpoint can be created only for a webhook connector.", the text already used by BE-L's `db-errors.ts` mapping.
8. **Audit actions:** `webhook_endpoint.created`, `webhook_endpoint.secret_rotated`, `webhook_endpoint.disabled`, `webhook_receipt.accepted`, `import_batch.auto_commit_refused`. If an audit-action label catalogue exists for the UI, these need labels.
9. **Latent issue in another task's file (not changed):** `imports/commit.ts` `listBatches` (BE-M2) pages on `(created_at, id)`, with the cursor carrying `created_at` at millisecond precision while the column has microseconds. Two batches created within the same millisecond around a page boundary can be skipped. My list uses `date_trunc('milliseconds', created_at)` for this reason. Suggest the same one-line change there (owner: BE-M2's file).
10. **Migration:** none. **Dependency:** none. **Schema/catalogue:** unchanged.

## 6. User-facing texts made untrue

None found:
- `grep -rni webhook apps/web/src` finds no string calling webhooks planned or later.
- No i18n string mentions webhooks yet; the new problem texts are listed in §5 item 7 for FE-A.

## 7. What remains

The implementation of §B/A.6 is complete: six operations, tests and exercises. **Verification is not complete.** The time limit was reached while the full suites were running:

1. **Re-run `pnpm test` with the locale unset and with `C.UTF-8`** on the final tree, **without** a concurrent integration run, and record each invocation's counts and the exit code (§3 rows 2a/2b). The only failures seen were my two (fixed and re-verified, 147/147) and load timeouts.
2. **Let `pnpm test:integration` finish, or re-run it alone** (`QA_PG_PORT=25230 MTH_PORT_POOL=25231-25249 tests/qa/support/with-pg.sh pnpm test:integration`). Record the counts. The pinned-count change is the media-type pin `[414, 412, 1]` (§5 item 1). Not yet seen in this run: `apps/api/test/integration/admin/security.test.ts`, which pins the rate-limit class list to the routes declaring each class. It should pass with `receiveWebhook` in the `webhook` class.
3. **Check the two worker integration failures** (`adoption-below-trajectory.test.ts`, `operations-freshness.test.ts`) on the base `a30b05332` and alone. They are outside this task's files and imports.
4. Orchestrator decisions in §5:
   - the WebhookDelivery item-value schema (item 4);
   - the shared-pin reconciliation (item 1, plus the `server.test.ts` public-route pin edited in this task: `apps/api/src/server.test.ts`, one assertion);
   - the i18n texts (item 7).

BE-N2 (outbound writes) appends to `p6-exercises-be-n.ts` and adds its block after BE-N's in `routes.ts`.

## 8. Timing

- Start: `2026-10-30T01:36:40Z` (`date -u`).
- End: see the final `date -u` line appended below (about 2 h). The full test suites were still running when the time limit was reached (§3, §7).

Final `date -u` at hand-off: `Fri Oct 30 03:31:54 UTC 2026`.
