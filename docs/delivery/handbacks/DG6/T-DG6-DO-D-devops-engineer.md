# Handback: T-DG6-DO-D (devops-engineer), stage DG6, p6-work-split §J/C.5

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-DO-D-devops-engineer-20261029T024327Z-90ee3dcf","session_id":"90ee3dcf-7e30-4b67-97a2-73858951a6df"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-DO-D.md`, sha256 `762d0ea92c0ae718c54e9892450ada649877b4ef592cf3832b16d62f8d4cf3e8` (verified).
- **Base:** branch `dg6/do-d` at `135ff1db7c9a25314c4700460c02ce714823ec88` (`git status` clean at start). The changes are **uncommitted**, as the assignment requires.
- **Time:** start `Thu Oct 29 02:43:38 UTC 2026`. The end time is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0, at the start (before any edit).
- **Engineering only.** No business, Finance or IT approval is granted or implied. An operational exception approves nothing. Product gates G1–G6 are unrelated to DG0–DG7. All test data and canaries are SYNTHETIC.
- **Not HA proof.** These are local and CI test runs on one disposable PostgreSQL 16.13 cluster. They are not proof of high-availability production monitoring (stated in `docs/operations/monitoring.md`).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/config/src/load.ts` | ADR-0053 §4 redaction set, fed by `loadConfig` (configuration secrets, a postgres URL's password, `EVIDENCE_STORAGE_PATH`) and by `SecretProvider` (`withSecretRedaction`). Adds `redactText`, `redactLogLine` (path censoring of `storageKey`, `storage_key`, `key`, `Key`, `Bucket`, `bucket`, `endpoint` and `s3_*` at any depth), `registerRedactedStorageEndpoint`, `registerRedactedStoragePath`, `REDACTED_LOG_PATHS` and `installConsoleRedaction`. Also loads `WORKER_HEARTBEAT_SECONDS` into `config.worker.heartbeatSeconds` |
| `packages/config/src/index.ts` | `WORKER_HEARTBEAT_SECONDS` catalogue entry (default 30, range 1–30), `HEARTBEAT_INTERVAL_SECONDS`, and the exports |
| `.env.example` | Regenerated with `node deploy/scripts/generate-env-example.mjs` (31 names, no values) |
| `apps/api/src/server.ts` | Redaction lines: pino `redact.paths` = `REDACTED_LOG_PATHS` (the DG1 four plus `x-mth-signature`), `hooks.streamWrite: redactLogLine`, and `withSecretRedaction(createSecretProviderRegistry())` |
| `apps/worker/src/main.ts` | `installConsoleRedaction()` at module start, `withSecretRedaction` on the worker registry, and the heartbeat writer wired in: started after `startWorker`, stopped first on shutdown, with its instance key and cadence in the start line |
| `apps/worker/src/heartbeat.ts` (new) | The heartbeat writer. It is a separate module because `main.ts` runs `main()` on import and cannot be tested; `main.ts` only wires it. See §5 |
| `deploy/scripts/log-scan.mjs` (new) | The post-suite log scan (ADR-0053 §5) |
| `deploy/scripts/tests/log-scan.test.mjs` (new) | Its `node:test` self-test with a negative fixture built at run time |
| `deploy/scripts/tests/log-scan.vitest.mjs` (new) | Runs that self-test inside `pnpm test` (unit-node), following the `dep-audit.vitest.mjs` precedent |
| `deploy/ci/ci.yml` | Integration job: the database password becomes the canary `mth-canary-ci-db-password`, plus the S3, SMTP and OIDC canaries and `MTH_TEST_LOG_DIR`. The suite output is teed, then the scan's self-test and the scan run (`if: !cancelled()`). The images job's deploy self-test step adds `log-scan.test.mjs` |
| `apps/api/test/support/harness.ts` | Opt-in only: with `MTH_TEST_LOG_DIR` set, `startApi` without its own `logStream` writes the composed server's log lines to `<dir>/api-<pid>.log`. Unset (the default), nothing changes |
| `apps/api/test/integration/operations/log-redaction.test.ts` (new) | Wiring proof against `buildServer`: header tokens, link token, OIDC parameters, a value resolved through the server's registry, storage fields, the storage path and signed-URL parameters |
| `apps/worker/test/integration/heartbeat.test.ts` (new) | Heartbeat writer against PostgreSQL as `mth_app` |
| `packages/config/src/redaction.test.ts` (new) | One unit test per redaction class (23 tests) |
| `packages/config/src/load.test.ts` | The worker config object gains `heartbeatSeconds`; adds the `WORKER_HEARTBEAT_SECONDS` default, range and refusal tests (+6) |
| `apps/api/test/integration/shutdown-cleanup.test.ts` | One DG2 expectation changed. The sweep's log line must now show `key: "[redacted]"`, as ADR-0053 §4 item 2 requires, and the output must not contain the key. See §5 |
| `apps/api/test/integration/request-io.test.ts` | One diagnostic `console.log` now prints file names instead of absolute evidence-store paths. The first full run's scan caught it (§3.4) |
| `docs/operations/monitoring.md` (new) | Monitoring document: signals, heartbeat, the alert sink IT routes, structured logs, the redaction list and its limits, the log scan, and the production residuals |
| `docs/operations/health-readiness.md`, `configuration.md`, `README.md` | Untrue texts corrected (§6) and links to `monitoring.md` |

There is no migration, no new dependency, no OpenAPI change and no change to a contract pin.

## 2. Behaviour per requirement row

### REQ-S16-029, DO-D's share

Acceptance (quoted): *"A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope"*.

The second clause is BE-J's (§J/C.16). DO-D delivers the first clause.

- **Redaction (ADR-0053 §4).** One process-wide set, applied to every API line (pino `hooks.streamWrite`) and every worker console line:
  - **Item 1, secrets:** every value a registered `SecretProvider` resolves, plus every secret variable `loadConfig` reads and a postgres URL's password. The JSON-escaped and percent-encoded forms are covered too. These print as `[secret]`.
  - **Item 2, storage:** the listed fields are censored by path at any depth (`[redacted]`). A URL on a registered object-store host becomes `[storage-url]`. A path under `EVIDENCE_STORAGE_PATH` becomes `[storage-path]`. `X-Amz-Signature`, `X-Amz-Credential` and `X-Amz-Security-Token` are removed.
  - **Item 3, tokens:** the four DG1 header paths plus `x-mth-signature`. In `req.url`, `/links/<token>` becomes `/links/[token]`, and the OIDC `code`, `state`, `id_token`, `access_token` and `refresh_token` parameters are censored. As defence in depth, bearer tokens, JWTs, private-key blocks and AWS access-key ids are also censored.
  - **Item 4:** already done by BE-K in the worker (`redactErrorText`, `kit.ts`). See the observation in §5.
- **Tests:**
  - **Per class (unit):** `packages/config/src/redaction.test.ts`, 23 tests.
  - **Composed server (integration):** `operations/log-redaction.test.ts`, 2 tests.
- **The scan (ADR-0053 §5):** `deploy/scripts/log-scan.mjs`.
  - **What it reads:** the run's log files under `$TMPDIR`. It refuses any path that is, or contains, `docs/delivery` (D-138).
  - **What fails it:**
    - every `mth-canary-*` environment value, plus `--canary`;
    - the seven ADR patterns;
    - `--store-host` or `MTH_LOG_SCAN_STORE_HOSTS`;
    - the `--storage-path` or `EVIDENCE_STORAGE_PATH` prefix.
  - **Exit codes:** 1 means FAIL, and each hit prints `file:line: class: masked line` (the matched value is never printed). 0 means PASS, with counts. 2 means BLOCKED, never a pass.
  - **Negative fixture:** "the scan fails on the fixture and passes on a clean run". The self-test has 15 `node:test` cases: FAIL for each of the 10 classes, FAIL on the whole fixture, PASS on a clean redacted run, the environment-canary and store-host sources, and BLOCKED cases.
  - **"The scan runs on the integration-suite logs with canary secrets set and prints PASS":** see §3.4.

### REQ-S12-019, DO-D's share (A22 heartbeat writer)

The heartbeat writer is DO-D's part. The row's acceptance, *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*, is BE-K/BE-K2/QA's.

- **What the writer does:**
  - inserts one `worker_heartbeat` row per process (beat 1, on the database clock);
  - moves it forward by exactly one every `WORKER_HEARTBEAT_SECONDS` (default 30, range 1–30), stepping `version` and `beat_count`, which satisfies `worker_heartbeat_forward`;
  - writes no audit event;
  - logs a failed beat as `worker.heartbeat_failed` and never throws;
  - gives a restarted process a new instance key and keeps the old row.
- **Test:** `apps/worker/test/integration/heartbeat.test.ts`, 4 tests, passing.
- **Alert sink:** I read "alert sink" (p6-plan §5.1 DO-D row) as the structured log stream. The contract of the `"alert":true` / `alertCode` line, and what IT routes, is documented in `monitoring.md` §3. The API heartbeat watch (BE-K) already writes that line for `heartbeat_missed`. The remaining alert lines are BE-K2's (§5).

## 3. Checks actually run (logs in `docs/delivery/handbacks/DG6/T-DG6-DO-D-evidence/`)

Environment: Node 24.21.0, offline. PostgreSQL 16.13 disposable cluster through `tests/qa/support/with-pg.sh` on ports 24301–24349 only. No Docker was needed and none was used.

| # | Command | Exit | Result / log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` |
| 2 | `pnpm -r typecheck` | 0 | `typecheck.log`. The first two attempts exited 2: a test-sink typing error, then TS4111 in the harness. Both were fixed before this run |
| 3 | `pnpm -r build` | 0 | `build.log` |
| 4 | `pnpm lint` | 0 | `lint.log` (re-run at the end, see §8) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` (re-run at the end, see §8) |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` |
| 7 | `pnpm test`, locale unset | 0 | unit-node 164 files / **2531** passed. unit-web 96 / **1768** passed. unit-formula-nocodegen 3 / **259** passed, 2 skipped (`unit-locale-unset.log`) |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2531, 1768, 259 + 2 skipped (`unit-locale-cutf8.log`) |
| 9 | `node --test deploy/scripts/tests/log-scan.test.mjs` | 0 | 15/15 pass. Also inside `pnpm test` through `log-scan.vitest.mjs` |
| 10 | `node deploy/scripts/check-ci-needs.mjs deploy/ci/ci.yml` and `node --test deploy/scripts/tests/check-ci-needs.test.mjs` | 0 / 0 | structure OK; 46/46 pass |
| 11 | `node deploy/scripts/generate-env-example.mjs --check` | 0 | `OK: .env.example lists exactly the 31 ENV_VARS names, none with a value` |

