# Handback T-DG6-BE-J (backend-workflow-engineer): service identities: declarations, seed, worker scope twin, admin routes

- **Stage:** DG6 (BUILDING), P6 "Integration and system hardening". Section: `docs/architecture/p6-work-split.md` §J/C.1, plus the D-198 worker SecretProvider line.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-J-backend-workflow-engineer-20261028T181139Z-3ffc949a","session_id":"3ffc949a-73cb-46db-8570-4ebb59410bde"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-J.md`, sha256 `c1c261d3d7108022c071343c2bb41dea526ca4231a17c9a1889f7ad5a9e10ed7` (verified).
- **Working tree:** `/home/user/wt/dg6-be-j`, branch `dg6/be-j`, starting `HEAD` `80464fa6ec79f4103149fe2dd0438623de3bf0dc` (clean tracked tree at start). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `Wed Oct 28 18:28:48 UTC 2026`, end `Wed Oct 28 20:16 UTC 2026` (§8).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0 (`T-DG6-BE-J-evidence/validate-dg5-historical.log`).
- **Gates:** nothing here grants, reads or writes a business approval (G1–G6) or an engineering gate record (DG0–DG7). A service identity holds only read and write codes, never `configure`, `business_approval` or `finance_validation` (0101 guard, and a unit test on every declaration). Every value in the tests is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/worker/src/service-scope.ts` (new) | The worker twin of the API `ReadScope` for service principals (ADR-0053 §1, ADR-0051 §1): `serviceReadScopeFor` (SQL `predicate` + in-memory `admits`, with the use `record` or `aggregate`), `requireServiceRead`, `ServiceIdentityError` / `ServiceScopeViolation` (`service_identity.out_of_scope`) / `ServiceIdentityMissing` (`service_identity.missing`) with the exact ADR-0053 §2 English texts, and `apiGrantEquivalent` for the parity test. |
| `apps/worker/src/kit.ts` | The identity-declaration lines: `JOB_SERVICE_IDENTITIES` (one declaration per queue, 40), `jobIdentityDeclaration`, `jobIdentityCode`, `loadServiceIdentity`, `principalOfIdentity`, `servicePrincipal`, `defineJob` (loads the identity before the handler runs and passes `{ identity, principal(organizationId) }`), re-exports of the scope API. Also two `error_code: failureCodeOf(job.error)` lines in `captureJobFailure` so a failure-queue row carries `service_identity.*` instead of `automation.retries_exhausted` when the job failed on its identity (every other error keeps `automation.retries_exhausted`, unchanged). |
| `apps/worker/src/service-identities.test.ts` (new) | Unit: declarations = rows seeded by 0113 (the SQL is parsed as text); one declaration per queue of `queues/**`; every code is a known read/write permission; only the two benefit recalculations are `aggregate_only`; `defineJob` refusals; the exact refusal codes and texts. |
| `packages/db/migrations/0113_p6_job_service_identities.sql` (new) | The seed: 40 `service_identity` rows (`job:<queue>`, platform scope, granted = declared), each with its audit event `service_identity.create` (actor `system`, source `migration`). |
| `apps/api/src/modules/access/service-identities.ts` (new) | The service: DTO mapping, `findServiceIdentity`, the read gate (`visibleServiceIdentity`, 404), `listServiceIdentities`, `putServiceIdentity` (row lock, commit-time re-authorization on the reloaded grants, 409, declaration check, update, audit `service_identity.grant_changed`), the exact 422 refusals. |
| `apps/api/src/modules/access/index.ts` | One export line for `service-identities.ts` (the architecture test refuses deep imports of `access`). |
| `apps/api/src/modules/admin/service-identities.ts` | The three routes (BE-A's stub for BE-J, already registered in `server.ts`). |
| `apps/api/test/integration/operations/service-identity-scope.test.ts` (new) | Integration: seed, out-of-scope proof, worker-twin parity with the API `ReadScope`, grant enforcement through `defineJob`, missing identity, every `putServiceIdentity` rule. |
| `apps/api/test/integration/contract/p6-exercises-be-j.ts` | Contract exercises of the 3 operations (success and every reachable refusal) and their zod mirrors. |
| `apps/api/test/support/p6-pending-be-j.ts` | Emptied (the 3 operations are routed). |
| `apps/worker/src/secrets.ts` (new) | D-198: the worker twin of `apps/api/src/modules/platform/secrets.ts`, verbatim below its header (ADR-0002 rule 5: the worker cannot import the API file that D-198 names). |
| `apps/worker/src/secrets.test.ts` (new) | Twin check (code identical to the API file below the header, read as text), registration order `env`, `file`, a value never prints. |
| `apps/worker/src/main.ts` | D-198: `registerBuiltInSecretProviders(createSecretProviderRegistry(), { secretsDir: config.secretsDir })` (as a named `secrets` registry), and its provider ids (never a value) in the start-up log line. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-J-*` | This handback and its evidence logs. |

## 2. Behaviour delivered, per requirement row

### REQ-S16-029 (BE-J part)

Acceptance: *"A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope"*.

- **"a job's identity cannot read records outside its scope": delivered and proven.** In `service-identity-scope.test.ts` there are two organizations, each with a transformation and two evidence notes, one of them marked sensitive. For **each of the 31 job identities that declare `transformation.read`**, the principal for organization A:
  - selects exactly A's transformation and A's non-sensitive note in SQL, so **0 rows of B are admitted**;
  - includes A's sensitive note only in an `aggregate` use, and only for the two `aggregate_only` identities;
  - has `requireServiceRead` throw `ServiceScopeViolation`, code `service_identity.out_of_scope`, for B's transformation, for B's note and for A's sensitive note.

  The test prints `service-identity scope: 31 job identities, 0 rows of organization B admitted`. A code the identity does not hold (`audit.read`) admits nothing.
- **Parity of the worker twin with the API `ReadScope`** (ADR-0053 §1, "the ADR-0043 identity-twin precedent"). For every identity × both organizations × three permissions (`transformation.read`, `access.read`, `audit.read`), the twin's SQL selection equals the API `readScopeFor(...).predicate` selection, on transformations and on evidence. The API principal is the equivalent organization-scope grant that applies downward. The in-memory `admits` also equals the API's on every evidence record: `960 (identity, organization, permission, record) pairs, 0 mismatches`. The parity covers the per-record use. The API has no aggregate use, so the `aggregate_only` widening is proven separately (above).
- **A job reads with its GRANT, not its declaration.** A `defineJob` handler for `launch.day_ninety_tests` reads A's transformation. After an administrator narrows the grant to `[]` through `putServiceIdentity`, the same run fails with `service_identity.out_of_scope`. After the restore it reads again.
- **A missing identity fails the run with `service_identity.missing`** ("The job has no service identity, so it did not run."). `loadServiceIdentity`, `servicePrincipal` and `defineJob` throw it before the handler runs. The failure-queue row (`captureJobFailure`) then carries `error_code = 'service_identity.missing'` and that message.
- **Declarations = seeded rows** (`service-identities.test.ts`). The test also requires one declaration per queue of `apps/worker/src/queues/**`: `QUEUES`, `DOMAIN_QUEUES`, `automation.failure_retry`, `automation.job_failed` and `jobs.run_now`, 40 at this revision. ADR-0053 §1 says "35 at this revision". The current tree has 40, so all 40 are declared.
- **The declarations** are the narrowest read set each DG5 handler needs, read from the tables each handler file selects:

  | Codes | Queues |
  |---|---|
  | `transformation.read` | most business-record handlers |
  | `+ access.read` | role-mapping and group resolution |
  | `+ user.read` | `app_user` reads |
  | `automation.read` | the automation queues |
  | `job.read` | failure, retry, run-now and schedule |
  | `organization.read` | branding, demo |
  | `methodology.read` | `transformation.created` |
  | none | `maintenance.purge_expired`, `ops.failed` |

  `aggregate_only` applies to `benefits.recalculate_pending` and `benefits.value_decided` only (D-195 Q3: identical totals). Each declaration is proven only against the fixture reads above. The handlers do not read through their principal yet: that is BE-J2/BE-J3. A handler that needs a missing code reports it there, and the declaration changes only through a new migration (§J/C.2).
- **"a log scan after the test suite finds no secrets or storage URLs"** is DO-D's (§J/C.5), not BE-J's. BE-J writes no secret or URL to a log. The worker start-up line now lists the secret provider ids (`["env","file"]`), never a value.

### REQ-S12-019 (BE-J part: "failure on scope", §J/C.16)

Acceptance: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*.

- **BE-J's part:** a run refused by its identity fails with `service_identity.out_of_scope` or `service_identity.missing`, and its failure-queue row carries that code (the test above). The operational exception itself (lock 730305, open/recur, `recovered`) is BE-K's failure hook in `kit.ts`, which comes after BE-J's lines. The connector and KPI-Stale proof is BE-K/BE-K2/BE-L and QA-A/QA-E. **Not claimed here.**

### The three operations (ADR-0053 §1, §9)

| Operation | Behaviour |
|---|---|
| `listServiceIdentities` `GET /api/v1/admin/service-identities?organizationId=&subjectKind=&cursor=&limit=` | `operations.read` at organization level. Returns the platform identities (every job) plus the organization's own (connectors), ordered by `code, id`, with a cursor. 400 bad query; 401; 403 when the caller does not hold the read at that organization; 404 unknown organization. |
| `getServiceIdentity` `GET …/{serviceIdentityId}` | 200 with ETag. 404 when missing or unreadable. A platform identity is readable by an organization-level holder in any organization; a connector identity only in its own organization. |
| `putServiceIdentity` `PUT …/{serviceIdentityId}` | `service_identity.configure` (ADM_TECH). Narrows or restores `grantedPermissionCodes` within the declaration, with a reason (`{grantedPermissionCodes, reason}`, JSON, `config.consumes` = `application/json`). |

Order of the `putServiceIdentity` checks:

1. 400 body (unknown code, duplicate, more than 40, reason of the wrong length);
2. 404 read gate;
3. 403 configure gate (AUD gets 403);
4. 422 `service_identity.reason_required` ("Enter a reason of 3 to 1,000 characters.", shared `reason` rule);
5. 422 `service_identity.grant_exceeds_declaration` ("A service identity can be granted only permissions that its job or connector declares.");
6. 428 without If-Match;
7. inside the transaction:
   - the row is locked `FOR UPDATE`;
   - the session and grants are reloaded and both gates are re-checked at commit (a right lost meanwhile gives 403; tested by a request whose reloaded grants are empty: 403, version and audit unchanged);
   - 409 stale version;
   - the update (version + 1);
   - one audit event `service_identity.grant_changed` with prior and new version, reason, and the before/after of `granted_permission_codes` and `reason`;
   - the trigger-written `service_identity_change` history row (tested).

No remote I/O. The declaration is never changed: the update writes only the columns `mth_app` may update.

### D-198: the worker's SecretProvider

`apps/worker/src/main.ts` registers the built-in `env` and `file` providers at start with `config.secretsDir`. No worker job resolves a secret yet; BE-I and BE-L will be the first. With no new variable set, the worker behaves as DG5.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, 4 CPUs / 15 GB, run beside the other W6 runs. Empty `.claude/.cc-writes` directories inside source folders were removed before each test run. Harness ports used: 23800 (focused run), 23810 with pool 23811–23849 (full run).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `T-DG6-BE-J-evidence/validate-dg5-historical.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 931 operations` | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | all three Vitest invocations: unit-node 160 files / 2475 tests passed; unit-web 96 / 1768 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | every test passed: unit-node 160 / 2475, unit-web 96 / 1768, nocodegen 3 / 259 + 2 skipped. **But unit-node reported `Errors 2 errors`: `[vitest-worker]: Timeout calling "onTaskUpdate"`**, a Vitest RPC timeout, not an assertion. It ran beside the full integration run (#10) on a host at load average ≈ 33 on 4 CPUs (the other W6 runs share it). The same infrastructure error BE-E disclosed. | `test-c-utf8.log` |
| 8b | re-run, `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node`, alone | **1** | 159 / 160 files, 2474 / 2475 tests passed. The 1 failure is a **30 s timeout** in `apps/api/src/architecture.test.ts` › "apps/web never imports @mth/db or @mth/config": a file scan of `apps/web`, which BE-J does not touch, that passed in #7. Plus the same 2 `onTaskUpdate` RPC timeouts. Load average 33.4 at the time (`uptime`). | `test-c-utf8-unit-node-rerun.log` |
| 9 | `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/operations/service-identity-scope.test.ts` | 0 | 10/10 passed; 105 migrations on a fresh PostgreSQL 16.13; prints `31 job identities, 0 rows of organization B admitted` and `960 … pairs, 0 mismatches` | (console; re-run within #10) |
| 10 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | **none: KILLED** | **Incomplete.** The background runner stopped it at the 3,600,000 ms limit I had set; it is single-fork, 311 files. By then about 170 files had run: 167 passed, 3 had failures (below). No final count and no exit code exist. | `test-integration.log` |
| 11 | `QA_PG_PORT=23820 MTH_PORT_POOL=23821-23849 tests/qa/support/with-pg.sh npx vitest run --project integration` on `service-identity-scope.test.ts`, `contract/response-validation.test.ts` (which runs the whole contract suite), `reporting/registers-report.test.ts` and `packages/db/test/integration/catalogue.test.ts` | **1** | 3 / 4 files and **157 / 158 tests passed**. The only failure is the expected JSON-body pin (`expected [ 395, 394, 1 ] to deeply equal [ 394, 393, 1 ]`). The P5 BE-J slip exercise, the undeclared-media-type sweep and the 5,001-row report test all **passed** here. So failures 2–4 of #10 did not recur; they were non-deterministic or load-induced. BE-J's test printed `31 job identities, 0 rows of organization B admitted` and `960 … pairs, 0 mismatches` again. | `test-integration-focused.log` |

**Failures in the partial run #10:**

1. **`contract.test.ts`, and again inside `response-validation.test.ts`**, "every route accepts exactly the request media types its operation declares": `expected [ 395, 394, 1 ] to deeply equal [ 394, 393, 1 ]`. **Caused by BE-J and expected:** `putServiceIdentity` is a new JSON body. This is the pinned-count delta that rule 16 leaves to the orchestrator (§4).
2. **`response-validation.test.ts`** › "P5 BE-J operations (p5-exercises-be-j.ts)": `expected [] to have a length of 1 but got +0` (the dependency-slip list). The **same exercise passed** in the `contract.test.ts` run of the same suite 25 minutes earlier. It touches only the portfolio milestone and slip code, which BE-J does not change. Non-deterministic, not caused by BE-J. The root cause is not investigated (time). The focused re-run #11 re-checks it.
3. **`response-validation.test.ts`** › "every operation: an undeclared request media type is a declared 400 …": **timed out at 30 s**. It took 11.3 s in the `contract.test.ts` run under the same build. Load.
4. **`reporting/registers-report.test.ts`** › "size limit (ADR-0045 §1) > 5,001 rows -> 422 …": **timed out at 120 s**. Not BE-J code. Load.

**Pinned-count change:** only the JSON-body pin above. The operation count stays 931.

## 4. Operations routed (delta to `p6-pending-be-j.ts`)

- Removed: `listServiceIdentities`, `getServiceIdentity`, `putServiceIdentity`. `P6_PENDING_BE_J` is now `[]`.
- Exercised in `p6-exercises-be-j.ts` through `ctx.mirrored`:
  - list: 200 (ADM_TECH, AUD, two pages through the cursor), 400, 401, 403, 404;
  - get: 200 with ETag, 400, 401, 404 (missing), 404 (no `operations.read`);
  - put: 200 narrow, 200 restore, 400, 401, 403 (AUD), 404, 409, 422 ×2 (both codes), 428.
- The PUT narrows and then restores `job:reports.owner_update_tasks`, so the shared world ends as seeded.
- **Pinned-count delta for the orchestrator (D-079 precedent).** `contract.test.ts` line 1066, "every route accepts exactly the request media types its operation declares": `[withBody, application/json, application/octet-stream]` goes from `[394, 393, 1]` to **`[395, 394, 1]`** (+1 JSON body: `putServiceIdentity`). With BE-J alone it fails as `expected [ 395, 394, 1 ] to deeply equal [ 394, 393, 1 ]`, which is expected until the orchestrator reconciles the pin. `contract.test.ts` is not BE-J's file. The operation count (931), the rate-limit floor and the CSRF-exempt list do not change (no new operation; the routes are contract operations).

## 5. Contract, schema, dependency and ownership needs (for the orchestrator)

1. **No zod mirror for `ServiceIdentity` / `ServiceIdentityPage` exists in `packages/shared/src/schemas/**`**, and no file there is in BE-J's list. `p6-exercises-be-j.ts` defines the mirror locally, a restatement of the contract schema. If a shared mirror is wanted (for example for FE-B), it is one new schema file plus a barrel line, and the exercise file then imports it.
2. **Routes in `admin/service-identities.ts`, not in `operations/routes.ts`.** §J/C.1 names "the `admin/service-identities` route lines in `apps/api/src/modules/operations/routes.ts` (BE-K creates the file; BE-J adds its three routes in a named block)". But BE-A already created `admin/service-identities.ts` as "Owned and filled by task BE-J", with its `server.ts` registration line (BE-A handback, file list). BE-J filled that stub. So BE-K's `operations/routes.ts` stays untouched and no BE-J/BE-K sequencing on it is needed. The service file is the one §J/C.1 names, `access/service-identities.ts`.
3. **One line in `apps/api/src/modules/access/index.ts`** (`export * from "./service-identities.ts";`). The architecture test refuses deep imports into `access`, so `admin` reaches the service only through the index.
4. **D-198 needs a worker twin file.** `registerBuiltInSecretProviders` and `createSecretProviderRegistry` live in `apps/api/src/modules/platform/secrets.ts`, which the worker may not import (ADR-0002 rule 5; the worker package does not depend on `@mth/api`). BE-J added `apps/worker/src/secrets.ts`, a verbatim copy below its header, guarded by `secrets.test.ts`, which compares the two files as text. This is a file outside the literal D-198 line. Alternative: move `secrets.ts` into a shared package, an ADR-0052 §5 change.
5. **"Never retried" (ADR-0053 §1) needs one change in `apps/worker/src/worker.ts`, which no P6 task owns** (frozen). Today a `service_identity.*` error fails the run honestly: `job_run` is `failed` and the error propagates. pg-boss still retries it per the queue policy (5 attempts), and the last attempt enters the failure queue with the `service_identity.*` code (BE-J's `failureCodeOf` lines). To skip the retries, `captured` in `worker.ts` would, on `isServiceIdentityError(err)` (exported from `kit.ts`), call `captureJobFailure` at once and complete the job without rethrowing. That is the ADR-0043 forbidden precedent, which completes a rule execution as failed. I did not edit `worker.ts`. Please assign it, for example to BE-K together with its failure hook.
6. **`apps/worker/src/schedules.ts`:** listed in §J/C.1's files, but BE-J needed no line there. Every queue with a `job_schedule` row is declared, and a missing identity is refused at run time by the kit. No change made.
7. **Two small `kit.ts` lines outside "the identity-declaration lines"**, both disclosed: `captureJobFailure`'s `error_code` (insert and update paths) now goes through `failureCodeOf`. The value is unchanged for every non-identity error.
8. **Migration id:** `0113_p6_job_service_identities.sql`, the next above the highest file on this branch (0112), per D-196. ARCH-06 runs at the same time and may ship 0113; renumber at merge if so. The test reads the file by name (`service-identities.test.ts`, `MIGRATION` constant), so a renumber changes that one constant. `packages/db/src/seed.test.ts` accepts ids up to 0133, and its example comment already names 0113 as the free id.
9. **No new dependency.** No new problem code: all four codes are ADR-0053 §2's, with their exact English texts, and the en i18n keys exist (FE-A).

## 6. User-facing texts

- No en/ar string called this feature "planned" or "later". The navigation and problem strings (`nav.json` `serviceIdentities`/`serviceIdentity`, `problems.json` `service_identity__*`) already describe the delivered behaviour. **No text was made untrue; none changed.**
- The 40 Arabic `label_ar` values in 0113 (and `kit.ts`) are provisional wording, like every P6 Arabic text until reviewed.

## 7. What remains

- `worker.ts` "never retried" (item 5 of §5): not done, outside the ownership.
- Handlers reading through their principal: BE-J2/BE-J3 (by design). Each handler's parity test (P5 R2) is theirs.
- The connector identity rows are created by BE-L (ADR-0055). The list and read already include organization-scoped identities, but this branch has none to exercise.
- FE-B: the pages `pages/admin/service-identities/**`.

## 8. Acceptance status (honest summary) and end time

| Assignment acceptance | Status |
|---|---|
| 1. typecheck, build, lint, prettier, openapi:lint exit 0 | **Met** (#2–#6). |
| 2. `pnpm test` passes with the locale unset and with C.UTF-8 in every Vitest invocation | **Locale unset: met** (exit 0, every invocation green). **C.UTF-8: not met as an exit code.** Every assertion passed, but unit-node recorded 2 Vitest `onTaskUpdate` RPC timeouts (exit 1). The alone re-run hit 1 test timeout (`architecture.test.ts` apps/web scan, 30 s) plus the same RPC timeouts, on a host at load average ≈ 33 on 4 CPUs. Neither is in BE-J's code. A C.UTF-8 run on a quieter host is needed before freeze. |
| 3. `with-pg.sh pnpm test:integration` passes | **Not met: the full run did not complete** (stopped at the 60-minute limit after about 170 / 311 files, single-fork, under the same load). In what ran: the expected pin failure, plus three non-deterministic or load failures that passed in the focused re-run #11. Needed: a full integration run on the merged tree (it takes about 90 minutes on this host) with the JSON-body pin reconciled to `[395, 394, 1]`. |
| 4. `validate.mjs --historical --stage DG5` exits 0 | **Met.** |

- **Migration added:** `packages/db/migrations/0113_p6_job_service_identities.sql`. It applied cleanly to a fresh PostgreSQL 16.13 in every integration run (105 migrations).
- **Endpoints added:** `GET /api/v1/admin/service-identities`, `GET /api/v1/admin/service-identities/{serviceIdentityId}`, `PUT /api/v1/admin/service-identities/{serviceIdentityId}`.
- **Merge notes:**
  - renumber 0113 if ARCH-06 ships a migration first, and update the `MIGRATION` constant in `apps/worker/src/service-identities.test.ts`;
  - `kit.ts` is edited in the order BE-J → BE-K → BE-I2 (BE-J's block is appended at the end of the file, plus the two `failureCodeOf` lines in `captureJobFailure`);
  - `access/index.ts` gets one appended line;
  - reconcile the JSON-body pin in `contract.test.ts` to `[395, 394, 1]` (plus any parallel W6 deltas).
- **End:** `Wed Oct 28 20:16 UTC 2026` (about 108 minutes after the 18:28:48 start).
