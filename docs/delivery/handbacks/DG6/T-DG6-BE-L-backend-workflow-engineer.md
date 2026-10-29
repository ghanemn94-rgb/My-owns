# Handback T-DG6-BE-L (backend-workflow-engineer): connectors, configuration versions, mappings, the connector service identity

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §B/A.1.
- **Invocation:** `DG6-T-DG6-BE-L-backend-workflow-engineer-20261029T001305Z-9e9bdcb8`, session `9e9bdcb8-dbb7-4a31-b6ce-a9e8ec074ee9`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-L.md`, sha256 `fc974d23f2ee240151ad6f328f6ad415c2ee4b8eef152982e83820e91f187a01` (verified before starting).
- **Base:** branch `dg6/be-l`, `HEAD` `df357b239dd10bcb1ba4242da51475d2dcb66814`; the tree was clean at the start. Changes are left **uncommitted** for the orchestrator.
- **Time:** started `2026-10-29T00:24:36Z`. The end time is in "Checks" below.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0 (`T-DG6-BE-L-evidence/validate-historical-DG5.log`).
- **Gates:** nothing here reads or writes DG0–DG7. Configuring, enabling or testing a connector approves nothing (G1–G6), and no permission used here is a business-approval or Finance-validation code. The demo connector is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/integrations/adapters/port.ts` (new) | The adapter port of ADR-0055 §3: `fetch`, `dispatch`, `outcome`. Includes the six error codes of §4 with their English "why" texts, `ConnectorAdapterError`, and the process adapter registry (`connectorAdapters()`, `setConnectorAdapters()`). BE-L registers no adapter; BE-L2 registers the test adapter and `http_pull`. |
| `apps/api/src/modules/integrations/secret-refs.ts` (new) | Credential references only. It checks a request's credential map (anything but exactly `{provider, name}` is a value, refused). `credentialRefViews` gives `{provider, name, resolvable}` through the SecretProvider and drops the value at once. `resolveCredentials` resolves just before an adapter call, outside any transaction. The registry arrives through `setConnectorSecretProviders` (see §5). |
| `apps/api/src/modules/integrations/connectors.ts` (new) | The connector service: request schemas, the 422 business rules, read and configure authorization, create (connector + configuration version 1 + service identity + 3 audit events in one transaction), put, put mappings, enable and disable (queued runs are cancelled), the test run, the derived `verification`, `lastSuccessAt`, `lastRun` and `actionableError`, and the mappings view. |
| `apps/api/src/modules/integrations/routes.ts` | The BE-L connector block (9 routes), the first block of the file. It is named so BE-L2, BE-M2, BE-N and BE-N2 can append theirs. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP6IntegrationsError`, the B/A block of §B/A.1, exact, plus `connector_config_version_adapter_settings_check` (the 4 KiB CHECK). It is called right after `mapP6AccessHardeningError`; BE-K's block was not on this branch (see §6). |
| `apps/api/test/integration/integrations/connectors.test.ts` (new) | The BE-L integration suite: 20 tests against the disposable PostgreSQL. |
| `apps/api/test/integration/contract/p6-exercises-be-l.ts` | The 9 operations through the validating client, with their zod mirrors (success and every reachable refusal). |
| `apps/api/test/support/p6-pending-be-l.ts` | Emptied (9 → 0). |
| `apps/api/test/integration/contract/contract.test.ts` | The JSON-body media-type pin: 397/396 → **403/402** (+6), with a comment line. |
| `packages/db/src/demo/data/connectors.ts` (new) | The demo record of §3 row 25: one **disabled** test connector, its configuration version 1 and its service identity, synthetic, with fixed ids `01995000-6000-…`. |
| `packages/db/src/demo/data/index.ts` | Lists `DEMO_CONNECTORS_MODULE` (order 300, after the roaming foundation, before KBE-H). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-L-backend-workflow-engineer.md`, `T-DG6-BE-L-evidence/*.log` | This handback and its logs. |

