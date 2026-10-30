# Handback: T-DG6-BE-S, index and query fixes and the full-scale export proof (backend-workflow-engineer)

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING.
  - This handback decides nothing about the DG6 engineering gate.
  - Product gates G1–G6 are untouched. Nothing here grants a business, Finance or IT approval.
  - The load dataset, its users and every export in the evidence are synthetic.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-S.md` (sha256 `2ab6cf47…ed363ef6`, verified with `sha256sum`). Scope: `docs/architecture/p6-work-split.md` §H/G.9, ADR-0058 §6 and §7.
- **Invocation:** `DG6-T-DG6-BE-S-backend-workflow-engineer-20261030T143753Z-0bf2eb42`, session `0bf2eb42-62bb-4d06-aa69-448d9008def1`.
- **Working tree:** `/home/user/wt/dg6-be-s`, branch `dg6/be-s`, `HEAD` `7109a7c12`. The tree was clean at the start (`git status`). My changes are **uncommitted**.
- **Time:** started `2026-10-30T14:38:19Z`, finished `2026-10-30T16:00:49Z` (`date -u`).
- **Evidence:** `docs/delivery/handbacks/DG6/T-DG6-BE-S-evidence/`.
- **Node:** every check ran on Node 24.21.0 (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`; each log's first line records `node -v`).

## 1. Changed files

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0119_p6_audit_required_index_use.sql` (new) | Fix 1. `CREATE OR REPLACE FUNCTION p2_audit_required()`: one changed line. `a.record_type = TG_TABLE_NAME` becomes `a.record_type = TG_TABLE_NAME::text COLLATE "default"`, so the deferred audit check uses `audit_event_record_idx` again. |
| `apps/api/src/modules/reporting/reports/snapshots.ts` | Fix 2, in `insertSnapshot`'s named lines only. A snapshot's `report_snapshot_source`, `report_snapshot_version` and `report_snapshot_evidence` rows are written in multi-row INSERTs of at most 500 rows (`INSERT_BATCH`, `batches()`), instead of one INSERT per row. Same rows, same first-seen dedupe, same id order, same triggers. |
| `apps/api/src/modules/reporting/reports/snapshot-batches.test.ts` (new) | Unit test of `batches()`: order, chunk sizes, no empty INSERT, bind-parameter bound. |
| `packages/db/test/integration/audit-required-index.test.ts` (new) | 0119 integration test on the real PostgreSQL (8 tests). The function text is checked. The check is positive (an audited write commits) and negative (none, another version, another record type → `23000`, `<table>_audit_required`, 0010's message). Plan tests: 0119's comparison is an index condition on both leading keys, and two **negative controls** show that 0010's form and a bare `::text` are not. |
| `packages/db/src/seed.test.ts` | The free-id example moves from 0119 to 0120, with one comment line (the precedent of every earlier P6 migration). |
| `deploy/load/export-proof.mjs` (new) | The ADR-0058 §7 proof script, run against the load database, outside every Vitest project. It exits 1 on any failed assertion and 2 on a setup error. |
| `deploy/load/export-proof.node-test.mjs` (new) | `node --test` of the proof's pure helpers: nearest rank, non-decreasing percent, the deterministic 50-user matching. This follows DO-F's `harness.node-test.mjs` (no Vitest project includes `deploy/`). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-S-*` (new) | This handback and its evidence folder. |

I made no change to the contract, the OpenAPI file, `schema.ts`, the catalogue test, a pending list, `P6_OPERATION_IDS`, the outbox registry, `apps/worker/src/kit.ts` or any i18n file.

## 2. What DO-F's evidence named, and what I did with each item

Source: `docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1/explain/createExport.explain-digest-all-statements.md` and its raw log `createExport.auto-explain.all-statements.log.gz`. I read the raw log statement by statement (in sequence) to attribute each item to its request.