My unit-node delta is +30 tests: redaction.test.ts +23, load.test.ts +6, log-scan.vitest.mjs +1.

### 3.1 Integration run 1: full suite, canaries and log directory on, under extra load

Script: `run-integration-and-scan.sh`. It runs `with-pg.sh` and `pnpm test:integration`, with the admin URL carrying the password canary `mth-canary-db-password` (trust auth ignores it; every role URL of the suite carries it), the S3, SMTP and OIDC canaries set, and `MTH_TEST_LOG_DIR` set.

- **Result:** exit 1 after 2,819 s. **340 files: 3 failed, 337 passed. 3,448 tests: 5 failed, 3,441 passed, 1 skipped, 1 todo** (`integration-run1-full-loaded.log`).
- **Load disclosure:** during this run I also ran `pnpm -r build` and `pnpm test` twice on the same machine. That was my mistake: it added load.
- **The 5 failures:**
  1. and 2. `contract.test.ts` and `response-validation.test.ts`, "every route accepts exactly the request media types": `expected [405, 404, 1] to deeply equal [403, 402, 1]`. This is the **W7 JSON-body pin**. BE-K and BE-L are merged on the base, and the pin comment says the orchestrator reconciles the parallel W7 deltas. **DO-D adds no route.** It is not caused by this change and is still present on the base.
  3. `response-validation.test.ts`, "P5 BE-J operations": `expected [] to have a length of 1`.
  4. `response-validation.test.ts`, "an undeclared request media type…": a 30 s timeout. Both 3 and 4 **passed when re-run alone**, with and without the logger (§3.2). They are the same pair D-201 attributes to load in W5. I attribute them to the extra load I added.
  5. `shutdown-cleanup.test.ts`, the F-DG2-460 sweep. **Caused by this change:** the test expected the storage `key` in a log line, and ADR-0053 §4 now censors it. The expectation is updated, and the file passes 4/4 alone.