**Migrations: none.** The demo connector is a demo-seed module, not a migration (B/A.10 "if it is a migration rather than a demo-seed file"), so I took no id. BE-L2's job-identity migration is still the slice's next one. The highest file on this branch is `0114_p6_job_service_identities.sql`.

## 2. Operations routed (delta to `p6-pending-be-l.ts`: 9 → 0)

| Operation | Route | Permission | Notes |
|---|---|---|---|
| `listConnectors` | `GET /api/v1/admin/connectors` | `connector.read` | By code; cursor `(code, id)`; `status` filter |
| `createConnector` | `POST /api/v1/admin/connectors` | `connector.configure` | 201, `Location`, `ETag "1"` |
| `getConnector` | `GET /api/v1/admin/connectors/{connectorId}` | `connector.read` | 404 when missing or unreadable |
| `putConnector` | `PUT /api/v1/admin/connectors/{connectorId}` | `connector.configure` | `If-Match`; with `config` it creates configuration version n+1; with `config: null` the names change and the configuration version stays |
| `enableConnector` | `POST …/enable` | `connector.configure` | `If-Match`; 422 `invalid_transition` when already enabled |
| `disableConnector` | `POST …/disable` | `connector.configure` | `If-Match`; reason required; queued runs `cancelled` (each audited) under the `connectorRun` lock |
| `testConnector` | `POST …/test` | `connector.configure` | Runs the port; 200 with the finished run; see §3 |
| `getConnectorMappings` | `GET …/mappings` | `connector.read` | `ETag` = the connector's version |
| `putConnectorMappings` | `PUT …/mappings` | `connector.configure` | `If-Match` (the connector's); a new configuration version |

Every route declares `config.consumes: ["application/json"]` (mutations) or nothing (GETs), as `openapi.yaml` declares. `contract.test.ts` "route coverage" and "every operation" pass.

## 3. Behaviour delivered, per requirement row

### REQ-S17-001 (BE-L part; shared with BE-L2 and FE-C)

Acceptance (quoted): **"A17: a test connector run records last success, row counts, errors and retries, all visible in the UI"**.

What BE-L delivers towards it (the scheduled runs, retries, the real test adapter and the UI are BE-L2's and FE-C's, so the row is **not complete** with BE-L alone):

- **Configured credentials, field mappings, source ID, cadence (M0334).** These are stored as append-only configuration versions 1, 2, 3…. Credentials are `SecretRef`s only. A value is refused with 422 `connector.secret_value_refused` before any write. A value here means a property that is not exactly `{provider, name}`, a settings key named like a secret at any depth, or userinfo or a secret-named query parameter in `endpointUrl`. Responses show `{provider, name, resolvable}`, never a value, and the test scans the create, get, list and test responses for the secret's value.
- **The service identity (ADR-0053 §1).** It is created in the same transaction as the connector: `code = 'connector:<id>'`, organization scope, `declared = granted = ['transformation.read']`.
- **Last success, row counts, errors.** `lastSuccessAt` is derived (the newest succeeded run; `null` means "Never succeeded"). `lastRun` is the newest run. Counts come from `integration_run` and are `null` while unknown. `actionableError` shows the newest failed run after the last success: run id, trigger, attempt, time, the error code of ADR-0055 §4, its `params` (`name`, `column`) and the fallbacks `kpi_form` and `import_file` (kpi_actual connectors). A later succeeded run clears it.
- **Verification.** `verified` iff a run with trigger `test` succeeded on the **current** configuration version; a new configuration version is `not_verified` again. A connector is never labelled live.
- **`testConnector`** runs through the port in two short transactions:
  - Transaction 1, under the `connectorRun` lock and with the commit-time re-check, inserts the run `queued` and moves it to `running`. One active run per connector is enforced: 409 `connector.run_active`.
  - Outside any transaction: resolve the credentials, then call `fetch`.
  - Transaction 2 sets `succeeded` with `rowsRead` = rows fetched, and `rowsStaged`/`rowsRejected`/`rowsDuplicate`/`errorCount` = 0, because a test stages and commits nothing; `rowsCommitted` stays null. Reconciliation is by row count. Otherwise transaction 2 sets `failed` with its code.
  - The adapter's output is checked: every cell must be a string (else `connector.response_invalid`) and every mapped source column present (else `connector.mapping_mismatch {column}`). A thrown non-adapter error becomes `connector.source_unavailable`, and its message is never stored. The stored `errorMessage` is the code's "why" text plus its parameters, so it is redacted by construction.
  - A failed test is not retried and raises no operational exception; scheduled runs do both (BE-L2).
- **Proof:** `connectors.test.ts`, 20/20, and the contract exercises.

### REQ-S17-005 (BE-L supplies the connector-page part; BE-L2, BE-O and FE-C own the row)

Acceptance (quoted): **"A17;A21: with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message"**.

BE-L delivers the connector page's data. With the adapter in `stopped` mode, a test answers `failed` with `connector.stopped`, and `getConnector` returns `actionableError {runId, triggerKind, attemptNo, finishedAt, errorCode: "connector.stopped", params: {}, fallbacks: ["kpi_form", "import_file"]}` (tested with this file's test double of the adapter). The "KPI actual still submitted by form" half is BE-O's test. No DG4 route reads a connector, and BE-L changed none.

