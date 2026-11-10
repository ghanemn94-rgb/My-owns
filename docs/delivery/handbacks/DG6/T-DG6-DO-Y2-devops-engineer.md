# Handback T-DG6-DO-Y2 (devops-engineer): full-dataset export-start re-measurement (F-DG6-147, D-207), load-stack rate limits, configuration doc drift

- **Stage / gate:** P6, DG6 (FIXING after review round 1). Branch `dg6/do-y2`, base `HEAD` `a973b5673e4e5787836f6e8320143cb5b0779521`. Changes are left **uncommitted**, as the assignment asks.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-DO-Y2-devops-engineer-20261102T005946Z-b6232232","session_id":"b6232232-4976-4772-a687-1af8d7648c03"}`. Assignment sha256 `947065ff…950aafa1`, verified.
- **Time:** `date -u` at the start: `2026-11-02T01:00:00Z`. At the end: `2026-11-02T01:51:34Z` (last line).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0** (`T-DG6-DO-Y2-evidence/00-validate-DG5-historical.log`).
- **Migrations:** none. **New operations:** none. **New dependencies:** none. **Contract change:** none.
- Engineering work only. Nothing here grants or implies a business, Finance or IT approval (G1–G6), and product gate G6 says nothing about DG7. All data is synthetic. Every figure below comes from one shared 4-vCPU sandbox host. The figures are **provisional, not Mobily capacity**. A single-host load stack is **not** a high-availability deployment.

## 1. The re-measurement (D-207, F-DG6-147)

### Environment facts