- **Scan on run 1:** `log-scan-run1.txt` shows exit 1. **One hit in 122,104 lines** (2 files, 5 canaries, 7 patterns, 1 storage path): a test diagnostic in `request-io.test.ts:373` printed absolute evidence-store paths. This is test output, not application output. The 28.9 MB API log had **no hit**. The diagnostic is fixed to print file names.

### 3.2 Targeted re-runs, alone (nothing else running)

- **Plain** (`integration-rerun-alone-plain.log`), with no `MTH_TEST_LOG_DIR`: `response-validation`, `request-io`, `shutdown-cleanup`, `log-redaction` and worker `heartbeat`. **129 tests: 128 passed, 1 failed.** The failure is the W7 JSON-body pin only. Exit 1, for that seam alone.
- **With the log directory** (`integration-rerun-alone-logdir.log`): `response-validation` and `request-io`. **119 tests: 118 passed, 1 failed** (the same pin). Exit 1. The scan on that directory printed `log-scan: PASS: 1 file(s), 23396 line(s), 1 canary value(s), 7 fixed pattern(s), 0 store host(s), 1 storage path(s)`.

### 3.3 Integration run 2: full clean rerun, scan included

Results are in §8, written when the run finished.

### 3.4 What a canary proves

The database-password canary flows through every connection URL of the suite. The S3, SMTP and OIDC canaries are process environment values: the `env` provider resolves them only when a test references those names. For those secrets, the scan proves absence from the logs, not that every code path was exercised. `monitoring.md` §5 says so too.

