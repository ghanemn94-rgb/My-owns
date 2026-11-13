# Handback T-DG7-BE-B: readiness and the deployment status (backend-workflow-engineer)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `HEAD` `19210be7ad93701af8af62933918998c403dbac5`; working tree clean at start except this run's own run directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-B.md` (sha256 `6ef7f740…6d75`, verified). Scope: `docs/architecture/p7-work-split.md` §B.1, ADR-0069 §1–§3, D-243 Q6/Q17, D-250 O1–O3.
- **Invocation:** run `DG7-T-DG7-BE-B-backend-workflow-engineer-20261112T233904Z-2a3deed3`, session `2a3deed3-4236-4c92-8da5-6b6ac67bd5a4`.
- **Time:** start `2026-11-12T23:39:12Z`, end `2026-11-13T00:12Z` (about 33 minutes).
- **Two gate systems:** none of this is a business, Finance or IT approval. Nothing reads or writes DG0–DG7, and no G1–G6 is involved.

## Summary

- **Migrations: none.** Slice B adds no table, and `0150`–`0152` are untouched. The highest shipped migration is still `0148_p7_retention_job`.
- **Endpoints:**
  - **New:** `GET /api/v1/admin/deployment` (`getDeploymentStatus`, `operations.read`).
  - **Changed:** `GET /readyz` (`getReadiness`) now always sends `checks.storage` and `checks.worker`, and storage gates readiness.
- **Advisory locks:** none allocated; 730416–730417 stay reserved.
- **Permission codes:** none added.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/evidence/readiness.ts` (new) | `createEvidenceStorageProbe({ environment, secrets })` returns the probe `(db) => { status, driver, source, errorCode }`. **Filesystem:** `stat` is a directory, plus `access(R_OK\|W_OK)`. **S3:** a dedicated adapter (one attempt, 2 000 ms connection and request timeouts, plus a hard 2 000 ms race) runs `head("mth-readiness-probe")`; an object or "no such key" counts as `ok`. An incomplete setting is `NotConfigured`, i.e. `fail`. The result is cached 5 s per process and concurrent callers share one probe. The setting is read through Kysely, which releases its client before the S3 call. |
| `apps/api/src/modules/platform/health.ts` | `createReadiness(pool, files, probes)`: the shared rule. `registerHealthRoutes(app, pool, files, probes)` now returns it. Storage and worker are evaluated only when `database` is `ok` and after the client is released; otherwise both are `unknown` and no probe is called. Ready = database, migrations **and** storage `ok`. A failed heartbeat read is `unknown`; a throwing storage probe is `fail`. The B.5 warn/info lines are logged once per storage state change. |
| `apps/api/src/modules/platform/deployment.ts` (new) | `registerDeploymentRoutes(app, pool, files, { readiness, appBaseUrl, requireAccess, workerStaleAfterSeconds })`: `getDeploymentStatus`. Also `deploymentStatusView` / `readinessView` (zod mirrors), `CONTRACT_VERSION`, `apiAppVersion()` (the worker's rule: `unknown` when unreadable) and `subPathWarning()` (the B.5 text). |
| `apps/api/src/modules/platform/index.ts` | Export lines for the health and deployment symbols. |
| `apps/api/src/server.ts` | Wiring:<br>- `createEvidenceStorageProbe` and `readWorkerHeartbeat` (through a worker adapter) are passed to `registerHealthRoutes`.<br>- One `registerDeploymentRoutes` call, whose `requireAccess` is `operations.read` decided as `getWorkerHeartbeat` decides it: `organizationsWith` + `authorize` on an organization, else 403.<br>- The sub-path warning is logged once at build when `appBaseUrl.pathname !== "/"`. |
| `apps/api/src/modules/platform/health.test.ts` | T-B1. The two existing encoding tests were updated to the 4-key body. |
| `apps/api/src/server.test.ts` | T-B8 (readiness lines only). |
| `apps/api/test/integration/platform/readiness-storage-worker.test.ts` (new) | T-B2 |
| `apps/api/test/integration/platform/deployment-status.test.ts` (new) | T-B4, T-B5, T-B6 |
| `apps/api/test/integration/contract/p7-exercises-be-b.ts` (new) | T-B7 |
| `apps/api/test/integration/contract/contract.test.ts` | The import, the mirrors spread and the `it(...)` hook for `p7-exercises-be-b.ts`. The count pin (965) is unchanged. |
| `apps/api/test/support/p7-pending-be-b.ts` | Now `[]`. |
| `docs/operations/health-readiness.md` | Adds the storage/worker keys, which key gates, the vocabulary, the B.3 readiness sentence, the log lines, the DG1 change note (D-250 O2) and the deployment status. The P1 "worker has no health probe" bullet is updated. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-B-evidence/*.log` | Check logs. |