| Item | Value |
|---|---|
| Host | 4 vCPU Intel Xeon @ 2.10GHz (`lscpu`), 15 GiB RAM, kernel 6.18.44-fc-v185. Shared with T-DG6-ARCH-12 and, for the supplementary run, with this task's own `pnpm test` |
| Runtime | Node v24.21.0, offline. PostgreSQL 16.15, a disposable cluster on the same host (`tests/qa/support/with-pg.sh`, port 28500) |
| Docker | Not used for the measurement. `docker info` was refused (`permission denied … /var/run/docker.sock`). `docker compose config` works without the daemon, and I used it only to render the new overlay (§2) |
| Tree | Merged `HEAD` `a973b5673` with BE-Y5's asynchronous live-export assembly (migration 0124, `apps/api/dist/modules/reporting/exports/assembly.js` sha256 `aeeaf337…`). It was rebuilt with `pnpm -r build` (exit 0, 171 s; log 01) before the run |
| Dataset | The **shipped** `deploy/load/generate.mjs`, with no patch. Since DO-Y1 the shipped file **is** the patched copy every DG6 figure used: sha256 `6b2a9007e47b…bdff8a`. Profile `default`, seed 20261027. Marker: 50 transformations, 1,000 initiatives (250 in LOAD-T01), 1,500 RAID entries, 10,000 KPI actuals, 100,000 audit events, 120 users. Generation took 25.1 / 25.3 / 27.9 s |
| Driver | `deploy/load/export-proof.mjs`, **unchanged** (sha256 `7865d9d3…`, `START_TARGET_MS = 2000`). Part A is LOAD-T01, 16 exports by one user. Part B is **50 exports at once by 50 distinct users, one per transformation** (it formed all 50 pairs on this dataset, so BE-Y4's burst driver was not needed for part B) |
| Rate limits | `eval "$(node deploy/load/rate-limits.mjs)"` (§2). It set `UPLOAD_`, `SEARCH_`, `ASSISTANT_`, `WEBHOOK_` and `EXPORT_RATE_LIMIT_PER_MINUTE=100000`. The global (300) and auth (20) limits stayed at the product default, as in DO-F, DO-G, DO-H and QA round 1 |
| Method | DO-H's method, three repetitions. Each one: a fresh database, migrate (116 migrations), generate, 100 sessions, the reindex, a fresh API and worker, then an idle wait (1-minute load ≤ 1.0, or 300 s), then the proof. The 1-minute load average was sampled every 2 s during each proof |

Commands:

```bash
QA_PG_PORT=28500 MTH_PORT_POOL=28501-28519 tests/qa/support/with-pg.sh \
  bash docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/driver.sh          # exit 1 (see "non-zero exits"), wall 889 s
node docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/summarize.mjs        # exit 0 → 03-summary.txt
```

### Results (export-proof, full dataset, 50 simultaneous starts)

| Rep | Idle wait ended by | Load avg (1 min) during proof, min–max | Part A start p50 / p95 / max (ms) | **Part B start p50 / p95 / max (ms)** | **Part B over 2 s** | Part B completion p50 / p95 / max (ms) | First job created → last job finished |
|---|---|---|---|---|---|---|---|
| 1 | load 0.94 ≤ 1.0 after 25 s | 0.87–1.73 | 27 / 114 / 114 | **718 / 908 / 909** | **0 of 50** | 3,843 / 6,002 / 6,009 | 38.840 s, 66 jobs, 0 unfinished |
| 2 | timeout 301 s (load 1.67) | 1.51–2.22 | 26 / 169 / 169 | **651 / 869 / 874** | **0 of 50** | 4,014 / 4,548 / 4,659 | 37.275 s, 66 jobs, 0 unfinished |
| 3 | timeout 301 s (load 3.27) | 3.27–4.80 | 27 / 113 / 113 | **1,035 / 1,313 / 1,330** | **0 of 50** | 3,702 / 6,177 / 6,219 | 39.397 s, 66 jobs, 0 unfinished |

Every repetition, from the report JSONs (`rep-N/export-proof.json`) and the driver log:

- 202 with a job id: **66 of 66**.
- `percent` never decreased and ended at 100: **66 of 66**.
- Final status `succeeded`: **66 of 66**. In the database: `export_job succeeded 66` and `jobs with no snapshot 0`.
- Requester download 200, byte count equal to `fileSizeBytes`: **66 of 66** (largest file 60,328 bytes, 0 `EXPORT_MAX_BYTES` reopen candidates).
- Requester-only access:
  - another user with the same transformation scope got 404/404 (getExport and download): **65 of 65** exports that have such a user;
  - the AUD user got 404/404: **66 of 66**.
- API and worker error-level log lines: **0 / 0**. "rate limit class exceeded" lines: **0**. export-proof fails on any non-200 poll, so none of its polls got a 429.

In total: **0 of 150** part-B starts over 2 s, and **0 of 48** part-A starts over 2 s. The worst start in all 198 was **1,330 ms**, in repetition 3 at load 3.3–4.8. Before the change, on the same method, the results were:

- QA round 1, idle: 38 of 50 over 2 s, p95 2.31 s.
- DO-G: 24 of 50.
- BE-S: 48 of 50.

### Supplementary: 450 more starts, with the snapshot-assignment check, on a loaded host

ADR-0058's amendment T2 (D-207) adds two assertions:

1. the 202's `snapshotId` is `null` or a UUID;
2. `snapshotId` is assigned before `status` leaves `queued`.

The unchanged `export-proof.mjs` does not check either of them (see §6). So `export-burst-snapshot.mjs`, which is BE-Y4's `export-burst.mjs` plus those two checks, polled each job every 100 ms. It ran on one fresh full `default` database, with the same rate-limit helper: 3 bursts of 50 simultaneous live-selection starts (registers/raid, csv) over 281 exporter (user, transformation) pairs of 17 users. It ran **while `pnpm test` ran on the same host**, at load 5.4–6.8. I ran it three times:

- run 1: log 08;
- run 2: log 09, which adds the per-job observation detail;
- run 3: log 10, which counts non-200 polls separately.

The script in the evidence folder is the run-3 version.

| Log | Burst start p95 / max (ms) | Over 2 s | 202 `snapshotId` | Final | T2 assertion 2 |
|---|---|---|---|---|---|
| 08 | 833/846, 728/733, 884/888 | 0 / 0 / 0 | null 150 of 150 | succeeded 150 | 145 held, 5 flagged (burst 2) |
| 09 | 662/667, 950/956, 588/590 | 0 / 0 / 0 | null 150 of 150 | succeeded 150 | 145 held, 5 flagged (burst 2) |
| 10 | 785/791, 603/606, 581/590 | 0 / 0 / 0 | null 150 of 150 | succeeded 150 | **150 of 150 held, 0 violations** |

**The flagged jobs were a driver artefact, not a product defect.** Run 2's detail shows each flagged job's observations, for example `queued/null/200 → queued/uuid/200 → 429/null/429 → succeeded/uuid/200`:

- the "status" `429` came from an **HTTP 429 problem body** (its `status` member) that the run-1 and run-2 script read as a job status;
- the 429 came from the **global** limit (300 requests per minute per session), which the 100 ms polling of about 3 jobs per user exceeded.

Run 3 counts non-200 polls separately: 0 violations, and burst 3 had 8,240 polls answered 429. That burst's time to completion (43.8 s, against 7.0–10.0 s for the other bursts) was therefore decided by the global limiter on my polling, **not by the product**. The start latencies are unaffected, because each start is one request per user. Run 1's 5 flagged jobs had no detail recorded. They are presumably the same artefact (the same burst, and the same 51 s completion pattern), but run 1 does not prove it. After all three runs the database showed `jobs with no snapshot 0` and `export_job succeeded 150`.

### Is the acceptance text met?

- **REQ-S20-030**, the row F-DG6-147 cites: *"A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester"*. Read with ADR-0058 §7 and amendment T2: 202 with a job id within 2 s, including part B's 50 simultaneous starts. **On this host, on this merged tree, every clause held:**
  - "returns immediately with a job ID": 198 of 198 export-proof starts got 202 with a job id within 2 s (max 1.33 s), plus 450 of 450 supplementary starts under load (max 0.96 s);
  - "progress rises to 100%": 66 of 66 per repetition;
  - "downloads only for the requester": the requester got 200 on 66 of 66; the same-scope other user got 404/404 on 65 of 65; AUD got 404/404 on 66 of 66.

  The one gap is the known dataset gap: LOAD-T20 has no second non-AUD user, so the same-scope-other check cannot run for that one export. AUD still covers it. This is unchanged since BE-S, DO-G and DO-H, and it is the only reason `export-proof.mjs` exits 1.
- **The margin.** Part B's worst start is 0.87–1.33 s, against the 2.0–2.3 s QA measured before. That is about 0.7 s of headroom at load 3–5 on 4 vCPU. These are provisional sandbox figures for one API process. They are **not** a statement of Mobily capacity or high-availability readiness.
- **Closure.** I do not close F-DG6-147. The originating reviewer, or another qualified non-author, verifies it (agent protocol).

### Non-zero exits and noise, all explained

- `driver.sh` exited **1**, because `export-proof.mjs` exited **1** in each repetition. The cause is the single assertion `LOAD-T20 FAIL: no sameScopeOther user for this transformation` (the dataset gap above, the same as DO-H). No latency or access assertion failed.
- `driver.sh: line 33: NNN Killed ( while :; do …` appears 3 times in log 02. It is bash's job notice when the driver stops its own load-average sampler with `kill -KILL` after each proof. It is expected and harmless.
- The idle wait of repetitions 2 and 3 ended by the 300 s timeout (load 1.67 and 3.27), not by load ≤ 1.0. The other worktree's task shared the host. The load during each proof is in the table and in `rep-N/loadavg-during-proof.txt`.
- `driver-bursts.sh` exited 0 in all three runs (logs 08–10).

## 2. Load drivers: the P6 class budgets are raised by default on a load stack

- **`deploy/load/rate-limits.mjs`** (new). The shell form is `eval "$(node deploy/load/rate-limits.mjs)"`, and `loadRateLimitEnv(env)` is the library form. Behaviour:
  - It raises each P6 class budget (`UPLOAD_`, `SEARCH_`, `ASSISTANT_`, `WEBHOOK_`, `EXPORT_RATE_LIMIT_PER_MINUTE`) to `LOAD_RATE_LIMIT_PER_MINUTE = 100000`, unless that variable is already set, directly or through `<NAME>_FILE`, the way the API's configuration reads it. An explicit value always wins, so a run can measure the limiter on purpose.
  - stdout carries only `export` lines; a one-line note goes to stderr. It reads and prints no secret.
  - It leaves the global and auth limits alone. They are not P6 classes, and every measured run used their defaults.
- **`deploy/compose/compose.load.yaml`** (new). This overlay is for the load stack's `api` and `worker`. It sets `MTH_ENV=load` and the same five budgets as `${MTH_LOAD_<CLASS>_RATE_LIMIT:-100000}`.
  - Rendered with `MTH_ENV=load docker compose -p mth-load -f deploy/compose/compose.yaml -f deploy/compose/compose.load.yaml config` (dummy secret files under `$TMPDIR`; exit 0), the api service has the five values at `"100000"`, and both services have `MTH_ENV: load`.
  - The overlay's comment states that `assertLoadDatasetEnvironment` is **not** yet called by `apps/api/src/main.ts` or `apps/worker/src/main.ts`. So nothing stops someone from applying the overlay to a production database, and the README says to keep it to `-p mth-load`.
- **`deploy/load/README.md`**:
  - new rows in the files table;
  - a new section, "Rate limits on a load stack", covering why, the process and Compose forms, what is not raised and why, the 429 handling of the drivers, and the observation that a polling driver can be decided by the global limit;
  - the Compose `api worker` command now includes the overlay;
  - a "Measured here" entry for these export-start figures.
- **`deploy/compose/compose.yaml`**: only the load-profile comment's command line changed (it now adds the overlay). No service definition changed.
- **`deploy/scripts/tests/load-rate-limits.vitest.mjs`** (new, unit-node, 5 tests). It pins four things:
  - the helper's list equals `Object.values(RATE_LIMIT_CLASS_VARIABLES)` from `packages/config/src/load.ts`, so a class added later fails the test until it is raised;
  - `loadConfig("api", …)` accepts the values and yields 100000 for each class, with global 300 and auth 20 unchanged;
  - an explicit value or `_FILE` is kept, and an empty value counts as unset;
  - the overlay's five lines carry the same variables and default, and the overlay contains no global or auth limit.

The evidence drivers of earlier tasks (DO-F, DO-G, DO-H, QA) are records and are not changed. The shipped clients (`workload.mjs`, `export-proof.mjs`) need no change: they never set API configuration, and they already count a 429 as a failure.

## 3. Configuration doc drift (BE-Y4 handback)

In `docs/operations/configuration.md`, under "Rate-limit classes", I corrected what the merged code ships:

- **The Security page.** "a planned P6 item (frontend), not yet in this tree" now reads: the **Administration > Security** page exists and is read-only. Sources: `/admin/security`, `apps/web/src/pages/admin/security/SecurityPage.tsx`, route in `apps/web/src/app/router.tsx:806`, and the nav entry in `apps/web/src/app/nav.ts`, which requires `security.read` or `upload_policy.configure`.
- **search:** `searchRecords` (`GET /api/v1/search`). Source: `apps/api/src/modules/search/routes.ts:46`, `...rateLimitClass("search")`.
- **assistant:** `postAssistantMessage` (`POST /api/v1/assistant/conversations/{conversationId}/messages`). Source: `apps/api/src/modules/assistant/conversations.ts:677`.
- **webhook:** `receiveWebhook` (`POST /api/v1/webhooks/{endpointKey}`, keyed by endpoint key). Source: `apps/api/src/modules/integrations/routes.ts:805`.
- All three agree with `RATE_LIMIT_CLASSES` in `apps/api/src/modules/platform/hooks.ts:276-308`.
- **New text:** where the matrix and the class variables live in code, and a "Load stacks only" paragraph that points to §2 and warns against using it in production or demo.

**en/ar user-facing strings.** I searched `apps/web/src/i18n/en/*.json` for "planned", "not yet", "later" and "coming" near search, assistant, webhook, security, rate or export. **I found no string that says these classes or the page are planned.** The Security page renders the live `getSecurityRateLimits` matrix (`adminP6.json` `security.*`, `nav.json` `nav.p6.security.*`), so it already shows every wired operation. No en/ar change was needed, and none was made.

## Files changed

| File | Purpose |
|---|---|
| `deploy/load/rate-limits.mjs` (new) | The load-stack P6 class budgets (100000/min unless set explicitly); shell and library forms |
| `deploy/compose/compose.load.yaml` (new) | Compose overlay for a load stack's api and worker: `MTH_ENV=load` and the five budgets |
| `deploy/scripts/tests/load-rate-limits.vitest.mjs` (new) | Pins the helper and the overlay to the API's class variables and config (unit-node, 5 tests) |
| `deploy/load/README.md` | Files table, the "Rate limits on a load stack" section, the Compose command with the overlay, this task's figures |
| `deploy/compose/compose.yaml` | The load-profile **comment** only: the `api worker` command adds the overlay |
| `docs/operations/configuration.md` | The Security page and the search, assistant and webhook rows made true; code pointers; the load-stack note |
| `docs/delivery/handbacks/DG6/T-DG6-DO-Y2-devops-engineer.md` | This handback |
| `docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/*` | Drivers (`driver.sh`, `driver-bursts.sh`, `export-burst-snapshot.mjs`, `summarize.mjs`), logs 00–10, `rep-1..3/export-proof.json` and `loadavg-during-proof.txt` |

Checksums: `rate-limits.mjs` `0a8d1c78…`, the file the measurement ran with, unchanged since; `compose.load.yaml` `e7f035c0…`; `driver.sh` `d15e26f8…`; `export-burst-snapshot.mjs` `4c56f289…`; `rep-1/2/3/export-proof.json` `e03a7b82…` / `9111ad02…` / `2ada4574…`.

## Checks (real exit codes)

Environment: Node 24.21.0, offline, harness ports 28500–28549 only (PostgreSQL 28500 and 28540; API 28530 and 28546; `MTH_PORT_POOL` 28501–28529 and 28541–28544).

| Command | Exit | Result / log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` (log 00) |
| `pnpm -r build` (before the measurement) | **0** | 171 s (log 01) |
| measurement `driver.sh` inside `with-pg.sh` | **1** | export-proof's LOAD-T20 dataset assertion only; every latency and access clause held (log 02, `03-summary.txt`) |
| `driver-bursts.sh` × 3 inside `with-pg.sh` | **0 / 0 / 0** | logs 08, 09, 10 |
| `npx vitest run --project unit-node deploy/scripts/tests/load-rate-limits.vitest.mjs` | **0** | 5 passed |
| `pnpm -r typecheck` | **0** | 244 s (log 04) |
| `pnpm lint` | **0** | log 04; re-run at the end, log 11 |
| `pnpm openapi:lint` | **0** | log 04 |
| `pnpm -r build` | **0** | 182 s (log 05) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | log 05; re-run at the end, log 11 |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | unit-node **189 files, 2851 passed**; unit-web **120 files, 2020 passed**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped**; 415 s (log 06) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | the same counts: 189 / 2851, 120 / 2020, 3 / 259 + 2 skipped; 384 s (log 07) |
| `pnpm test:integration` | not run | Not required by the assignment (the orchestrator runs it on the merged tree). This task touches no integration test file |

The `unit-node` count includes the 5 new tests. No pinned count changed.

## Operations routed (pending-list delta)

None. No API operation was added or routed, so no `p6-pending-*.ts` or `p6-exercises-*.ts` file changed.

## For the orchestrator: contract, schema, dependency needs

None. No migration, no contract or zod change, no new dependency.

## User-facing texts made untrue, and what I did

- `docs/operations/configuration.md`: four statements were untrue before this task (the Security page "planned"; search, assistant and webhook "none yet"). **Corrected** (§3).
- `deploy/load/README.md` and the `compose.yaml` load comment: the Compose `api worker` command would now run without the raised budgets. **Updated** to include the overlay.
- en/ar UI strings: **none affected** (§3).

## What remains

1. **`export-proof.mjs` does not assert ADR-0058 amendment T2 assertions 1–2** (`snapshotId` null or a UUID in the 202; assigned before `status` leaves `queued`). The file is backend-owned (T-DG6-BE-S). I checked both assertions with my own evidence script: 150 of 150 in the clean run (log 10), and 0 null snapshots in the database after every run. Adding the assertions to the shipped proof is **for the backend owner** of `deploy/load/export-proof.mjs`.
2. **The LOAD-T20 dataset gap**, which makes `export-proof.mjs` exit 1 on every run. It is unchanged and is the dataset owner's call (BE-S §8, DO-G, DO-H).
3. **The start-up refusal of `MTH_ENV=load`** (`assertLoadDatasetEnvironment`) is still not called by `apps/api/src/main.ts` or `apps/worker/src/main.ts` (DO-E's patch). Until it is, the new overlay relies on the operator using a separate `-p mth-load` project. This is stated in the overlay and the README. Those files are outside devops ownership.
4. **F-DG6-147's closure** belongs to a non-author reviewer. The measurement above is the input D-207 asked for.

End: `date -u` → `2026-11-02T01:51:34Z` (about 50 min after the start).