### The §B/A.1 test list, item by item

All of these are in `apps/api/test/integration/integrations/connectors.test.ts`:

| Required test | Where |
|---|---|
| create writes connector, version 1, identity and 3 audit events in one transaction | "writes the connector, configuration version 1, …" (one request id, actions `connector.created`, `connector_config_version.created`, `service_identity.created`) |
| a credential with a value, a secret-like settings key, a duplicate mapping target, a test adapter without mode → their 422 | "refuses a credential with a value …" (6 cases), "refuses invalid mappings, adapter settings and targets …" (13 cases); nothing written in each |
| code taken 409 | "answers 409 connector.code_taken …" |
| put creates version n+1 | "a configuration is a new version n+1 …"; mappings: "mappings: … put is a new configuration version" |
| If-Match 409/428 | the same two tests, plus enable/disable |
| AUD 403 on every mutation | "every mutation is 403 for AUD and KDS …" (put, enable, disable, test, put mappings) and "createConnector … refused to AUD and KDS (403)" |
| ADM_TECH may configure, KDS may not (403) | every success runs as `w.admin` (ADM_TECH); KDS gets 403 in the two tests above |
| `verification` is `not_verified` until a succeeded test on the current version | "is not_verified until a succeeded test on the CURRENT configuration version" |
| the credential view never contains a value (response scan) | "never returns a value (response scan) …"; the stored `credential_refs` and the audit diffs are scanned too |
| (also) authorization re-checked at commit | "re-checks authorization at commit on the reloaded grants …" (403, nothing written) |
| (also) transformation-level reader | "a transformation-level reader sees, read-only, only the connectors whose current configuration targets it" (ReadScope predicate) |
| (also) the db-errors mappings | "maps every guard the slice names to its code and status" (22 constraints) and a trigger probe |

### The demo record (§3 row 25)

`packages/db/src/demo/data/connectors.ts` seeds one **disabled** `test_adapter` connector, `demo-kpi-test-source`. It targets the roaming transformation's KPI actuals, with no credential, three field mappings, mode `healthy`, configuration version 1, and its service identity. It has no run, so it shows "Not verified" and "Never succeeded".

**Reset checksum re-baseline.** No document or test pins the dataset checksum value. The demo tests compare seed, reset and reset against each other, and `grep` finds no 64-hex demo checksum under `docs/`. So the re-baseline is the stated change itself: the dataset gains 3 registered rows (connector, connector_config_version, service_identity), their trigger-written history rows (connector_change, service_identity_change) and their 3 audit events. The checksum changes once. Reason: the connector demo record of p6-plan §3 row 25.

