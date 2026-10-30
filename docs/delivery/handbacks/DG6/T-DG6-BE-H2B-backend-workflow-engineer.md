# Handback T-DG6-BE-H2B (continuation of T-DG6-BE-H2): driver selection, `storage_driver`, Administration > Storage, the export-file store

- **Role:** backend-workflow-engineer (project agent).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-H2B-backend-workflow-engineer-20261030T040849Z-a782b8ba","session_id":"a782b8ba-6230-4667-a3fe-50d613cb2d00"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-H2B.md` (sha256 `bbf8dad9803d4c09e2351641acc419dd9cf46ebb7279bbbd32be4dc7dfcec543`, verified). Section: `docs/architecture/p6-work-split.md` §J/C.9.
- **Stage:** P6, gate DG6 (BUILDING). Nothing here reads or writes DG0–DG7 records. Nothing approves anything: product gates G1–G6 are business approvals inside the product, and no agent grants a real business, Finance or IT approval. Every value in the tests is synthetic. The object store is proven only against the in-process fake S3 (`apps/api/test/support/fake-s3.ts`). No live IT object store was contacted, and none is claimed (§2 rule 14).
- **Start / end (UTC):** `date -u` at the start gave `Fri Oct 30 04:09:08 UTC 2026`; at the end: `Fri Oct 30 06:10:15 UTC 2026` (about 2 h 1 min).
- **Starting revision:** `e1b181c6ba866cbf6a5013846f0cf2d3dc2d41d9`. It is the orchestrator's merge of the integrated branch (`ff1e975a3`) into BE-H2's WIP commit `94166f30346ae27330971c0f2f30737cba279f99`. The working tree was clean at the start.
- **Branch discrepancy (disclosed):** the assignment says the worktree is "on branch `dg6/be-h2b`". `git status` reports **`dg6/be-h2`**. I worked on the tree as given and left every change uncommitted.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → **exit 0**, `PASS gate DG5 (historical)`. Log: `T-DG6-BE-H2B-evidence/validate-dg5-historical-start.log`. Re-run at the end: **exit 0**, `PASS gate DG5 (historical)` (`validate-dg5-historical-end.log`).

## 1. Who wrote what

BE-H2 (killed by a container restart, exit 143, before it wrote a handback) committed its partial tree as `94166f3`. I reviewed it critically, file by file.

**Kept from BE-H2 (reviewed, correct):**

- `evidence/store.ts`: the driver selection. This is `SelectingEvidenceStore`: a write uses the effective setting (the saved row, else the environment), the driver is remembered per key until the content row commits, and a read opens the store that `evidence_content.storage_driver` names. Also `loadEffectiveStorage`, `s3SettingsKey`, `storageTestTarget`, and the F-DG4-160 rewrite of the stale DG2 comment "configuring it here makes every content operation 503".
- `evidence/routes.ts`: the upload writes `storage_driver`. An object-store `finalise` (copy + delete, which is remote I/O) runs before the transaction (§2 rule 4). The filesystem rename stays the last local step inside it, as T-DG2-BE17 placed it.
- `admin/storage.ts`: the three routes, the refusals, the 15-minute test window, the probe and the audit events.
- `server.ts`: the wiring.
- `packages/reporting/src/storage.ts`: the export-file port comment and the refusal text.
- `p6-exercises-be-h2.ts`, `p6-pending-be-h2.ts`, and most of `admin/storage.test.ts`.

**Wrong or missing in BE-H2's tree; fixed or added by me (BE-H2B):**

1. **Unit suite red (3 failures; `T-DG6-BE-H2B-evidence/unit-locale-unset.log`, round 1):**
   - (a) `architecture.test.ts`: "modules/admin/storage.ts: computed member with a non-literal key (line 224) bypasses the module-interface check". I rewrote `checkedS3` without the computed key.
   - (b) `evidence.test.ts`: the evidence module's public `index.ts` had been widened by 4 exports, so the P2 exact-surface test failed. I restored `evidence/index.ts` to its pre-WIP content. `server.ts` (the composition root) now imports `evidence/store.ts` directly, following the existing BE-I precedent (`./modules/tasks/channels/email.ts`).
   - (c) `advisory-locks.test.ts`: `admin/storage.ts` spelled the class number 730307 in two comments. They now name `storageSetting`.