## 4. Operations routed (pending-list delta)

None. DO-D owns no operation and no `p6-pending-*.ts` file. There is no change to `contract.test.ts` pins from DO-D. The failing JSON-body pin (403 → 405) is the W7 BE-K/BE-L reconciliation.

## 5. For the orchestrator: contract, schema, dependency and file notes

- **No dependency, no migration, no schema change.**
- **`.github/workflows/ci.yml`** is the installed copy. Re-install it from `deploy/ci/ci.yml` (the D-199 precedent) so CI runs the scan.
- **Files outside the §J/C.5 list, each the minimum needed:**
  - `apps/worker/src/heartbeat.ts`: the writer, because `main.ts` is not importable.
  - `apps/api/test/support/harness.ts`: the opt-in log file, without which the suite writes no API logs to scan.
  - `shutdown-cleanup.test.ts` and `request-io.test.ts`: one line each (§3.1).
  - New tests and `docs/operations/{README,configuration,health-readiness}.md`.
  - p6-plan §8 lists `kit.ts` for DO-D's heartbeat, but the binding §J/C.5 says `main.ts`. I followed §J/C.5 and did not touch `kit.ts`.
- **BE-K's heartbeat tests (assumption, D-004):** the writer fills every column of `worker_heartbeat` as 0101 defines it. Instance keys are `worker-<24 hex>`, inside the CHECK. `app_version` comes from `apps/worker/package.json`. `queue_count` is the distinct queue names served (fixed queues, domain handlers, retry and run-now). BE-K's route reads the rows unchanged.
- **BE-H2:** call `registerRedactedStorageEndpoint(endpoint)` from `@mth/config` where the S3 adapter is configured, from the setting row or the environment. Until then the object-store-host URL rule has no host to match. Key and path censoring and X-Amz removal apply regardless.
- **Observations, not fixed here (other owners' files):**
  - **(a)** The API's `raiseOperationalException` (`operations/exceptions.ts:598`) does not redact itself; it relies on callers. Today's callers pass code-built or fixed texts. ADR-0053 §4 item 4 asks for the redactor; `redactText` from `@mth/config` is available. Owner: BE-K.
  - **(b)** The worker's `job_failed` opening (`kit.ts`) writes no `"alert":true` line yet (`kit.ts:896` says the alert is BE-K2's). Owner: BE-K2.
  - **(c)** Censoring `key` at any depth is broad, as ADR-0053 §4 lists it. Any log field named `key` prints `[redacted]`.