`demo.test.ts`, `demo-roaming.test.ts` and `demo-numbers.test.ts` pass, 88/88, including "seed, then reset-demo twice gives identical counts and checksums" through the CLI with the shipped dataset (`T-DG6-BE-L-evidence/demo-suites.log`).

## 4. Checks (real exit codes)

Environment: Node 24.21.0, offline. PostgreSQL 16.13 disposable clusters through `tests/qa/support/with-pg.sh` on ports 24101–24149 only. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-L-evidence/`.

| # | Command | Result |
|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | exit 0, `PASS gate DG5 (historical)` |
| T1 | `QA_PG_PORT=24101 MTH_PORT_POOL=24102-24149 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/integrations/connectors.test.ts` | exit 0, 20/20 (`connectors-test-first-run.log`) |
| T2 | the same with `contract/contract.test.ts` (port 24103) | **exit 1** before the pin update: 1 failed, 100 passed. The only failure was the media-type pin `[403, 402, 1]` vs `[397, 396, 1]`, the expected +6 from my routes. I then updated the pin (`contract-test-pin-before.log`). The full integration run below includes the contract test after the pin change. |
| T3 | demo suites (port 24105) | exit 0, 88/88 (`demo-suites.log`) |
| 1a | `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check, `pnpm openapi:lint` (first pass, 00:52–01:03) | all exit 0 (`*-r1.log`). They ran **before** the two unit-test fixes below, so they are superseded by the second pass (1b). |
| 2a | `pnpm test` (locale unset, then `C.UTF-8`), first pass | **exit 1 both**, void (`unit-*-r1-void.log`). Locale unset: 2 failed / 2473 passed (2475). `C.UTF-8`: 1 failed / 2474 passed. Both failures were my defects: (i) `architecture.test.ts` refuses computed-member writes or reads with non-literal keys in module sources (`connectors.ts`, `secret-refs.ts`); (ii) `advisory-locks.test.ts` refuses a lock class number spelled in a module source (my comments named the `connectorRun` number). I fixed both: `Object.fromEntries` and a `Map` instead of indexed writes, and the comments now name the class. Then `npx vitest run --project unit-node apps/api/src/architecture.test.ts apps/api/src/modules/platform/advisory-locks.test.ts` exits 0, 144/144. The `C.UTF-8` run had started at 01:14, before the last fix at 01:17, which is why it still had one. |

The final results (the second pass, after the fixes) are in "Final check results" below.

## 5. Contract, schema, composition and dependency needs (for the orchestrator)

1. **One composition line in `apps/api/src/server.ts` (frozen for me; please add at merge).** After `registerBuiltInSecretProviders(secrets, …)`:
   ```ts
   setConnectorSecretProviders(secrets); // BE-L: connector credentials resolve through the process SecretProvider (ADR-0052 §5)
   ```
   with `import { setConnectorSecretProviders } from "./modules/integrations/secret-refs.ts";`. `index.ts` is BE-A's, so this module's public surface can instead re-export it.
   - **Until the line exists:** every `resolvable` is `null` ("not checked", Unknown; never `true`), and a test of a connector with credential references fails with `connector.secret_unresolvable`. A connector without credentials (the demo one, the contract exercise) is unaffected.
   - The integration suite sets the registry itself.
   - I did not edit `server.ts` because §B/A.1 does not list it for BE-L.