## 2. Behaviour per requirement

**REQ-S19-010** ("the readiness endpoint reports database, storage and worker status"):

- `/readyz` always sends `database`, `migrations`, `storage` (`ok|fail|unknown`) and `worker` (`alive|stale|unknown`).
- Storage gates readiness; the worker never does.
- `unknown` is never reported as `ok` or `alive`.
- The body never holds an endpoint, bucket, path, error text or SecretRef name, and neither does the log line (T-B2 checks both against canaries).
- Tests: T-B1, T-B2, T-B7, T-B8.

**REQ-S01-006** (different base URL):

- `getDeploymentStatus` reports `baseUrl`, `origin` (`URL.origin`, the value the CSRF check compares) and `basePath`, all read from `config.appBaseUrl` per request.
- Tests: T-B4 (origin and basePath), T-B6 (see gap 1).

**ADR-0069 §3, `getDeploymentStatus`.** The body validates against the contract's `DeploymentStatus` and the zod mirror. Its fields:

| Field | Value |
| --- | --- |
| `release.appVersion` | The API's `package.json` version (`0.1.0`). |
| `release.contractVersion` | `1.6.0-p7` (see gap 2). |
| `schema` | The readiness migration status; shipped, applied and pending counts; `latestApplied` = the stem of the highest applied file. |
| `readiness` | Identical to `/readyz`'s body (asserted in T-B4). |
| `storage` | Status, driver and source only. |
| `worker` | Status, newest beat and 90 s threshold. |
| `environmentKind` | From `deployment_environment`, or `null`. |
| `checkedAt` | The database clock. |

- Access: 200 for ADM_TECH, TO, KDS, TD and AUD; 403 for SP, TL, BO, WL, FIN, CM, SEC, ADM_METHOD, ADM_ACCESS and a user without grants; 401 without a session; 400 for an undeclared query parameter (T-B4).
- It is a read: no audit event is written (asserted in T-B4).
- No optimistic concurrency applies, since nothing is updated.

## 3. Checks actually run

Environment: Node 24.21.0, `MTH_PNPM_OFFLINE=1`, uid 0 inside the agent sandbox, no network. Integration tests ran on a disposable PostgreSQL via `tests/qa/support/with-pg.sh`, with PostgreSQL in a user namespace.

| Command | Exit | Result (log in `T-DG7-BE-B-evidence/`) |
| --- | --- | --- |
| `pnpm -r typecheck` | 0 | `typecheck.log`. A first run exited 2 (TS4111 index-signature access in my T-B2 file); fixed and re-run. |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm test` | 0 | `pnpm-test.log`:<br>- unit-node: 201 files / 2965 tests passed<br>- unit-web: 125 / 2113 passed<br>- unit-formula-nocodegen: 3 files, 259 passed and 2 skipped (I didn't touch that suite)<br>It includes `health.test.ts` (T-B1, 8/8) and `server.test.ts` (T-B8, 7/7). |
| `tests/qa/support/with-pg.sh npx vitest run --project integration` over `readiness-storage-worker.test.ts`, `deployment-status.test.ts`, `contract/contract.test.ts` and `contract/response-validation.test.ts` | 0 | 4 files, 246/246 passed (`integration.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier-check.log`. A first run exited 123: my T-B2 file was not formatted. Formatted and re-run. |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`). Run at the end of the task, not before implementation. |

**Intermediate failures, all fixed and re-run:**

- **T-B2:** two assertions relied on the fake S3's operation label. It labels an authenticated 404 "Refused", so I now assert the method, path and status instead. The heartbeat trigger forbids moving a beat backwards, so the stale case re-inserts the row.
- **T-B6:** the first form failed at config load (see gap 1). After the rewrite, the dev login also needed the hub's own `Origin`.
- **T-B7:** the first run failed with "getReadiness response has no X-Request-Id": the separate Fastify app for the 503 case had no header hook.

**Test ids:**

- **T-B1, T-B2, T-B4, T-B5, T-B7, T-B8:** pass as specified.
- **T-B6:** passes in its adjusted form (gap 1).
- **T-B3, T-B9 to T-B14:** owned by DO-D, DO-E and DOC-B; not run here.