| # | DO-F's item | What the raw log shows | Action |
| --- | --- | --- | --- |
| 1 | `report_snapshot_source` inserted row by row (759 inserts for 7 exports) | Confirmed. Inside one live-selection `createExport`, each source row is one INSERT, followed by its FK and trigger statements. | **Fixed** (fix 2): multi-row INSERTs, chunks of 500. |
| 2 | Deferred `p2_audit_required` costs up to 64.5 ms per call (DO-E's `TG_TABLE_NAME` candidate) | Confirmed, and the cause is more precise than "text vs name". The plan's `Index Cond` holds only `record_id`, and `record_type` is a `Filter` over the whole `(record_type, record_id, seq)` index (1,123 buffers). My first attempt, a bare `TG_TABLE_NAME::text`, **still** missed the index: `name` carries collation `"C"`, and the cast keeps it, while the column has the database default. That is why the test has the second negative control. | **Fixed** (fix 1, migration 0119): `::text COLLATE "default"`. Equality under a deterministic collation is byte equality, so the check accepts and refuses exactly the same rows. The test proves both directions. |
| 3 | The scoped-assignment permission query runs about 41× per request | **Not confirmed for `createExport`.** One live-selection `createExport` loads the principal's assignments three times: the session principal, the live check, and the commit-time `refreshPrincipal` that shared rule 4 requires. The 290 occurrences in the digest cover every request of every session during the pass. | No change. Caching the scope would also break shared rule 4 (re-authorization at commit) and p6-work-split §H/G.14 item 1 ("never cache a scope across requests"). |
| 4 | Initiatives and dependencies read once per row (265× each) | **Not `createExport`.** These are `loadScheduleFacts` (`portfolio/roadmap.ts`), issued by `getInitiative` (session → `select * from initiative where id` → … → `roadmap_wave` / `milestone` / `dependency`) in the same pass. They belong to the ordinary-read class, which met its target in run-1 (745.8 ms). | No change: no evidence of a miss, and no index or query is added without one (ADR-0058 §6). |

No new index: no statement DO-F's evidence names lacks one. Statement 3's index (`audit_event_record_idx`, 0003) existed but could not be used until fix 1. The migration therefore replaces a function and creates no index.

## 3. Before/after measurement (ADR-0058 §6 "each with its before/after measurement")

### 3a. Controlled A/B on one load database

The driver is `load-driver.sh.txt`, with its output in `load-driver-output.txt` (exit 0).

- **Setup:**
  - one disposable PostgreSQL 16.15 cluster on 25930, inside `with-pg.sh`;
  - `mth-db migrate` (111 migrations);
  - the `default` profile from DO-F's patched generator copy, sha256 `6b2a9007…`, the same hash as DO-F's run-1 copy (orchestrator item 2 below);
  - 100 sessions from `sessions.mjs`;
  - the generator's requested `search.reindex` run to completion before any measurement.
- **The four configurations** ran back to back on the same database, each with a freshly started API and worker (`MTH_ENV=load`, `NODE_ENV=production`, `AUTH_MODE=oidc`, product default rate limits, as DO-F's driver):
  - the 0010 or the 0119 function body, switched with `CREATE OR REPLACE` on this throwaway database only. `fn-before-0010.sql.txt` and `fn-after-0119.sql.txt` differ in exactly one line (checked with `diff`);
  - the API built before my change or after it. The "before" build was a copy of `HEAD`'s `apps/api/dist`, taken before any edit. The driver logs both `snapshots.js` hashes: the old build has 0 batch loops, the new one 3.
- **The measured operation** is the export proof itself (§4), run once per configuration.
- **Host:** load average 10.7–15.0 on 4 CPUs throughout. The host was shared with other agents, and my own unit and integration chains ran at the same time.

| configuration | part A start p50 / p95 / max (ms) | part B (50 at once) start p50 / p95 / max (ms) | B starts > 2 s | jobs succeeded |
| --- | --- | --- | --- | --- |
| before (0010 + old API) | 226.7 / 807.6 / 807.6 | 2,817.7 / 3,479.5 / 3,771.3 | 50 of 50 | 66 of 66 |
| code (0010 + new API) | 165.2 / 753.4 / 753.4 | 2,946.3 / 3,760.7 / 3,797.2 | 49 of 50 | 66 of 66 |
| sql (0119 + old API) | 245.0 / 968.8 / 968.8 | 3,126.0 / 3,386.0 / 3,911.9 | 50 of 50 | 66 of 66 |
| **after** (0119 + new API: the handed-back tree) | **153.6 / 597.4 / 597.4** | **2,803.5 / 3,259.1 / 3,262.5** | **48 of 50** | **66 of 66** |

Full table with completion times: `export-proof-comparison.md`. Raw data: `export-proof-{before,code,sql,after}.json`.

**Reading, stated plainly:**

- With both fixes, part A's start p95 falls from 807.6 ms to 597.4 ms, and part B's max from 3,771 ms to 3,262 ms.
- On this oversubscribed host, the run-to-run spread is about as large as these differences (part B's p50 ranges from 2.80 to 3.13 s across configurations), and there was one run per configuration. **I do not claim a statistically established improvement of `createExport` start from this A/B.**
- The authoritative before/after for the export-start class is DO-G's final run on the frozen tree, compared with run-1's 2,688.1 ms p95 (ADR-0058 §1, "a re-run after a fix is reported beside the first run").

### 3b. Fix 1 on bulk audited writes (indicative; different runs)

The same patched generator wrote the same 100,000-audit-event dataset, seed 20261027:

| | wall time | of which the COMMIT (deferred audit checks) |
| --- | --- | --- |
| DO-F, 0010 body (`T-DG6-DO-F-evidence/load/generate-patched-default.txt`) | 384,943 ms | about 339.6 s (the "committing" line at 45.3 s, then exit) |
| BE-S, 0119 applied (`load-driver-output.txt`) | **48,094 ms** | about 3.6 s (the generator reports 44.5 s before its commit) |

These are two runs at different times on the same host type, so this is indicative, not a controlled A/B. The direction and size match the plan change: each deferred check went from a whole-index scan to an index lookup.

## 4. The export proof (REQ-S20-030; ADR-0058 §7)

`node deploy/load/export-proof.mjs --sessions … --base-url … --db-url … --out …` checks the following.

**Part A, `LOAD-T01` (250 initiatives).** Every section the export offers for the transformation: each report definition whose subject is the transformation and that needs no reporting period (`diagnostic`, `tom`, `business_cases`, `roadmap`, `registers`), in xlsx and in csv where the definition offers the format. For `registers`, each of its six registers is a separate export. That makes 16 exports by one requester.

**Part B.** 50 exports started at once: one per transformation, by 50 different load users (a deterministic maximum matching), `registers/raid`, csv.

**Assertions for each export:**

- `createExport` returns 202 with the job id within 2 s;
- `percent` never decreases, ends at 100, and the status is `succeeded`;
- the requester downloads the file (200, non-empty, SHA-256 equal to `fileSha256`);
- another load user with the same transformation scope gets 404 on `getExport` and on the download;
- an AUD user gets 404 on both. A same-scope AUD is used where one exists, otherwise an AUD of another transformation; the JSON records `audSameScope`.

**Final run on the handed-back tree (configuration `after`, `export-proof-after.json`).** The script exited **1**: 66 exports, 48 of them with at least one failed assertion (48 slow starts; one of them, LOAD-T20, also has the missing-witness failure below).

- **Part A: 16 of 16 pass every assertion.** Start 32–597 ms. Each percent sequence rises to 100. Every requester download is 200 with a matching SHA-256. The same-scope other user and the AUD user each get 404/404.
  - **Limit:** no AUD load user is assigned to LOAD-T01 in the generated dataset, so part A's AUD witness is an AUD of another transformation (`audSameScope: false`). It still gets 404, but that is the weaker form of the check.
- **Part B: 50 of 50 jobs succeed.** Percent is non-decreasing to 100, the requester downloads (200, SHA-256 matches), and AUD gets 404/404 on all 50 (13 of them same-scope).
  - The same-scope other user gets 404/404 on 49 of 50. For **LOAD-T20**, no second non-AUD load user holds that transformation, so the check could not run there. The script counts that as a failed assertion ("no sameScopeOther user for this transformation"), the same in all four configurations.
- **But 48 of 50 starts exceed 2 s** (p50 2,803 ms, max 3,262 ms).
- **Failed assertions, all configurations:** these two only. The 2 s start (50 / 49 / 50 / 48 of 50), and the missing LOAD-T20 witness (1 in each). Every other assertion passes everywhere: 202 with an id, percent to 100, `succeeded`, the requester's download and SHA-256, 404 for the other user where one exists, and 404 for AUD.
- **Completion times** (reported; no target): part A p50 1.77 s, max 3.26 s; part B p50 48.9 s, max 99.1 s. The worker drains 50 jobs one after another.
- **`EXPORT_MAX_BYTES`:** the largest file was 60,328 bytes, against the 200 MiB cap. **No reopen candidate from the cap.**

**What the part-B miss means.** A live-selection `createExport` assembles and stores the report snapshot inside the request (ADR-0045 §2; `exports/jobs.ts`). The 202 body must carry the `snapshotId` (`ExportJob.snapshotId` is a non-null uuid in the contract). Fifty of those at the same instant, on one API process with a 20-connection pool on an oversubscribed 4-CPU host, queue for 2.8–3.3 s. Making the start independent of the selection's size would mean moving live-selection assembly into the worker. That is a change of the DG5 `createExport` behaviour and contract, so I did not make it (orchestrator item 3).

## 5. Behaviour delivered, per requirement row

**REQ-S20-029.** Acceptance: "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding".

- BE-S's part (§H/G.9) is delivered: fixes 1 and 2 for the items DO-F's evidence names, each with the before/after measurement in §3, and the two evidence items that do not hold explained in §2.
- **The row is not complete.** The final report with the actual p95 figures and any miss listed as a finding is DO-G's final run on the frozen tree (§H/G.10, §H/G.13).

**REQ-S20-030.** Acceptance: "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester".

- Delivered:
  - the proof script (`deploy/load/export-proof.mjs`) and its run on the full load dataset, with the ADR-0058 §7 reading of "the full load dataset" (largest transformation, every section, xlsx and csv; plus 50 at once);
  - "progress rises to 100%" holds for 66 of 66 exports;
  - "the file downloads only for the requester" holds wherever it was tested: 200 for the requester on 66 of 66; 404 for a same-scope other user on 65 of 65 (LOAD-T20 has no such user in the dataset); 404 for AUD on 66 of 66 (13 same-scope, the rest an AUD of another transformation);
  - "returns … with a job ID" holds for 66 of 66 (202 with an id).
- "**Immediately**", operationalized by ADR-0058 §7 as "within 2 s":
  - holds for all 16 single exports of LOAD-T01 (max 597 ms);
  - **does not hold for 48 of the 50 exports started at the same instant** on this host (max 3,262 ms).
  - I report this as measured: a **finding candidate** for the orchestrator (proposed Medium, non-mandatory by analogy with D-195 Q9's rule for load-target misses; the orchestrator classifies it), plus the reopen candidate in §8 item 3.
  - The row stays open for DO-G's final run and QA-E.

## 6. Checks actually run

**Environment.**

- Host: 4 vCPU, 16 GB RAM, no swap, kernel 6.18.44-fc-v185. It was shared with other agents: 1-minute load average 8–15 during the checks.
- Node 24.21.0, pnpm offline.
- Ports, all inside my 25900–25949 range:
  - the full integration run: 25910, pool 25911–25929;
  - the targeted run: 25936, pool 25937–25945;
  - the load cluster: 25930 (pool 25931–25935), with the API on 25940;
  - the first single-file runs: 25900, pool 25901–25909.
- Empty `.claude/.cc-writes` directories in source folders were removed before the tests (3 found).
- Scripts: `checks-a.sh.txt` (integration) and `checks-b.sh.txt` (typecheck → unit). Every result line is in `checks-summary.txt`.

| # | Command | Exit | Wall | Result / counts | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | 166 s | `PASS gate DG5 (historical)`. My first attempt, at the start, ran with a shell `&` and was killed when that shell exited (empty log, no result); I re-ran it as a proper background task. | `validate-dg5-historical.txt` |
| 2 | `pnpm -r typecheck` | **0** | 423 s | All packages (chain run, ended 14:55Z). **Re-run on the final tree** (after the formatting-only edits): exit **0**, 311 s. | `typecheck.log`, `typecheck-final.log` |
| 3 | `pnpm -r build` | **0** | 262 s | All packages (chain run, ended 14:59Z). **Re-run on the final tree**: exit **0**, 243 s. | `build.log`, `build-final.log` |
| 4 | `pnpm lint` | **0** | 103 s, then 109 s | It ran twice: once in the chain (15:01Z), and again on the final source (15:31Z), because `prettier --write` reformatted four of my files during or after the first run (three at about 15:00Z, `export-proof.mjs` at 15:10Z). Both exit 0. | `lint.log`, `lint-final.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | 180 s | "All matched files use Prettier code style!" (15:29Z). After my last edits to this handback I re-checked it and `export-proof-comparison.md` alone with `npx prettier --check`: exit 0, "All matched files use Prettier code style!". | `prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | 2 s | — | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE -u LC_MESSAGES pnpm test` | **0** | 1,043 s | Every Vitest invocation passed: unit-node **177** files / **2,725** tests; unit-web **99** / **1,789**; unit-formula-nocodegen **3** files, **259 passed and 2 skipped** (261). | `test-unit-locale-unset.log` |
| 8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | 862 s | The same counts: 177 / 2,725; 99 / 1,789; 3 / 259 passed and 2 skipped | `test-unit-c-utf8.log` |
| 9 | `QA_PG_PORT=25910 MTH_PORT_POOL=25911-25929 tests/qa/support/with-pg.sh pnpm test:integration` (attempt 1) | **1** | 310 s | **Infrastructure crash, not a test failure.** After 11 files, all passing, the single Vitest fork died: `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` (tinypool). No test reported a failure before it. `pnpm -r typecheck` was running in parallel on the shared, swapless 16 GB host; I can't read the kernel log (`dmesg`: "Operation not permitted"), so the cause (likely the OOM killer) is **not established**. Kept for disclosure. | `test-integration-attempt1-fork-crash.log` |
| 9b | The same command (attempt 2) | **1** | 2,422 s | **The same fork crash** (`ERR_IPC_CHANNEL_CLOSED`) at 15:36Z, after **171 of the 379 files** the include globs match (169 passed, 2 with failures; 2,605 tests in those files, 3 failed). It again coincided with `tsc` (my final typecheck re-run) and a second Vitest process starting on the shared host. **The 3 failed tests:** (1) `assistant/conversations.test.ts` › "the rate-limit class `assistant` and the log line … each post writes one log line without the prompt": `expected { …(8) } to match object { …(5) }`, the deterministic failure DO-FB found on the integrated branch before my change (outside my files: `modules/assistant/**` and its test); (2) `contract/response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)": `expected [] to have a length of 1 but got +0` (the dependency-slip list after a milestone write); (3) the same file › "every operation: an undeclared request media type is a declared 400 …": `Test timed out in 30000ms`. (2) and (3) are the two failures DO-FB found under load, and **both pass alone** (row 9c). | `test-integration.log` |
| 9c | `QA_PG_PORT=25946 MTH_PORT_POOL=25947-25949 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/response-validation.test.ts` | **0** | 154 s | **110 / 110 passed**, including "P5 BE-J operations" and the media-type sweep. Both failures need the full run and are not reproduced alone, as in DO-FB 9b. Their owner is the contract test's. | `rerun-response-validation.log` |
| 9d | The **208 files attempt 2 did not reach**, in one invocation: `QA_PG_PORT=25910 MTH_PORT_POOL=25911-25929 tests/qa/support/with-pg.sh npx vitest run --project integration $(cat test-integration-remaining-files.txt)` | **1** | 1,290 s | **208 files: 207 passed, 1 failed; 1,308 tests: 1,305 passed, 1 failed, 1 skipped, 1 todo.** The skip and the todo are in-file markers of `governance/presentation.test.ts` and `security/rate-limits.test.ts` ("export: no operation wired yet (todo)"), neither mine. **The failed test:** `admin/security.test.ts` › "getSecurityRateLimits > ADM_TECH and AUD read every class …". It is **deterministic**: it fails alone too (row 9e). The test expects the `webhook` class to have `operationIds: []`, and the server reports `["receiveWebhook"]`. That is a merge seam between the test (last changed by BE-T/BE-P2) and the webhook routing (BE-N), already on the integrated branch. I changed neither file, nor any rate-limit code. | `test-integration-remaining.log`, `test-integration-remaining-files.txt` |
| 9e | `QA_PG_PORT=25946 MTH_PORT_POOL=25947-25949 timeout 600 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/admin/security.test.ts` | **1** | 23 s | 7 passed, **1 failed**, the same test: `- "operationIds": []` / `+ "operationIds": ["receiveWebhook"]` for `"name": "webhook"` | `rerun-admin-security.log` | `test-integration-remaining.log`, `test-integration-remaining-files.txt` |
| 10 | `QA_PG_PORT=25936 MTH_PORT_POOL=25937-25945 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/reporting/ packages/db/test/integration/ tests/qa/integration/a15-outputs-every-definition.test.ts tests/qa/integration/a15-selected-records-and-injection.test.ts tests/qa/integration/a13-jobs-rerun.test.ts apps/api/test/integration/access/sensitive-reads.test.ts` (supplementary: the areas my change touches) | **0** | 780 s | **51 files / 477 tests passed**. That covers every reporting test, including `report-snapshots`, `registers-report`, `exports*` and the assemblers; the db package, including `catalogue`, `migrate`, `load-dataset` and the new `audit-required-index` (8); the A13 job re-run; both A15 output suites; and sensitive reads. | `test-integration-targeted.log` |
| 11 | `node --test deploy/load/export-proof.node-test.mjs deploy/load/harness.node-test.mjs` | **0** | <1 s | 11 / 11 pass (4 mine, 7 DO-F's) | `node-test.log` |
| 12 | The load driver: `QA_PG_PORT=25930 MTH_PORT_POOL=25931-25935 tests/qa/support/with-pg.sh bash load-driver.sh.txt` | **0** | 11 min | Generation, sessions, reindex, then the 4 configurations of §3 | `load-driver-output.txt` |
| 12a | `node deploy/load/export-proof.mjs …` in each configuration | **1, 1, 1, 1** | about 140 s each | **1 means at least one assertion failed**, as designed. Two failures appear in every configuration. Part B's 2 s start (50 / 49 / 50 / 48 of 50), and LOAD-T20's missing same-scope witness, 1 each: a dataset limit, see §4. Every other assertion passes in every configuration. | `export-proof-{before,code,sql,after}.json`, `export-proof-comparison.md` |
| 13 | `npx vitest run --project unit-node apps/api/src/modules/reporting/reports/snapshot-batches.test.ts`; then `with-pg.sh npx vitest run --project integration packages/db/test/integration/audit-required-index.test.ts` (twice) | 0; **1**, then 0 | — | 3/3 passed. The first DB run **failed** 1 of 6 tests: my first fix (a bare `::text`) still did not reach the index, which is the collation finding in §2 item 2. After the fix it passed 8/8. Console output only, no log file. The test is also in run 10 (8/8 passed) and in run 9d's file list; attempt 2 (9b) did not reach it. | — |

**Integration coverage, all together.** The literal acceptance command (item 3) **did not exit 0**. Both of its full runs (9, 9b) ended in a Vitest fork crash. To cover the suite in the time left, I ran the files attempt 2 had not reached as one more invocation (9d). Attempt 2 plus 9d is **every one of the 379 files once** (171 + 208, the list computed from attempt 2's log): 376 passed and 3 failed. **4 tests failed in all**, none in this task's files:

- (a) the assistant log-line test: deterministic and pre-existing (DO-FB);
- (b) and (c) the two `response-validation` tests: they fail under the full run and pass alone (9c; DO-FB's finding);
- (d) the `admin/security` matrix test: deterministic, a webhook-class seam (9d, 9e).

These are two invocations on two disposable clusters, not one `pnpm test:integration`, so I report acceptance item 3 as **not met**.

**Formatting after the run.** The proof ran with `export-proof.mjs` sha256 `0cf025ab…` (logged by the driver). I then ran `prettier --write` on it, which gives the handed-back sha256 `7865d9d3…`. With all whitespace and trailing commas removed the two files are equal: a formatting-only change (`export-proof-formatting.txt`).

The API build the driver ran was compiled before `prettier --write` reformatted `snapshots.ts`, again a formatting-only change. Rows 2–3 were re-run on the final tree.

**Pinned counts:** none changed. The contract test's operation count, media types, rate-limit floor and CSRF-exempt routes are untouched. The migration count on a fresh database rises by one (110 → 111 applied, counting the 0001–0118 files present before and 0119); I found no test that pins that number. The `seed.test.ts` free-id example moves 0119 → 0120.

## 7. Operations routed (pending-list delta)

None. BE-S routes no operation and has no `p6-pending-*.ts` or `p6-exercises-*.ts` file. The pinned counts in `contract.test.ts` (operation count, media types, rate-limit floor, CSRF-exempt routes) are unchanged by this task.

## 8. For the orchestrator: contract, schema, dependency and decision needs

1. **Migration id.** I took **0119**, the next above 0118 on this branch, and moved `seed.test.ts`'s free-id example to 0120. Renumber at merge if another task shipped 0119 first: rename the file, update its header line "Id: …", the example in `seed.test.ts` and the comment in `audit-required-index.test.ts` (it names 0119 in text only).
2. **The generator defect is still open** (DO-F/DO-FB §5 item 1). The proof ran on DO-F's patched scratch copy (sha256 `6b2a9007…`), exactly as run-1 did. `deploy/load/generate.mjs` in the tree is unchanged (sha256 `7470ea74…`). DO-G needs the decision.
3. **Reopen candidate (REQ-S20-030, ADR-0058 §7).** The live-selection `createExport` assembles the snapshot inside the request, so 50 simultaneous starts take 2.8–3.3 s on this host. A start that is independent of the selection's size needs the worker to assemble the snapshot. `ExportJob.snapshotId` would then be null until assembly, or a new state would be needed: a contract change of a DG5 operation. Not changed here.
4. **Finding candidate.** Part B's 48 of 50 starts above 2 s (§4). Proposed Medium, non-mandatory; the classification is yours.
5. **Evidence path.** As DO-F reported, `docs/delivery/test-evidence/DG6/load/` is read-only for implementers. The proof output is in my handback evidence folder. Please copy `export-proof-after.json` and `export-proof-comparison.md` there if the report needs them.
6. **No new dependency, no new problem code, no contract change, no `schema.ts` change** (a function body changed; no table or column did).
7. **Integration suite: the integrated branch has red tests outside this task.** The assistant log-line test (deterministic, DO-FB §3), the `admin/security` rate-limit matrix (deterministic: the test expects the `webhook` class to have no operation, but `receiveWebhook` is in it) and two `response-validation` tests that fail only under the full run. Details in §6. None is in this task's files; each needs its owner.
8. **Dataset witnesses (DO-E's generator).** No AUD load user is assigned to LOAD-T01, and LOAD-T20 has only one non-AUD load user. So the "others get 404" checks use a cross-scope AUD for LOAD-T01 and cannot run the same-scope-other check for LOAD-T20 (§4). If DO-G or QA-E needs the stronger form everywhere, the generator's assignments need one same-scope AUD on LOAD-T01 and a second reader on LOAD-T20. That is DO-E's file, so I did not change it.

## 9. User-facing texts

None of mine became untrue. This task ships no UI string. I searched `apps/web/src/i18n/en/*.json` for strings that call exports or performance work planned or later, and found none.

## 10. Merge instructions

- Apply migration 0119 (renumber per §8 item 1 if needed). It is forward-only and replaces one function body; no data change. It applies on a fresh database (the integration suite's "applied 111 migrations") and on the load database.
- `snapshots.ts`'s change is confined to `insertSnapshot` plus the two new exports `INSERT_BATCH` and `batches`. It conflicts only with another edit of the same lines.
- `deploy/load/export-proof.mjs` imports nothing from `workload.mjs` or the demo seed. It needs a load database and the sessions file. Its usage is in the file header and in `load-driver.sh.txt`.

## 11. What remains

- **Acceptance item 3 is not met.** `with-pg.sh pnpm test:integration` did not exit 0:
  - the fork crashed twice (9, 9b), the likely cause being memory pressure from parallel `tsc` runs on the shared, swapless host (not established);
  - the 379 files, run once each across two invocations (9b + 9d), have 4 failing tests. None is in this task's files, and none involves report snapshots, exports or the audit trigger (§6).
  - Needed: (a) the assistant test fixed by its owner (BE-T/BE-U area); (d) the `admin/security` expectation reconciled with `receiveWebhook`'s class (BE-E2/BE-N area, or the orchestrator); (b) and (c) the `response-validation` load sensitivity, owned by the contract test (F-DG4-143–148 class).
  - Then one full `pnpm test:integration` on a quieter host, without parallel `tsc`.
- **REQ-S20-029 stays open** for DO-G's final run and report on the frozen tree. It also needs the orchestrator's generator decision (§8 item 2).
- **REQ-S20-030 stays open:**
  - part B's 2 s start misses on this host (§8 items 3–4: finding candidate and reopen candidate);
  - the two dataset-witness limits (§8 item 8);
  - DO-G repeats the proof in the final run, and QA-E verifies it.
- **Items 1, 2 and 4 are met:**
  - typecheck, build, lint, Prettier and openapi lint: exit 0, typecheck and build re-run on the final tree;
  - `pnpm test` with the locale unset and with C.UTF-8: exit 0 in every Vitest invocation;
  - the DG5 historical validator: exit 0.
- No separable second half is left of §H/G.9 itself: both fixes and the proof are delivered. What remains belongs to the owners named above, DO-G and the orchestrator.