2. **The adapter registry.** BE-L2 registers its adapters with `connectorAdapters().register(…)`, or replaces the registry with `setConnectorAdapters(createConnectorAdapterRegistry([...]))`, in its own files or at composition. Until then `testConnector` answers 422 `connector.adapter_unavailable` (below).
3. **Target columns.** `getConnectorMappings.targetColumns` comes from a port, `setConnectorTargetColumnsSource(kind => columns)` in `connectors.ts`. It is empty until BE-M's `ImportTargetRegistry` (with KBE-A's `kpi_actual.v1`) is wired to it; no column is invented. Proposed: BE-M or KBE-A's `server.ts` line calls `setConnectorTargetColumnsSource((k) => registry.get(k)?.columns ?? [])`.
4. **Problem codes not in the ADR tables (rule 17), proposed texts:**
   - `connector.adapter_unavailable` (422): "This connector type cannot be tested here: no adapter of this type is available." It is answered by `testConnector` for a `webhook` connector (no pull adapter, by design) and for any kind with no registered adapter (`test_adapter` and `http_pull` until BE-L2). Please add it to ADR-0055 §9 and the contract's `testConnector` summary.
   - `webhook.connector_not_webhook` (422): "A webhook endpoint can be created only for a webhook connector." The work split names the code and the contract names it in `createWebhookEndpoint`, but ADR-0056 §9 has no text. I used this text in `db-errors.ts`; BE-N may keep it or align it.
   - Validation field codes (400, generic validation problems): `validation.credential_refs` "Name at most 8 secret references, each {provider, name}."; `validation.commit_on_behalf_of` "Name the user an automatic commit acts on behalf of, exactly when the commit mode is automatic." and "Choose an active user of this organization."
5. **Pinned counts (rule 16).** `contract.test.ts` JSON request bodies **+6** (397 → 403; JSON 396 → 402). Operation count unchanged (the 9 were already in the 910/931 total). No new media type. No rate-limit class. No CSRF-exempt route.
6. **i18n (FE-A owns `i18n/{en,ar}/problems.json`).** The web catalogues have no text yet for the connector codes: `connector.code_taken`, `connector.secret_value_refused`, `connector.mappings_invalid`, `connector.adapter_settings_invalid`, `connector.target_invalid`, `connector.run_active`, `connector.adapter_unavailable` (new), the six §4 error codes (why and what-to-do) and the slice's other mapped codes. Those are FE-A's B/A block. The Arabic is to be labelled provisional.
7. **No new dependency. No schema change. No migration.**

## 6. Assumptions and deviations (stated plainly)

- **`db-errors.ts` order.** §B/A.1 says BE-L's block goes "after BE-K's". BE-K runs in parallel (W7, D-004) and its block is not on this branch. Mine is a separate function, `mapP6IntegrationsError`, called right after `mapP6AccessHardeningError`. The orchestrator places BE-K's call before mine at merge; the constraint names are disjoint (0104–0106 vs 0102/0103), so the order does not change any answer.
- **Testing a disabled connector is allowed.** The flow is configure, test, then enable. ADR-0055 §1 says enabling does not verify; verification needs a test.
- **The actionable error is the newest failed run *after the last success*.** ADR-0055 §4 says "the newest failed run". Showing a failure older than a later success would describe a connector that works as broken. FE-C's run history still shows every failed run.
- **Test-run reconciliation.** A test stages nothing, so no control total is compared. `row_count` gives `matched` or `mismatched` on the row count. `row_count_and_total` gives `mismatched` when the counts differ and otherwise stays `not_checked`, never `matched` (§10 "never matched or green"). `none` gives `not_applicable`. The full rule with staged control totals is BE-L2's.
- **422 on `putConnectorMappings` for an action-only connector (`target_kind = 'none'`) with mappings** answers `connector.target_invalid`; the trigger's own refusal maps to the same code.
- **The demo connector's `created_by`** is the demo access administrator (a technical administrator; a stamp only). Its connector page shows it disabled and never tested.

## 7. User-facing texts made untrue

None. `grep` over `apps/web/src/i18n/en/*.json` (and the API navigation sources) finds no string that calls connectors or integrations planned or later. The connector problem texts do not exist yet (§5 item 6).