## 4. Known gaps / not done

1. **T-B6 differs from the work split. This is open question 1.**
   - **The conflict:** `packages/config/src/load.ts` (DG1, outside my file set) already refuses `APP_BASE_URL` with a path: `APP_BASE_URL is invalid (must be an origin without path, query or fragment)`. "`APP_BASE_URL=http://127.0.0.1:<p>/hub/` → the API starts" is therefore false from the environment. ADR-0069 §1.4 assumed the API accepts it.
   - **What I did:** I did not loosen the loader, which would change DG1 behaviour. T-B6 now proves three things:
     - (a) the loader refuses `/hub/`;
     - (b) a configuration with `/hub/` that reaches `buildServer` still starts (listens), logs the B.5 warning exactly once at warn, and reports `basePath: "/hub/"`;
     - (c) an origin-root URL logs no warning.
   - **Effect:** the warning in `server.ts` is defence in depth and unreachable from a normal deployment. `health-readiness.md` says so.
2. **`release.contractVersion` is a constant** (`CONTRACT_VERSION = "1.6.0-p7"` in `deployment.ts`), not read from a served document. The API does not serve or ship `openapi.yaml` at run time. A test in `deployment-status.test.ts` fails if the constant differs from `info.version`, so the next contract version bump must update it.
3. **Naming deviations from §B.1:**
   - The probe is created by `createEvidenceStorageProbe(options)`, because it needs the environment default and the SecretProvider, and it keeps a per-process cache. `server.ts` holds the result as `probeEvidenceStorage`.
   - `registerDeploymentRoutes` takes `(app, pool, files, options)`, where options carries the shared `readiness` (one encoding cache and one log state with `/readyz`), `appBaseUrl`, the injected `operations.read` check and the stale threshold. It does not take a separate `probes`.
   - The platform cannot import `access` (ADR-0002), so the authorization is passed in from `server.ts`.
4. **`errorCode` in the probe result.** The result has a fourth field, `errorCode` (for example `ENOENT`, `EROFS`, `Timeout`, `NotConfigured`, or the SDK's error name). It feeds the B.5 log line only and is never put in `/readyz` or `getDeploymentStatus`. An S3 failure's code is parsed from the adapter's sanitized message, so a connection refusal may log the generic `Error`.
5. **Database check failed (for example a non-UTF8 database).** `getDeploymentStatus.schema` then has `status: fail`, `appliedCount`/`pendingCount` 0 and `latestApplied: null`, because the contract requires integers. The `fail` status and `readiness.checks.database: fail` mark it. In practice a caller cannot even authenticate without the database.
6. **Read-only case of T-B2 as uid 0.** The agent runs as root, which bypasses mode bits. The test therefore uses a read-only mount (`/usr`, `EROFS` in this sandbox) when uid is 0, and fails explicitly, rather than skipping, if no such mount exists. As a non-root user it uses a `0555` directory.
7. **The real S3 probe is proven against the P6 fake S3 only,** plus a silent TCP server for the timeout case. No real object store was used (ADR-0069 Residual 4).
8. **I did not run the `--historical` validator before implementing,** as `CLAUDE.md` asks; I ran it at the end (exit 0).

## 5. Open questions / merge instructions

- **O1 (orchestrator):** T-B6 against the DG1 config loader (gap 1). Either accept T-B6 as delivered (loader refusal + `buildServer` defence), or decide a DG1 change to the loader (owner and reopen record needed). I recommend the former; it matches D-243 Q17 "sub-path only if already supported".
- **O2:** ADR-0069 §1.4 and `p7-work-split.md` §B.4 T-B6 state that the API starts with a path. They are the architect's files; please correct the text, or record the deviation in decisions.
- **Merge:**
  - No migration and no ordering constraint.
  - `p7-pending-be-b.ts` is empty, so `getDeploymentStatus` now counts as routed in the contract test.
  - `registerHealthRoutes` now requires a fourth argument. `server.ts` and `health.test.ts` are its only callers today, plus `p7-exercises-be-b.ts`.
  - DOC-B's deployment guide can link `docs/operations/health-readiness.md` §"Storage and worker in `/readyz`" for the B.5 readiness sentence. DO-D's drill can read `getDeploymentStatus.origin`, `.readiness.status` and `.environmentKind` as ADR-0069 §4 D7 expects.