## 6. User-facing texts made untrue, and what I did

- No en/ar UI string is affected: DO-D ships no UI.
- **Operations documents:**
  - **`docs/operations/configuration.md`:** said the worker's `SecretProvider` registration is "a planned P6 item … `SECRETS_DIR` has no effect in the worker". That was untrue since D-198. **Corrected**, and the redaction is added.
  - **`docs/operations/health-readiness.md` (Logs):** said only `authorization`, `cookie` and `set-cookie` are redacted, and that monitoring is "later stage". **Corrected**, with links to `monitoring.md`.
  - **`docs/operations/README.md`:** added the `monitoring.md` row and `log-scan.mjs`.

## 7. What remains

- The alert line and in-app notification for the non-heartbeat failure classes: BE-K2 (§5 b). Item 4 inside the API raise: BE-K (§5 a). Feeding the store endpoint: BE-H2.
- The W7 JSON-body pin reconciliation (403/402 → 405/404 after BE-K/BE-L, plus DO-C if it adds any): orchestrator.
- The QA-E A22 run of the scan on the frozen candidate.

## 8. End-of-task results

### Integration run 2

- **Setup:** `run-integration-and-scan.sh`, the same canaries and `MTH_TEST_LOG_DIR` as run 1, and no other workload on the machine. Start `04:02:55`, end `04:51:21` UTC.
- **Integration:** exit 1 after 2,906 s.
  - **340 files: 2 failed, 338 passed.**
  - **3,448 tests: 2 failed, 3,444 passed, 1 skipped, 1 todo.**
  - Log: `integration-run2-full.log`.
- **The 2 failures:** only the W7 JSON-body pin, once in `contract.test.ts` and once in `response-validation.test.ts`: `expected [ 405, 404, 1 ] to deeply equal [ 403, 402, 1 ]`. It is not caused by DO-D (§3.1, §4).
- **Run-1 failures:** the `shutdown-cleanup` failure is fixed, and the two load-attributed `response-validation` failures did not recur.
- **Pinned counts:** DO-D asks for no pin change. The pin above needs the orchestrator's W7 reconciliation (403 → 405 JSON bodies, 402 → 404 `application/json`).
- **Post-suite log scan:** exit 0.

  ```
  log-scan: PASS: 2 file(s), 122996 line(s), 5 canary value(s), 7 fixed pattern(s), 0 store host(s), 1 storage path(s)
  ```

  The scanned files were not kept: they hold synthetic test data and are 29 MB. Their checksums and line counts are in `run2-scanned-files.sha256`.

  | File | Lines | sha256 |
  |---|---|---|
  | `api-103.log` | 121,066 | `489f33b4…` |
  | `integration-output.log` | 1,930 | `4042073a…` |

  - **Canaries (5):**
    - the database password `mth-canary-db-password`, embedded in the admin URL and therefore in every role URL;
    - `MTH_CANARY_OIDC_CLIENT_SECRET`;
    - `S3_ACCESS_KEY_ID`;
    - `S3_SECRET_ACCESS_KEY`;
    - `SMTP_PASSWORD`.
  - **Storage path:** `$TMPDIR/mth-evidence-it-`.
  - **Store host:** none was configured. No S3 endpoint exists in the suite until BE-H2; the scan reports `0 store host(s)`.

### Closing checks (after the last edits)

| Check | Exit |
|---|---|
| `pnpm lint` | 0 |
| prettier `--check` over `git ls-files -co --exclude-standard` | 0 |
| `pnpm -r typecheck` | 0 |

`pnpm -r build`, `pnpm openapi:lint` and both `pnpm test` runs come from §3 and were not repeated. After them, only test files, docs and the handback changed: `request-io.test.ts` and `shutdown-cleanup.test.ts` (integration tests, re-run in run 2) and this handback. No build input changed.

### Timing

- End: `Thu Oct 29 04:52 UTC 2026`, about 2 h 9 min.
- About 9 min over the limit. I waited for clean run 2 because run 1 had been loaded by my own parallel checks. The implementation items were complete before 100 min.