2. **Contract seam lost in the merge:** `e1b181c` took the integrated `contract.test.ts`, which dropped BE-H2's import, mirror spread and `it(...)` lines. The result was `putStorageSetting` and `testStorageSetting` "not covered" (`integration-contract-run1.log`). I re-added the three lines and updated the JSON-body pin to the post-merge base: 423 + 2 = **425**, JSON 421 + 2 = **423** (§5).
3. **Rule tightened:** a `filesystem` save that **changes** the s3 values kept with it now also needs a passing test (422 `storage.test_required`). Those kept values are the ones earlier s3-held files are read with. Unchanged or absent values need none. Tested.
4. **Log redaction hook:** `s3EvidenceStoreFor` now calls `registerRedactedStorageEndpoint(endpoint)` (DO-D's hook; `docs/operations/monitoring.md` §6 names T-DG6-BE-H2 for it). From then on, any URL on the store's host logs as `[storage-url]`. Tested.
5. **New test:** an unreachable object store gives the DG2 503 `unavailable` for an s3-held file. There is no fallback and no URL, and the filesystem file is unaffected (§5 has a contract note).
6. **A lint error from my own first edit** (`==`) was fixed. The round-1 lint failure in `lint.log` is that error.

## 2. Files changed (final tree vs `94166f3~1`, the base before BE-H2)

| File | Purpose | Author |
|---|---|---|
| `apps/api/src/modules/evidence/store.ts` | Driver selection (`SelectingEvidenceStore`), effective setting, test target, true header comment; endpoint redaction | BE-H2; redaction line BE-H2B |
| `apps/api/src/modules/evidence/routes.ts` | Upload writes `storage_driver`; remote finalise before the transaction | BE-H2 |
| `apps/api/src/modules/evidence/index.ts` | **Unchanged** (BE-H2's widening reverted) | BE-H2B |
| `apps/api/src/modules/admin/storage.ts` | `getStorageSetting`, `putStorageSetting`, `testStorageSetting` | BE-H2; fixes 1a, 1c, 3 by BE-H2B |
| `apps/api/src/server.ts` | Builds the selecting store; injects the storage port into `admin/storage.ts`; imports `evidence/store.ts` | BE-H2; import line BE-H2B |
| `packages/reporting/src/storage.ts` | Export-file port: comment and refusal text (§6) | BE-H2 |
| `apps/api/test/integration/admin/storage.test.ts` | Integration suite on its own scratch database (13 tests) | BE-H2; 3 additions BE-H2B |
| `apps/api/test/integration/contract/p6-exercises-be-h2.ts` | Contract exercises of the three operations | BE-H2 |
| `apps/api/test/integration/contract/contract.test.ts` | Import, mirror, `it`, JSON-body pin 425/423 | BE-H2B (re-applied after the merge) |
| `apps/api/test/support/p6-pending-be-h2.ts` | Emptied | BE-H2 |
| `docs/delivery/handbacks/DG6/T-DG6-BE-H2B-*` | This handback and its logs | BE-H2B |

No migration. No schema, `openapi.yaml`, dependency or i18n change.

## 3. Behaviour delivered

### REQ-S16-006

The requirement: "Evidence bytes are written through the adapter interface; filesystem is the default; an S3-compatible adapter is configurable". Acceptance: "A18;A12: contract tests pass for both adapters; evidence is never served from a public URL".

- **Contract tests for both adapters:** BE-H's suite (`store-contract.test.ts`, filesystem × S3 against the SigV4-verifying fake) passes on this tree: targeted run, `evidence/` 5 files, 98/98.
- **Through the adapter interface; filesystem the default:**
  - With no `storage_setting` row the effective driver is the environment's (`filesystem` in every profile). `GET /api/v1/admin/storage` answers `source: "environment"`, ETag `"0"`.
  - An upload lands on the filesystem with `storage_driver = 'filesystem'`, and the fake receives nothing. This equals DG5.
  - Test: "with no row the behaviour equals DG5…".
- **S3 configurable:**
  - `putStorageSetting` s3 without a passing test → 422 `storage.test_required`, nothing written.
  - After `testStorageSetting` passes against the fake, the save works: `"0"` creates, version 1, one `storage_setting.changed` audit event (prior null → 1), and the trigger writes the history row.
  - A **new** upload then lands in the fake S3 under the prefix with `storage_driver = 's3'`. The earlier filesystem file is still downloadable.
  - Switching back to `filesystem` keeps the s3 file readable.
- **Never from a public URL (A12):**
  - Both files download through the API: 200, the bytes, `attachment`, no `Location`, no store URL in any header.
  - An anonymous GET on the fake of the stored object is 403.
  - The test route never returns a URL, endpoint, bucket, key or credential, and leaves no probe object behind.
  - A store that serves anonymous reads fails the test (`storage.anonymous_read_allowed`), and its values cannot be saved.
  - `publicUrls` is always `false`.
- **Every refusal of ADR-0054 §4 this operation can produce:**
  - `storage.s3_incomplete`
  - `storage.secret_ref_invalid` (a secret value, an unregistered provider, a missing name; the canary value is never echoed)
  - `storage.test_required`
  - `admin.reason_required`
  - plus 400, 409 and 428.
- **Authorization:**
  - `storage.configure` is held at organization scope (ADM_TECH). A business-unit-scope grant is 403.
  - AUD reads through `operations.read` (200) and gets 403 on PUT and on test. A user with neither code gets 403.
  - A grant revoked while the PUT waits is 403 at commit time, and nothing is written.
- **No remote I/O in a transaction:** the probe runs under the `storageSetting` advisory lock held as a session lock on its own connection, with no transaction open. Its audit event is written after it. The s3 `finalise` runs before the upload transaction.
- **Unreachable store:** 503 `unavailable` for its files only, with no fallback and no URL (new test).

## 4. Operations routed (delta to `p6-pending-be-h2.ts`)

`["getStorageSetting", "putStorageSetting", "testStorageSetting"]` → `[]`. All three are exercised in `p6-exercises-be-h2.ts`. Each has a success, plus 400/401/403 and, for the writes, 409, 422 (every code) and 428. The exercise saves only a `filesystem` row in the shared database, which equals the environment default, so concurrent files keep using the filesystem store.

## 5. For the orchestrator (contract, schema, dependency)

- **Contract pin (`contract.test.ts`):** + `putStorageSetting` and `testStorageSetting` (2 JSON bodies; `getStorageSetting` is a GET). On this tree: `withBody` 423 → **425**, `application/json` 421 → **423**. The operation count is unchanged: the ARCH-02 operations were already counted.
- **Contract gap (pre-existing since DG2; not changed by me):** `downloadEvidenceContent` (and the other content operations) do not declare the **503** the route has answered since DG2 for an unavailable store. ADR-0054 §4 keeps that 503 unchanged in both modes. My new test makes that one call with `contract: false` and asserts the problem body instead.
  - **Proposal:** add `"503": { $ref: "#/components/responses/Unavailable" }` (or the shared equivalent) to the evidence content operations in `openapi.yaml`, then drop the `contract: false`.
- **No migration, no schema change, no new dependency.**
- **Export files (decision to confirm):** export files stay on the filesystem store under `EVIDENCE_STORAGE_PATH`; the saved setting selects the **evidence** store only. The reason is that `export_job` records no storage driver, so moving exports to the object store would strand every earlier export file. A per-job driver column (a migration) would be needed first. No ADR designs object-store exports (ADR-0054 §2 covers evidence; ADR-0058 only names `storage.ts`).
  - `EVIDENCE_STORAGE_DRIVER=s3` in the environment still gives no export-file store (unavailable, never a silent fallback), as at P5. The text in `packages/reporting/src/storage.ts` says so.
  - If the orchestrator wants exports on the object store in DG6, it is a separable follow-up: a migration adding `export_job.storage_driver`, then the reporting store selection and the worker's `export-runner.ts`.
- **Multi-instance note (already in `docs/operations/storage.md` §3):** the 15-minute test window is held per API process, as ADR-0054 §2 specifies.

## 6. User-facing texts made untrue

- en/ar UI strings: none. `nav.json` "Storage" ("Where evidence files are stored, with credential references, never the secrets.") and the three `problems.json` storage texts are true. No en/ar string called storage planned.
- **Documents owned by others** (not in my ownership; for their owners):
  - `docs/operations/storage.md` §8 row "Driver selection … **Not yet on this tree.** `admin/storage.ts` registers no route, and `EVIDENCE_STORAGE_DRIVER=s3` still answers 503…" is untrue once this merges. The routes, the driver selection and `storage_driver` are delivered. s3 named **only** through the environment, without a saved setting, still answers 503.
  - `docs/operations/storage.md` §5: "Whether export files follow the object-store setting is decided by … BE-H2" should now say that export files stay on the filesystem store (see §5 above), and the "export files on the object store" item in §8 is not delivered. Owner: DO-C.
  - `docs/operations/configuration.md` line 131: "The optional S3-compatible adapter is a later-stage item (P6)." It is delivered in P6, configured through Administration > Storage. Owner: the configuration document's owner (DO-A/DO-C).
  - `docs/operations/monitoring.md` §6 row "Registering the production object-store endpoint for URL redaction | follows the S3 adapter's configuration (T-DG6-BE-H2)" can now say the adapter registers it whenever a store is built from a saved setting or a tested candidate. Owner: DO-D.
- Test name only (not user-facing; not mine): `evidence.test.ts` "the S3-compatible driver is not part of P2 and fails closed" still passes. Its message matches `/P6/` because the environment-only s3 store remains 503. The title is dated, and its owner may rename it.

## 7. Checks (real exit codes; logs in `docs/delivery/handbacks/DG6/T-DG6-BE-H2B-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Harness ports 25350–25399 (`QA_PG_PORT=25350`, `MTH_PORT_POOL=25351-25399`). Disposable PostgreSQL through `tests/qa/support/with-pg.sh`. Empty `.claude/.cc-writes` folders in source trees: none found.

### 7.1 Final tree (round 2, after the last code edit; `r2-checks-summary.txt`)

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | **0** | `r2-typecheck.log` |
| `pnpm -r build` | **0** | `r2-build.log` |
| `pnpm lint` | **0** | `r2-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `r2-prettier.log` |
| `pnpm openapi:lint` | **0** | `r2-openapi-lint.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | `unit-node` **exit 1**: 1 failed / 2721 passed (176 files). The failure is `server.test.ts` "declares access on every /api route…", **timed out at 5105 ms** against the 5000 ms default; it took 3262 ms and 3002 ms in the round-1 runs. Rerun alone with the locale unset: exit 0, 6/6, 1102 ms (`r2-unit-server-test-alone-unset.log`). See the note below. `unit-web` and `unit-formula-nocodegen`: **NOT COMPLETE at handback** | `r2-unit-locale-unset.log` |
| `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **NOT RUN at handback** (queued after the unset run) | `r2-unit-c-utf8.log` |
| `QA_PG_PORT=25350 MTH_PORT_POOL=25351-25399 tests/qa/support/with-pg.sh pnpm test:integration` | **NOT RUN at handback** (queued after the unit runs). Only the targeted runs of §7.2 ran. | `r2-integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | **0** | `validate-dg5-historical-start.log` |

This handback was written into the tree after the round-2 prettier step had run. It was checked on its own: `npx prettier --check` on this file → exit 0.

**The `server.test.ts` timeout:**

- That test builds the whole server against an unreachable database (`127.0.0.1:1`, refused at once).
- BE-H2's sweep adds one database read on `onReady`, which fails immediately there. It was already present in round 1, where the test passed in about 3 s.
- The 5.1 s run happened while other P6 runs shared the host (D-004: up to four).
- I attribute it to load, as D-201 did for the W5 timeouts, but it is **not closed**: the orchestrator's merged-tree run decides. If it recurs, raising that test's timeout belongs to the owner of `server.test.ts` (not in my ownership).

### 7.2 Targeted integration runs during the work (disposable PostgreSQL)

| Run | Tree | Result | Log |
|---|---|---|---|
| `admin/storage.test.ts` + `evidence/` (5 files) | after fix 3, before 4–5 | exit 0, **98/98** | `integration-targeted-run1.log` |
| `contract/` (3 files) | before fix 2 | **exit 1**, 4 failed / 207 passed: the pin `[425, 423, 1]` vs `[423, 421, 1]`, and `putStorageSetting`/`testStorageSetting` not covered (each twice: `response-validation.test.ts` imports `contract.test.ts`). These are the merge seams of §1 item 2. | `integration-contract-run1.log` |
| `contract/` (3 files) | after fix 2 | exit 0, **213/213** | `integration-contract-run2.log` |
| `admin/storage.test.ts` | with the new 503 test, before `contract: false` | **exit 1**, 1 failed / 12 passed: the harness refused the undeclared 503 (§5 contract gap) | `integration-storage-run2.log` |
| `admin/storage.test.ts` | after it | exit 0, **13/13** | `integration-storage-run3.log` |

### 7.3 Round 1 (superseded; disclosed; logs in `round1/`)

Run on the tree before fixes 1a–1c and the `==` fix:

- typecheck 0, build 0, prettier 0, openapi:lint 0.
- **lint 1**: one `eqeqeq` error in my first edit; fixed.
- **unit, locale unset: 1**, and **unit, C.UTF-8: 1**. The same 3 failures each time (§1 item 1), 2719 passed in `unit-node`; `unit-web` 1787/1787; `unit-formula-nocodegen` 259 passed, 2 skipped.
- After the fixes, those three test files passed alone: `npx vitest run --project unit-node` on the 3 files → exit 0, 157/157 (console output, not saved to a log; the round-2 runs above are the evidence).
- The round-1 C.UTF-8 run was still going when I edited the sources. It could not be stopped from my sandbox (separate PID namespace), so it ran on a mixed tree and is not evidence for the final tree.
- Round 2's timing-sensitive suites waited for it to finish (`round1 finished … at 05:41:42`).


### 7.4 Round-2 runs that finished AFTER the handback was first written (added at 07:13Z; the background script was then stopped at its time limit)

`r2-checks-summary.txt`:

- **`pnpm test`, locale unset: exit 1** (05:41–06:11).
  - `unit-node`: 1 failed / 2721 passed, the `server.test.ts` 5 s timeout of §7.1.
  - `unit-web`: 1787/1787.
  - `unit-formula-nocodegen`: 259 passed, 2 skipped.
- **`pnpm test`, `C.UTF-8`: exit 1** (06:11–06:41).
  - `unit-node`: 1 failed / 2721 passed. The failure is a **different** test: `architecture.test.ts` "apps/web never imports @mth/db or @mth/config" timed out at 30000 ms. That static import scan doesn't touch my files, and in the unset run the same test passed.
  - `unit-web`: 1787/1787.
  - `unit-formula-nocodegen`: 259 passed, 2 skipped.
  - I attribute both unit failures to host load, but they are **not closed**.
- **`pnpm test:integration`: INCOMPLETE.** The background script reached its time limit and was stopped mid-run, so there is no final count or exit code. Up to that point (`r2-integration.log`): 823 tests passed and 4 failed. `contract.test.ts` passed 102/102.
  - `forms/form-records.test.ts` "at most 5000 rows…": timed out at 60003 ms (load).
  - `worker/…/adoption-below-trajectory.test.ts`, the event-to-queue registry: "connector.run_failed: expected 'integrations.connector_exception' to be 'automation.evaluate'".
  - `worker/…/operations-freshness.test.ts` × 2: "starter 16 version 2 … with the three triggers" (array mismatch), and "a KPI older than staleAfterDays → one data_stale exception" (array mismatch).
  - The last three are BE-K2 / BE-L seams in the integrated branch (the outbox event registry and migration 0116's trigger set). They come from neither BE-H2's files nor mine, so they go to the orchestrator for the merge reconciliation.
  - Whether `admin/storage.test.ts` and the `evidence/` files had run before the stop isn't shown in the log. Their targeted runs are in §7.2.

## 8. What remains

Ordered list:

1. **Acceptance checks not completed within the time limit (not claimed):**
   - Both `pnpm test` runs ended with exit 1, each from one timeout (§7.4).
   - The full `pnpm test:integration` was stopped mid-run with 4 failures, none in my files (§7.4). The completed integration evidence is the targeted runs of §7.2: storage 13/13, evidence 98/98 (before fixes 4–5), contract suite 213/213.
   - The round-2 script (`$TMPDIR/checks2.sh`) was left running and appends to `r2-checks-summary.txt` until my run ends. Any line that appears after this handback was not inspected by me.
   - **The orchestrator's merged-tree verification must supply acceptance items 2 and 3.**
2. **Orchestrator decisions:**
   - The export-file store stays filesystem-only (§5). Exports on the object store would need a migration (`export_job.storage_driver`) and a follow-up task.
   - The undeclared 503 on the evidence content operations (§5).
3. **Document owners:** the four untrue statements of §6 (DO-C, DO-D, configuration document).
4. **FE-B:** `pages/admin/storage/**`. The page must show "Not tested" until a test has run (ADR-0054 §7), and AUD gets a read-only page.

Separable second half: none named by the section. Items 1–4 are all outside the delivered code.

## 9. Merge instructions

- No migration. Merge after BE-H and BE-D (both already on this tree).
- Expected conflicts: `apps/api/test/integration/contract/contract.test.ts` (the JSON-body pin and comment block; reconcile with the parallel deltas) and `apps/api/src/server.ts` (the BE-H2 block next to BE-G/BE-I).
- FE-B can now build `pages/admin/storage/**` against the three operations.