## 8. What remains (not done by BE-L; owners named in §B/A)

- **REQ-S17-001 is not complete.** Still to come:
  - BE-L2: scheduled, manual and retry runs, the real local test adapter (effect counter, fixtures), `http_pull` with the fake HTTP source and the adapter contract suite, the worker handler and queue, and the job-identity migration.
  - FE-C: the pages.
  - QA-A: A17.
- **REQ-S17-005:** BE-O's degradation test and FE-C's page.
- The `server.ts` lines of §5 items 1 and 3.

## Final check results (second pass, after the fixes)

Every command below ran on the final source tree. The source was last changed at 01:17Z; after that only this handback and the evidence logs changed.

| # | Command | Result |
|---|---|---|
| 1b | `pnpm -r typecheck` | exit 0 (`typecheck-r2.log`) |
| 1b | `pnpm -r build` | exit 0 (`build-r2.log`) |
| 1b | `pnpm lint` | exit 0 (`lint-r2.log`) |
| 1b | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`prettier-r2.log`; run after this handback was written) |
| 1b | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (`openapi-lint-r2.log`) |
| 2b | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | exit 0. unit-node 160 files / 2475 tests passed; unit-web 96 / 1768 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped (261). Every Vitest invocation passed (`unit-locale-unset-r2.log`). |
| 2b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0. unit-node 160 / 2475; unit-web 96 / 1768; nocodegen 3 / 259 passed, 2 skipped (`unit-c-utf8-r2.log`) |
| 3 | `QA_PG_PORT=24110 MTH_PORT_POOL=24111-24149 tests/qa/support/with-pg.sh pnpm test:integration` | **Not finished when this handback was written** (see below) (`integration.log`) |
| 3r | `QA_PG_PORT=24120 MTH_PORT_POOL=24121-24129 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/response-validation.test.ts` | exit 0, 109/109 (`response-validation-rerun.log`) |
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` | exit 0 (start of the task) |

**The full integration run (check 3): completed after the handback was first written. Exit 1, disclosed.**

- `integration.log` ends `== exit=1 2026-10-29T02:32:52Z`: **Test Files 1 failed | 336 passed (337); Tests 2 failed | 3425 passed | 1 skipped | 1 todo (3429)**.
- The run started at about 01:30Z on the final source. Until about 02:05Z it shared the host with both `pnpm test` reruns, typecheck and build.
- Every BE-L file passed: `integrations/connectors.test.ts` 20/20, `contract/contract.test.ts` 101/101 (with the +6 pin), and the demo suites.
- **The only failing file is `contract/response-validation.test.ts`, 2 of 109 tests.** This file imports `contract.test.ts` and reruns the whole contract suite. The same two tests **passed** in the `contract.test.ts` instance of the same run, and in the isolated rerun 3r (109/109, exit 0).
  1. "P5 BE-J operations (p5-exercises-be-j.ts)", `p5-exercises-be-j.ts:61`: `listDependencySlips` returned 0 items where the seam expects 1 critical slip. The seam writes a DG4 milestone move and expects one slip in its own world. It reads no connector, run, service-identity or demo row, and BE-L changed no portfolio or DG4 code. The likely cause is an interaction between two copies of the same seam running in parallel against the shared per-run database, under load. That is **not proven**; I left it to the seam's owner and the orchestrator.
  2. "every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written": "Test timed out in 30000ms" on the default budget (the F-DG5-145/146 class). My six new body operations make the sweep slightly longer. **For the orchestrator:** give this sweep a measured budget (rule 13).
- **Open:** a clean full integration run of the merged tree, unloaded. Check 3 is **not** reported as passed. The only pinned-count change made by this task is the JSON-body media-type pin (+6, 397 → 403).

**End time:** `2026-10-29T02:33:14Z` (`date -u`). The handback was first written at 02:18:55Z; this section was updated when the integration run completed.
